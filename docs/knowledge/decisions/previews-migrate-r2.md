# Sprite 预览图迁移 R2

14 张 sprite preview PNG(约 24MB)从 `apps/web/public/previews/` 迁移到 R2 `inkast-storage/previews/`,通过自定义域名 `static.124213.xyz` 提供,`field-dict.ts` 的 sprite src 改用 R2 绝对 URL。主线 + 公开版同步落地(commit 3de3af7)。

## 背景

两个独立动因叠加触发迁移:

1. **带宽瓶颈**:jdc 上行带宽仅 5Mbps,每张 PNG 1-3MB,多用户同时加载字段编辑器时明显卡顿。

2. **公开版 broken preview**:公开版 `apps/web-public` fork 主线时没有复制 `apps/web/public/previews/`(24MB 大文件不在常规 rsync 流程里),构建产物缺失这些 PNG。nginx SPA fallback `try_files $uri $uri/ /index.html` 把所有 `/previews/*.png` 请求兜底返回 `index.html`(HTTP 200 但 Content-Type: text/html),浏览器解码失败,字段编辑器预览图全显示损坏图标。详见 [pitfalls/nginx-spa-fallback-swallows-static](../pitfalls/nginx-spa-fallback-swallows-static.md)。

## 方案对比

| 方案 | 带宽 | 双端共用 | 部署依赖 |
|---|---|---|---|
| A(最终选择)| R2 绝对 URL(`static.124213.xyz`) | ✅ 同一 URL | R2 + CF 自定义域名一次配置 |
| B | 应急:把 public/previews/ cp 到 web-public | ❌ 带宽不解决 | 每次部署传 24MB |
| C | CDN 加速 jdc 静态 serve | 部分解决带宽 | 需另外配置 CDN 回源 |

## 最终选择

**A**。

**配置**:在 CF 控制台给 `inkast-storage` bucket 绑自定义域名 `static.124213.xyz`,SSL 自动签发。

**上传脚本**:`apps/api-public/scripts/upload-previews.mjs`——注入 R2 env 后用 `@aws-sdk/client-s3` 批量 `PutObject`,`ContentType: "image/png"`,`CacheControl: "public, max-age=31536000, immutable"`(一年不变)。

**代码改动**:`apps/web/src/features/prompt/field-dict.ts` 和 `apps/web-public/src/features/prompt/field-dict.ts` 6 处 sprite src 从 `/previews/<field>-<n>.png` 改为 `https://static.124213.xyz/previews/<field>-<n>.png`。主线 + 公开版同步修改,使用同一套 R2 URL。

本地 `apps/web/public/previews/` 目录暂不删除——本地 dev 如果 R2 域名异常仍可手动 fallback(但代码已写死 R2 URL,不会主动加载 public/ 下的文件)。

## 副作用

- **无 fallback**:代码写死 R2 URL;R2 服务或 `static.124213.xyz` 域名故障时,preview 图 404,字段编辑器退化到 SVG 几何占位,功能不中断但体验变差。需监控 R2 可用性。
- **追加图同样要上传**:新增 sprite sheet 时须运行 `upload-previews.mjs`,否则 R2 没有对应文件,URL 404。见 [workflows/add-sprite-preview-sheet](../workflows/add-sprite-preview-sheet.md)。
- **公开版 dist 须重 build**:迁移当天公开版重新 build + rsync 到 jdc;主线生产未在当次重新部署(主线已用 jdc 8787 跑旧 asset hash 版本,热更新非本次范围)。

## 关联条目

- [domains/sprite-previews](../domains/sprite-previews.md) — sprite 架构 + 生图约束
- [integrations/cloudflare-r2](../integrations/cloudflare-r2.md) — R2 驱动 + 凭据 + bucket 信息
- [pitfalls/nginx-spa-fallback-swallows-static](../pitfalls/nginx-spa-fallback-swallows-static.md) — 触发迁移的公开版 bug
