/**
 * Web UI 通道(jobs / generate-image)生图的 R2 直传配置。
 *
 * 这是 R2 的第三套消费方,与另外两套并列:
 *   - plugin 通道  : 配置走 plugin overlay JSON 的 `imageStorage` 块
 *   - 公开版       : 配置走 PUBLIC_R2_* env(apps/api-public/src/domain/gen/r2-config.ts)
 *   - Web UI 通道  : 本文件 —— bucket / publicBase / keyPrefix 走 env 但带平台
 *                    默认值,凭据复用主线同一套 R2_ACCOUNT_ID / R2_ACCESS_KEY_ID /
 *                    R2_SECRET_ACCESS_KEY(driver 在 drivers/storage/r2.ts 自读)。
 *
 * enabled 语义(纯 R2 / 本地降级的开关):
 *   - 凭据齐(生产 jdc)→ enabled,generate() 纯 R2,**不写本地磁盘**,
 *     image_path 存 R2 key、image_url 存公开 URL。
 *   - 凭据缺(典型:本地 dev 没配 R2)→ disabled,generate() 退回写本地
 *     <DATA_DIR>/images/YYYY/MM/<uuid>.<ext>,image_url 为 null。
 *
 * bucket / publicBase 有平台默认值,所以 enabled 实质只取决于凭据是否齐 ——
 * jdc env 早已有这三个凭据(plugin 通道在用),部署即生效;本地 dev 不配凭据
 * 即落本地,开发链路不被 R2 依赖拖死。
 */
export interface WebuiR2Config {
  bucket: string;
  publicBase: string;
  keyPrefix: string;
  enabled: boolean;
}

let _cached: WebuiR2Config | null = null;

export function loadWebuiR2Config(): WebuiR2Config {
  if (_cached) return _cached;
  const bucket = process.env.INKAST_WEBUI_R2_BUCKET?.trim() || "inkast-storage";
  const publicBase = (
    process.env.INKAST_WEBUI_R2_PUBLIC_BASE?.trim() || "https://static.124213.xyz"
  ).replace(/\/+$/, "");
  const keyPrefix = normalizePrefix(
    process.env.INKAST_WEBUI_R2_KEY_PREFIX?.trim() || "webui/",
  );
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

function normalizePrefix(p: string): string {
  return p.endsWith("/") ? p : `${p}/`;
}

export function publicUrlForKey(key: string): string {
  const cfg = loadWebuiR2Config();
  return `${cfg.publicBase}/${key}`;
}
