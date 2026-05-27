/**
 * 公开版 R2 中转图配置:bucket / publicBase / keyPrefix 走 env,凭据
 * (R2_ACCOUNT_ID 等) 由 drivers/r2.ts 自己读。
 *
 * 全配置到位 = enabled。否则生图 endpoint fallback 返 b64,本地 dev 友好。
 *
 *   PUBLIC_R2_BUCKET       — 如 inkast-storage
 *   PUBLIC_R2_PUBLIC_BASE  — 如 https://inkast.124213.xyz(不带尾斜杠,
 *                             代码自动拼 key)
 *   PUBLIC_R2_KEY_PREFIX   — 如 public/gen/(末尾要带斜杠)
 */
export interface R2Config {
  bucket: string;
  publicBase: string;
  keyPrefix: string;
  enabled: boolean;
}

let _cached: R2Config | null = null;

export function loadR2Config(): R2Config {
  if (_cached) return _cached;
  const bucket = process.env.PUBLIC_R2_BUCKET?.trim() ?? "";
  const publicBase = (process.env.PUBLIC_R2_PUBLIC_BASE?.trim() ?? "").replace(/\/+$/, "");
  const keyPrefix = process.env.PUBLIC_R2_KEY_PREFIX?.trim() ?? "public/gen/";
  const credsOk =
    !!process.env.R2_ACCOUNT_ID &&
    !!process.env.R2_ACCESS_KEY_ID &&
    !!process.env.R2_SECRET_ACCESS_KEY;
  _cached = {
    bucket,
    publicBase,
    keyPrefix,
    enabled: Boolean(bucket && publicBase && credsOk),
  };
  return _cached;
}

export function publicUrlForKey(key: string): string {
  const cfg = loadR2Config();
  if (!cfg.enabled) throw new Error("R2 not enabled");
  return `${cfg.publicBase}/${key}`;
}
