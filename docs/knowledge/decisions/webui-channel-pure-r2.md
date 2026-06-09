# Web UI 通道生图改纯 R2(不留本地)

主线 Web UI 通道(jobs/generations)生图从"写本地磁盘"改为"纯 R2 直传、不留本地副本",与 plugin 通道架构统一。2026-06-09 上线(部署 v2.43)。

## 背景

Web UI 通道生图一直写本地 `<DATA_DIR>/images/YYYY/MM/<uuid>.png`,前端展示历史图走 `/api/generations/:id/image` 由后端 `readImageBytes` 流式 serve —— **每张缩略图/大图都过 jdc 5 Mbps 上行**。而 plugin 通道早在 v2.1 就纯 R2 直传([r2-direct-upload-v2.1](r2-direct-upload-v2.1.md)),previews 静态图也迁了 R2([previews-migrate-r2](previews-migrate-r2.md))。Web UI 通道是最后一个还吃 jdc 上行的图片来源。

## 方案对比

| | A · 双写 | **B · 纯 R2(选中)** | C · 双写 + 迁存量 |
|---|---|---|---|
| 本地图 | 保留 | 不留 | 保留 |
| 存量历史图 | 不迁,前端 fallback 本地 | 必须迁移 | 一次性脚本全量迁 |
| 参考图功能 | 不动(读本地) | 必须改(fetch CDN) | 不动 |
| R2 挂时 | 降级本地,生图不受影响 | **该次生图失败** | 降级本地 |
| jdc 本地磁盘 | 继续增长 | 释放(删存量) | 继续增长 |
| 改动量 | 小 | 大 | 中 |

## 最终选择

**B · 纯 R2**(用户在知情代价后拍板)。理由:与 plugin 通道(本就纯 R2、失败即 `r2_upload_failed`)架构统一;彻底释放 jdc 上行 + 本地磁盘。代价明确接受:**丢本地兜底,R2 成为 Web UI 生图的硬依赖**。

实现关键(`apps/api/src/domain/generate/index.ts` 的 `persistImage()`):

- `enabled = R2 凭据齐`(bucket/base 有默认值,实质只看 `R2_*` 三件)—— jdc 已有凭据,部署即纯 R2;**dev 无凭据自动降级写本地**,开发链路不被拖死
- 纯 R2 上传失败抛 `ImageGenError`(对齐 plugin 的 `r2_upload_failed`)
- `image_path` 存 R2 key、新增 `image_url` 存公开 URL;`/api/generations/:id/image` 有 url 则 302 重定向(**前端零改动**)
- 参考图 `resolveReferenceImage` 的 generation 分支改 `fetch` CDN 拉字节(纯 R2 无本地文件)

## 副作用

- **R2 不可用 = Web UI 生图全部失败**(无本地兜底)。这是"纯"的代价,与 plugin 通道一致,可接受
- **dev 行为分叉**:本地无凭据写本地、生产有凭据纯 R2 —— 同一份代码两种落点,靠 `enabled` 区分
- **参考图依赖 jdc 出站**:以历史图当参考图,后端要 `fetch static.124213.xyz`,依赖 jdc→CDN 可达(生产已验证)
- **存量需迁移**:114 张本地图一次性迁 R2 后才能删本地,见 [migrate-webui-images-to-r2](../workflows/migrate-webui-images-to-r2.md)

## 关联

- [image-generation](../domains/image-generation.md) — persistImage 端到端
- [cloudflare-r2](../integrations/cloudflare-r2.md) — R2 driver + webui/ 路径
- [r2-direct-upload-v2.1](r2-direct-upload-v2.1.md) — plugin 通道纯 R2(本决策对齐的先例)
- [previews-migrate-r2](previews-migrate-r2.md) — previews 静态图迁 R2
- [reference-image](../domains/reference-image.md) — 参考图改 fetch CDN
- [migrate-webui-images-to-r2](../workflows/migrate-webui-images-to-r2.md) — 存量迁移流程
