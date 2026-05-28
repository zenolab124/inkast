import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
if (!accountId || !accessKeyId || !secretAccessKey) {
  console.error("Missing R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY");
  process.exit(1);
}

const dir = resolve(process.cwd(), "..", "..", "apps/web/public/previews");
const bucket = "inkast-storage";
const keyPrefix = "previews/";

const client = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
});

const files = (await readdir(dir)).filter(f => f.endsWith(".png"));
console.log(`uploading ${files.length} PNGs from ${dir} → s3://${bucket}/${keyPrefix}`);

for (const f of files) {
  const body = await readFile(join(dir, f));
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: `${keyPrefix}${f}`,
    Body: body,
    ContentType: "image/png",
    CacheControl: "public, max-age=31536000, immutable",
  }));
  console.log(`  ✓ ${f} (${(body.length / 1024).toFixed(0)} KB)`);
}
console.log("done");
