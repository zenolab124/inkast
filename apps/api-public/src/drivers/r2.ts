import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

/**
 * Cloudflare R2 上传 driver。跟主线 apps/api/src/drivers/storage/r2.ts 实现
 * 一致(R2 跨 app 的 stateless 工具,复制比抽 packages/ 更简单)。
 *
 * 用于"生图成功 → 立刻上 R2 → 给浏览器返 URL"模式,绕开 jdc 5Mbps 上行
 * 带宽(浏览器从 R2 边缘 CDN 直接拉图)。
 *
 * 凭据 env(跟主线一致 namespace,jdc 一套凭据两个 app 都能用):
 *   R2_ACCOUNT_ID         — 公开-ish(出现在 endpoint URL),env 只为组装方便
 *   R2_ACCESS_KEY_ID      — secret
 *   R2_SECRET_ACCESS_KEY  — secret
 *
 * Retry: 4 次,指数退避 0.5s/2s/8s(跟主线一样,jdc 实战已验证)。
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
      "R2 credentials missing: R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY",
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
