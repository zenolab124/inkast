# Cloudflare R2(对象存储)

S3 兼容对象存储,Plugin 通道 v2.1 用它做"生图直传"——inkast 出图后 PUT R2,callback 给客户方 URL 而不是 b64。

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

| 维度 | 配在哪 | 谁定 |
|---|---|---|
| bucket | plugin overlay `imageStorage.bucket` | 客户(snap-ub 选 `snap-ub-ai-variants`) |
| keyPrefix | plugin overlay `imageStorage.keyPrefix` | 客户(snap-ub 选 `aiVariants/`) |
| publicBase | plugin overlay `imageStorage.publicBase` | 客户(snap-ub 自定义域名 `https://aivariants.124213.xyz`) |
| contentType | plugin overlay `imageStorage.contentType` | 客户(`image/png` 或 `image/jpeg`) |

inkast 拼 key:`${keyPrefix}${task_id}.${ext}`,如 `aiVariants/ink-uuid.png`。
公网 URL:`${publicBase}/${key}`,如 `https://aivariants.124213.xyz/aiVariants/ink-uuid.png`。

## 限制与注意

- **不做幂等覆盖检查**(没用 `IfNoneMatch: '*'`)——plugin_tasks.id 是 PK,同 task_id 不会重生图,所以幂等性由上游保证
- **bucket 归属**:R2 token `inkast-rw` scope 两个 bucket(`snap-ub-ai-variants` + `inkast-storage`),snap-ub 那个 token 不动。**inkast 写 snap-ub bucket 是君子约定路径前缀隔离**——token 上没有强制
- **公网 URL 公开**:UUID 做 key,128 bit 不可枚举猜不到。但有 URL 就能下载,客户方应保护 URL 不外泄
- **凭据加固**:env 文件权限 600,只 root 可读

## 关联

- [[r2-direct-upload-v2.1]] — 为什么 inkast 直传不让客户兜底
- [[plugin-channel]] — Plugin 通道(v2.1 改造的入口)
- [[plugin-overlay-loader]] — imageStorage 字段在 plugin overlay schema 里
- [[crypto-utils]] — 凭据加密只用于 SQLite provider key,R2 凭据走 env
