/**
 * 一次性迁移:把 Web UI 通道(generations 表)的存量本地图补传到 R2,回填 image_url。
 *
 * 背景:Web UI 通道改为纯 R2 后,新图直传 R2;存量本地图(image_url IS NULL)
 * 仍躺在 <DATA_DIR>/images/。本脚本把它们补传到 R2 并回填 image_url,之后
 * /api/generations/:id/image 会 302 到 CDN,本地 images/ 目录即可安全删除。
 *
 * 用法(在 jdc /root/inkast 下,先 source env 拿 R2 凭据 + INKAST_DATA_DIR):
 *   set -a; . /root/inkast/inkast-api.env; set +a
 *   node apps/api/scripts/migrate-webui-to-r2.mjs            # dry-run:只统计,不传不改
 *   node apps/api/scripts/migrate-webui-to-r2.mjs --apply    # 真上传 + 回填 image_url
 *   node apps/api/scripts/migrate-webui-to-r2.mjs --verify   # HEAD 校验所有 image_url 可达
 *
 * 幂等:--apply 只处理 image_url IS NULL 的行,跑多次安全。R2 key 沿用本地相对
 * 路径 webui/YYYY/MM/<uuid>.<ext>,与新图(webui/<uuid>.<ext>)同前缀不相撞。
 */
import Database from "better-sqlite3";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const MODE = process.argv.includes("--apply")
  ? "apply"
  : process.argv.includes("--verify")
    ? "verify"
    : "dry-run";

const dataDir = process.env.INKAST_DATA_DIR;
if (!dataDir) {
  console.error("INKAST_DATA_DIR not set (expected e.g. /root/inkast/data)");
  process.exit(1);
}

const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
if (!accountId || !accessKeyId || !secretAccessKey) {
  console.error("Missing R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY");
  process.exit(1);
}

const bucket = process.env.INKAST_WEBUI_R2_BUCKET?.trim() || "inkast-storage";
const base = (
  process.env.INKAST_WEBUI_R2_PUBLIC_BASE?.trim() || "https://static.124213.xyz"
).replace(/\/+$/, "");
const prefix = "webui/";

const client = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
});

const db = new Database(join(dataDir, "inkast.sqlite"));
const ctOf = fmt =>
  fmt === "jpeg" ? "image/jpeg" : fmt === "webp" ? "image/webp" : "image/png";

if (MODE === "verify") {
  const rows = db
    .prepare("SELECT id, image_url FROM generations WHERE image_url IS NOT NULL")
    .all();
  console.log(`verifying ${rows.length} R2 URLs…`);
  let ok = 0;
  let bad = 0;
  for (const r of rows) {
    const res = await fetch(r.image_url, { method: "HEAD" });
    if (res.ok) ok++;
    else {
      bad++;
      console.error(`  ✗ ${r.id} → HTTP ${res.status} ${r.image_url}`);
    }
  }
  console.log(`verify done: ${ok} ok, ${bad} bad`);
  process.exit(bad ? 1 : 0);
}

const rows = db
  .prepare("SELECT id, image_path, image_format FROM generations WHERE image_url IS NULL")
  .all();
let totalBytes = 0;
let missing = 0;
for (const r of rows) {
  const p = join(dataDir, "images", r.image_path);
  if (existsSync(p)) totalBytes += readFileSync(p).length;
  else missing++;
}
console.log(
  `${rows.length} rows need migration (${(totalBytes / 1024 / 1024).toFixed(1)} MB on disk, ${missing} missing files)`,
);
console.log(`target: s3://${bucket}/${prefix} → ${base}/${prefix}`);

if (MODE === "dry-run") {
  console.log("dry-run — pass --apply to upload + backfill image_url");
  process.exit(0);
}

const update = db.prepare("UPDATE generations SET image_url = ? WHERE id = ?");
let done = 0;
let failed = 0;
let skipped = 0;
for (const r of rows) {
  const p = join(dataDir, "images", r.image_path);
  if (!existsSync(p)) {
    skipped++;
    console.warn(`  ⚠ skip ${r.id}: file missing ${r.image_path}`);
    continue;
  }
  const key = `${prefix}${r.image_path}`;
  try {
    const body = readFileSync(p);
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: ctOf(r.image_format),
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );
    update.run(`${base}/${key}`, r.id);
    done++;
    if (done % 20 === 0) console.log(`  … ${done}/${rows.length}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${r.id} (${key}): ${err?.message ?? err}`);
  }
}
console.log(
  `apply done: ${done} migrated, ${skipped} skipped (missing file), ${failed} failed`,
);
process.exit(failed ? 1 : 0);
