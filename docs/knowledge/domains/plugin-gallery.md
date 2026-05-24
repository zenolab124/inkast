# Plugin Gallery(Web 端浏览 plugin 通道生成图)

Web UI 里的独立 Tab,在 react-masonry 瀑布流里展示 **plugin 通道**(目前只有 SnapUB)最近 24h 内生成的图。**24h 是硬约束**——因为 `plugin_tasks` 表受 GC 强约束(`gcOldPluginTasks` 每小时扫一次,删终态 24h 前的行),GalleryPage header 上必须写明这一点,不能让用户期待长期作品库。

## 架构

```
URL: /?tab=plugin-gallery
    │
    ▼
apps/web/src/App.tsx (SPA Tab 路由)
    │ useEffect 读 query string,双向同步
    ▼
PluginGalleryPage.tsx
    │ swr/fetch GET /admin/plugin-gallery.json
    ▼
admin.ts:113  /admin/plugin-gallery.json (loopback only)
    │ list plugin_tasks WHERE status='succeeded' AND image_url IS NOT NULL
    │   ORDER BY created_at DESC LIMIT 100
    ▼
返 [{ task_id, image_url, prompt(60 字截断), success_round,
      post_review_edited, plugin_id, created_at }]
    │
    ▼
react-masonry-css(继承主 gallery 断点)
    + GalleryCard(复用主 gallery 卡片风格)
```

**为什么走 SPA 跳转,不在 SSR dashboard 里模拟瀑布流**:初版打算用 CSS columns 等价 react-masonry-css 在 SSR HTML 里直接渲,被两次打断后定调"跳转 React 新页"——复用既有 react-masonry-css 组件比 SSR 重写 1:1 等价省维护成本,且能继承断点配置和 GalleryCard 风格。

**入口**:dashboard header 顶部一个 "插件作品图 →" chip(`/admin/plugin-stats`),点击跳 `/?tab=plugin-gallery`。

## 关键文件

| 文件 | 职责 |
|---|---|
| `apps/web/src/features/plugin-gallery/PluginGalleryPage.tsx` | 整页 UI,加载状态、错误提示、masonry 排版 |
| `apps/web/src/features/plugin-gallery/api.ts` | fetch 封装(走相对路径,Vite dev proxy 转发到 8787) |
| `apps/web/src/App.tsx` | Tab 路由 + URL query 双向同步 |
| `apps/api/src/server/routes/admin.ts:113` | `/admin/plugin-gallery.json` endpoint |

## 数据来源

只查 `plugin_tasks.image_url IS NOT NULL` 的行(R2 直传 v2.1 路径产物)。**b64 路径**(老协议)的 task 不出现在 gallery 里——它们的图存在 `plugin_tasks.b64_json`,Web 端去拉这个字段会让 SSR/JSON payload 暴涨,设计上 gallery 只展示有公网 URL 的。

## 关联条目

- [admin-dashboard](admin-dashboard.md) — SSR dashboard,gallery 是它的 SPA 兄弟页
- [plugin-channel](plugin-channel.md) — 数据源 plugin_tasks 表
- [r2-direct-upload-v2.1](../decisions/r2-direct-upload-v2.1.md) — 只有 R2 路径有 image_url
- [react-masonry-css](../integrations/react-masonry-css.md) — 瀑布流组件
