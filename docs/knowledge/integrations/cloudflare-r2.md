# Cloudflare R2(对象存储)

S3 兼容对象存储,三套消费方共用:Plugin 通道 v2.1 生图直传(callback 给客户方 URL)、公开版生图中转、**主线 Web UI 通道纯 R2(v2.43)**。统一模式:inkast 出图后 PUT R2,下游拿公网 URL 而非 b64。

## 选型原因

替代方案:让客户方在 callback 收 b64 后自己上传 R2。具体决策见 [[r2-direct-upload-v2.1]]——核心是省 JDC 上行带宽 + 简化客户方代码。

R2 vs S3 / 阿里 OSS / 腾讯 COS 选 R2 因为:
- snap-ub 已经在用 R2(`aivariants.124213.xyz` 公开域名 + CF CDN)
- R2 **出站流量免费**(读图不收费),只算请求 + 存储
- 自定义域名 + Cloudflare 自动签 SSL,零运维

## 使用方式

driver 在 [apps/api/src/drivers/storage/r2.ts](../../../apps/api/src/drivers/storage/r2.ts):

```typescript
import { putImage } from "./r2.js";

await putImage({
  bucket: "snap-ub-ai-variants",
  key: "aiVariants/ink-uuid.png",
  body: pngBytes,           // Buffer
  contentType: "image/png",
});
```

**重试**:0.5s / 2s / 8s 共 4 次尝试(初次 + 3 retry),指数退避。所有 retry 都失败抛 `R2UploadError`,plugin-async 转译成 callback `error_code: "r2_upload_failed"`。

**CacheControl**:固定 `public, max-age=31536000, immutable`(图片永不变,长期 CDN 缓存)。

## 凭据(env-only)

| env | 性质 |
|---|---|
| `R2_ACCOUNT_ID` | Cloudflare account id,**明文 OK**(R2 endpoint URL 本来就含它,公开) |
| `R2_ACCESS_KEY_ID` | secret |
| `R2_SECRET_ACCESS_KEY` | secret |

`getClient()` lazy init,3 个 env 任一缺 → 抛 `R2ConfigError`(明确错误,不会沉默挂掉)。

endpoint 由 account_id 拼:`https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`。region 必须传 `"auto"`(S3 SDK 要求,R2 不分 region)。

**凭据写入 jdc 走 stdin pipe**:`{ printf "R2_ACCESS_KEY_ID="; security find-generic-password -s ... -w; } | ssh jdc 'cat >> /root/inkast/inkast-api.env'`,secret 全程在 pipe 内,**不进 shell 变量、不进 zsh history、不进 transcript**。

## 路径与公网读

### Plugin 通道(snap-ub-ai-variants)

| 维度 | 配在哪 | 谁定 |
|---|---|---|
| bucket | plugin overlay `imageStorage.bucket` | 客户(snap-ub 选 `snap-ub-ai-variants`) |
| keyPrefix | plugin overlay `imageStorage.keyPrefix` | 客户(snap-ub 选 `aiVariants/`) |
| publicBase | plugin overlay `imageStorage.publicBase` | 客户(snap-ub 自定义域名 `https://aivariants.124213.xyz`) |
| contentType | plugin overlay `imageStorage.contentType` | 客户(`image/png` 或 `image/jpeg`) |

inkast 拼 key:`${keyPrefix}${task_id}.${ext}`,如 `aiVariants/ink-uuid.png`。
公网 URL:`${publicBase}/${key}`,如 `https://aivariants.124213.xyz/aiVariants/ink-uuid.png`。

### inkast-storage bucket(平台自用)

bucket:`inkast-storage`,自定义域名:`static.124213.xyz`。bucket 内靠**路径约定**隔离,token 无前缀强制:

**previews/ 路径 — sprite 预览图**

14 张 sprite sheet PNG,上传脚本:`apps/api-public/scripts/upload-previews.mjs`。来源目录:`apps/web/public/previews/`。上传后浏览器从 `https://static.124213.xyz/previews/<file>.png` 直接拉图。迁 R2 前这些图放 `apps/web-public/public/previews/`,被 nginx SPA fallback 兜底成 `text/html`——迁 R2 根治了这个坑(见 [nginx-spa-fallback-swallows-static](../pitfalls/nginx-spa-fallback-swallows-static.md))。详见 [decisions/previews-migrate-r2](../decisions/r2-direct-upload-v2.1.md) 和 [domains/sprite-previews](../domains/sprite-previews.md)。

**public/gen/ 路径 — 公开版生图中转**

公开版生图成功后,后端把图片 PUT 到 `public/gen/<uuid>.png`,浏览器从 `${PUBLIC_R2_PUBLIC_BASE}/${key}` 拉图,绕开 jdc 5 Mbps 上行带宽。配置来自 `apps/api-public/src/domain/gen/r2-config.ts`,driver 在 `apps/api-public/src/drivers/r2.ts`(与主线 `apps/api/src/drivers/storage/r2.ts` 逻辑相同,独立复制)。

**webui/ 路径 — 主线 Web UI 通道生图(v2.43)**

主线 Web UI 通道(jobs/generations)生图成功后 PUT `webui/<uuid>.<ext>`,generations 表 `image_url` 存公开 URL,`/api/generations/:id/image` 端点 302 重定向到 `static.124213.xyz`(浏览器直连 CDN,图字节不过 jdc)。配置 `apps/api/src/domain/generate/r2-config.ts`:`enabled = R2 凭据齐`(jdc 已有 `R2_*`,部署即自动启用;dev 无凭据降级写本地)。bucket/base/prefix 走 `INKAST_WEBUI_R2_*` env 带默认值(`inkast-storage` / `static.124213.xyz` / `webui/`),凭据复用主线 `R2_*`。**纯 R2 不留本地,上传失败 = 该次生图失败**(无本地兜底,对齐 plugin 通道)。存量 114 张已迁移。详见 [domains/image-generation](../domains/image-generation.md)、[decisions/webui-channel-pure-r2](../decisions/webui-channel-pure-r2.md)、[workflows/migrate-webui-images-to-r2](../workflows/migrate-webui-images-to-r2.md)。

公开版专用 env:

| env | 示例 | 说明 |
|---|---|---|
| `PUBLIC_R2_BUCKET` | `inkast-storage` | bucket 名 |
| `PUBLIC_R2_PUBLIC_BASE` | `https://static.124213.xyz` | 不带尾斜杠 |
| `PUBLIC_R2_KEY_PREFIX` | `public/gen/` | 末尾带斜杠,默认即 `public/gen/` |

凭据复用主线同一套 `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`。R2Config 三项 env 加凭据全齐才 `enabled = true`;缺任一项 fallback 返 b64,本地 dev 友好。详见 [domains/public-image-gen](../domains/public-image-gen.md)。

## 限制与注意

- **不做幂等覆盖检查**(没用 `IfNoneMatch: '*'`)——plugin_tasks.id 是 PK,同 task_id 不会重生图,所以幂等性由上游保证
- **bucket 归属**:R2 token `inkast-rw` scope 两个 bucket(`snap-ub-ai-variants` + `inkast-storage`),snap-ub 那个 token 不动。**inkast 写 snap-ub bucket 是君子约定路径前缀隔离**——token 上没有强制
- **inkast-storage 内多条路径**(`previews/` / `public/gen/` / `webui/`)同样靠命名约定隔离,token 无前缀强制(`aiVariants/` 在 snap-ub 自己的 bucket,不在 inkast-storage)
- **公网 URL 公开**:UUID 做 key,128 bit 不可枚举猜不到。但有 URL 就能下载,客户方应保护 URL 不外泄
- **凭据加固**:env 文件权限 600,只 root 可读

## 关联

- [r2-direct-upload-v2.1](../decisions/r2-direct-upload-v2.1.md) — 为什么 inkast 直传不让客户兜底
- [plugin-channel](../domains/plugin-channel.md) — Plugin 通道(v2.1 改造的入口)
- [plugin-overlay-loader](../shared/plugin-overlay-loader.md) — imageStorage 字段在 plugin overlay schema 里
- [crypto-utils](../shared/crypto-utils.md) — 凭据加密只用于 SQLite provider key,R2 凭据走 env
- [domains/public-image-gen](../domains/public-image-gen.md) — 公开版生图中转(R2 enabled/disabled 两路)
- [domains/sprite-previews](../domains/sprite-previews.md) — sprite 预览图(存于 previews/ 路径)
- [domains/image-generation](../domains/image-generation.md) — Web UI 通道生图(存于 webui/ 路径,纯 R2)
- [decisions/webui-channel-pure-r2](../decisions/webui-channel-pure-r2.md) — Web UI 通道为什么纯 R2
- [workflows/migrate-webui-images-to-r2](../workflows/migrate-webui-images-to-r2.md) — 存量迁移流程
- [pitfalls/nginx-spa-fallback-swallows-static](../pitfalls/nginx-spa-fallback-swallows-static.md) — 迁 R2 解决 nginx 把静态图兜底成 html 的根因
