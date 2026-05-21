import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

/**
 * Cloudflare R2 object storage driver.
 *
 * Used by plugin-async (when a plugin opts into `imageStorage.kind = "r2"`)
 * to upload the generated image bytes and hand the public URL back via
 * callback, instead of stuffing base64 into the callback payload.
 *
 * Why R2:
 *   - jdc 上行带宽 5Mbps,callback 推 2MB base64 一张图占满 3-4s,影响共享出口
 *   - 客户(uniCloud)还要拿 b64 二次上传到自己的 R2,链路放大 2x
 *   - 直接 inkast → R2 → 客户读 URL,公共 CDN 命中后吃 0 jdc 流量
 *
 * Credentials: 3 env vars (RW token).
 *   R2_ACCOUNT_ID         — public-ish (R2 endpoint URL contains it),走 env 只是为了组装方便
 *   R2_ACCESS_KEY_ID      — secret,jdc env 600
 *   R2_SECRET_ACCESS_KEY  — secret,jdc env 600
 *
 * Bucket / public_base / key_prefix / content_type 通过 plugin overlay JSON
 * 的 `imageStorage` 块下发,**不进 env**——env 只放 token 凭据。
 *
 * Retry: 0.5s / 2s / 8s 共 4 次尝试(初次 + 3 retry),指数退避。失败后抛
 * R2UploadError,plugin-async 转译成 callback `error_code: r2_upload_failed`。
 */

const RETRY_DELAYS_MS = [500, 2_000, 8_000];

let _client: S3Client | null = null;

function getClient(): S3Client {
  if (_client) return _client;
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new R2ConfigError(
      "R2 credentials missing: R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY must all be set",
    );
  }
  _client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  return _client;
}

export interface PutImageInput {
  bucket: string;
  key: string;
  body: Buffer;
  contentType: string;
}

export interface PutImageOutput {
  bytes: number;
  attempts: number;
  durationMs: number;
}

export async function putImage(input: PutImageInput): Promise<PutImageOutput> {
  const client = getClient();
  const overallStart = Date.now();
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      const delay = RETRY_DELAYS_MS[attempt - 1]!;
      console.log(
        `[r2]   …retrying put in ${delay}ms (attempt ${attempt + 1}/${RETRY_DELAYS_MS.length + 1})`,
      );
      await new Promise(rs => setTimeout(rs, delay));
    }
    const started = Date.now();
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: input.bucket,
          Key: input.key,
          Body: input.body,
          ContentType: input.contentType,
          CacheControl: "public, max-age=31536000, immutable",
        }),
      );
      console.log(
        `[r2] ✓ ${input.bucket}/${input.key} (${input.body.length}B) in ${Date.now() - started}ms`,
      );
      return {
        bytes: input.body.length,
        attempts: attempt + 1,
        durationMs: Date.now() - overallStart,
      };
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[r2] ✗ put ${input.bucket}/${input.key} attempt ${attempt + 1} failed in ${Date.now() - started}ms: ${msg}`,
      );
    }
  }
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new R2UploadError(
    `R2 put failed after ${RETRY_DELAYS_MS.length + 1} attempts: ${msg}`,
    lastErr,
  );
}

export class R2UploadError extends Error {
  constructor(
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "R2UploadError";
  }
}

export class R2ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "R2ConfigError";
  }
}
