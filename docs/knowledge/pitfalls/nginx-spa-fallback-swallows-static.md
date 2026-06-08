# nginx-spa-fallback-swallows-static — nginx SPA fallback 吞静态文件，preview 图全 404

公网访问 `/previews/type-1.png` 返回 `Content-Type: text/html`（实际内容是 `index.html`），字段编辑器选项预览图全部显示为损坏图标。

## What

公开版部署到 jdc 后，字段编辑器的 `OptionPicker` 弹窗里所有选项的 sprite 预览图均 broken。用 curl 请求 `https://inkast.124213.xyz/previews/type-1.png`，HTTP 200 但响应体是 HTML，`Content-Type: text/html`。

## Why

两个问题叠加：

1. **文件不存在**：公开版 `apps/web-public` 从主线 fork 时，`apps/web/public/previews/`（14 张 sprite sheet，共约 24MB）没有一并复制过来。`apps/web-public/public/previews/` 目录为空，`pnpm public:build` 产物里没有这些 PNG。

2. **nginx SPA fallback 兜底**：nginx `location /` 配置了 `try_files $uri $uri/ /index.html`。当请求 `/previews/type-1.png` 时，文件不存在，`try_files` 最终返回 `index.html`，响应码 200 但内容是 HTML。浏览器收到 `Content-Type: text/html` 的"PNG"后解码失败，图标显示为损坏。

前端代码在 `apps/web-public/src/features/prompt/field-dict.ts` 里以 `/previews/xxx.png` 相对路径引用，这依赖构建产物里真实存在对应文件。

## Action

**根治方案（已落地）**：把 previews 迁移到 R2，图片改为绝对 URL（`https://static.124213.xyz/previews/xxx.png`）。这样：

- nginx 根本不参与图片路由，SPA fallback 不触及静态图
- 不再依赖每次部署携带 24MB 大文件
- 同一份 R2 URL 可在主线 + 公开版共用，带宽瓶颈消失

**应急方案（如需快速修复）**：把 `apps/web/public/previews/` 里的 PNG 复制到 `apps/web-public/public/previews/`，构建后随部署 rsync 到 jdc。适合临时验证，但每次部署要传 24MB。

无论哪种方案，nginx 配置本身的 `try_files ... /index.html` 是 SPA 标准配法，不需要改；问题的根源是静态资源缺失，而不是 nginx 配置错误。

---

关联条目：[domains/sprite-previews](../domains/sprite-previews.md) · [workflows/deploy-public-edition](../workflows/deploy-public-edition.md) · [decisions/r2-direct-upload-v2.1](../decisions/r2-direct-upload-v2.1.md)
