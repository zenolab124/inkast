# Plugin Gallery(Web 端浏览 plugin 通道生成图)

Web UI 里的独立 Tab,在 react-masonry 瀑布流里展示 **plugin 通道**(目前只有 SnapUB)的全部历史作品。**不再受 24h GC 约束**——v2 引入独立长期表 `plugin_gallery_items`,在 task succeeded(且为 r2 模式)的同一事务里归档,从此 gallery 跟 `plugin_tasks` GC 解耦。

## 架构

```
URL: /?tab=plugin-gallery
    │
    ▼
apps/web/src/App.tsx (SPA Tab 路由)
    │ useEffect 读 query string,双向同步
    ▼
PluginGalleryPage.tsx
    │ fetchPluginGallery({ cursor, pluginId, limit:60 })
    │ IntersectionObserver(sentinel, rootMargin:600px) → loadMore
    ▼
admin.ts  GET /admin/plugin-gallery.json (loopback only)
    │ listPluginGallery({ cursor, pluginId, limit })
    │   WHERE (created_at, id) < cursor [AND plugin_id = ?]
    │   ORDER BY created_at DESC, id DESC LIMIT ?
    │ + pluginGalleryTotal() + pluginGalleryCountsByPlugin()
    ▼
返 { items[], nextCursor, total, pluginCounts[] }
    │
    ▼
react-masonry-css(继承主 gallery 断点) + GalleryCard
    + Dialog 详情(原始 prompt 全文 + rewrite chain 列表 + promptJson)
```

**为什么走 SPA 跳转,不在 SSR dashboard 里模拟瀑布流**:初版打算用 CSS columns 等价 react-masonry-css 在 SSR HTML 里直接渲,被两次打断后定调"跳转 React 新页"——复用既有 react-masonry-css 组件比 SSR 重写 1:1 等价省维护成本,且能继承断点配置和 GalleryCard 风格。

**入口**:dashboard header 顶部一个 "插件作品图 →" chip(`/admin/plugin-stats`),点击跳 `/?tab=plugin-gallery`。

## 数据来源:`plugin_gallery_items`(长期表)

独立于 `plugin_tasks`,**不参与 24h GC**。

- 写入时机:`markTaskSucceeded(kind='r2')` 内部的 `db.transaction()` 同步 INSERT。原子保证 = task succeeded 行和 gallery 行要么都进、要么都不进。
- `INSERT OR IGNORE` 幂等(主键 = `plugin_tasks.id`,重复 backfill 安全)。
- 启动时 `initPluginAsync` → `backfillPluginGalleryFromTasks()` 把仍活着的 succeeded r2 task 一次性补进新表。**GC 已删的历史回不来**,但 deploy 后再来的新数据全部归档。
- **b64 模式不归档**:b64 task 的字节流没有公网 URL、Web 端无法重新加载,设计上 gallery 只展示有 R2 链接的成品。

## 关键字段(`PluginGalleryItem`)

| 字段 | 说明 |
|---|---|
| `id` / `pluginId` / `providerName` / `imageUrl` / `mime` | 基本信息 |
| `prompt`(全文不截断) | 调用方原始 prompt,详情面板 `<pre>` 渲染 |
| `promptJson` | LLM 产出的 merged ImagePrompt 结构 |
| `rewrittenPrompts: string[]` | 每轮 LLM 重写产物,空数组 = round-0 直接成功 |
| `successRound: 0\|1\|2\|3` | 产出本图的 rewrite 回合(0=原文 1=LLM 重写 2=指纹降级 3=色彩锚定) |
| `postReviewEdited: boolean` | post-review-edit 是否替换了图片 |
| `llmDurationMs` / `imageDurationMs` / `createdAt` | 时间戳 |

## 分页:keyset cursor

`?cursor=<createdAt>_<id>`,`(created_at < ? OR (created_at = ? AND id < ?))`。优于 offset:新数据进来不会让旧 offset 偏移,瀑布流无限滚动稳定。`nextCursor=null` 表示已到末尾。默认 `limit=60`,服务端上限 200。

## 详情 Dialog 布局

点卡片打开 `PluginGalleryDetailDialog`:

- **DialogContent**:`h-[85vh] sm:max-w-6xl`(1152px),`p-0 gap-0` 重置 shadcn 默认间距;**`sm:` 前缀必须**——否则被 base 的 `sm:max-w-lg` 默认值压回 512px(见 [shadcn-dialog-sm-max-w-lg-default](../pitfalls/shadcn-dialog-sm-max-w-lg-default.md))
- **左右拆分**:`grid grid-cols-[minmax(0,1fr)_24rem]`,左列 fr 自适应装图、右列固定 24rem(384px)装文本
- **图片**:`<img class="max-h-full max-w-full object-contain">` + 父级 `flex items-center justify-center min-h-0`——横竖图都贴边不变形,上下铺满
- **右栏**:独立 `overflow-y-auto`,内容 = chip(R 几 + 已润色 + provider + 耗时 + 时间)+ 原始 prompt 全文 + rewrite chain 每轮一卡片 + promptJson 结构化

## 关键文件

| 文件 | 职责 |
|---|---|
| `apps/api/src/storage/plugin-gallery.ts` | 长期表读写 + cursor 分页 + backfill |
| `apps/api/src/storage/plugin-tasks.ts` | `markTaskSucceeded` 内同事务双写 |
| `apps/api/src/domain/plugin-async/index.ts` | `initPluginAsync` 启动时调 backfill |
| `apps/api/src/server/routes/admin.ts` | `/admin/plugin-gallery.json` (cursor + pluginId 过滤) |
| `apps/web/src/features/plugin-gallery/PluginGalleryPage.tsx` | 无限滚动 + 详情 Dialog + chip |
| `apps/web/src/features/plugin-gallery/api.ts` | fetch 封装(cursor/limit/pluginId 透传) |

## 关联条目

- [admin-dashboard](admin-dashboard.md) — SSR dashboard,gallery 是它的 SPA 兄弟页
- [plugin-channel](plugin-channel.md) — 数据源 plugin_tasks 表(仍 24h GC,只是 gallery 不依赖它)
- [plugin-gallery-long-term-archive](../decisions/plugin-gallery-long-term-archive.md) — 拆独立成品表的决策
- [r2-direct-upload-v2.1](../decisions/r2-direct-upload-v2.1.md) — 只有 R2 路径有 image_url
- [react-masonry-css](../integrations/react-masonry-css.md) — 瀑布流组件
- [shadcn-dialog-sm-max-w-lg-default](../pitfalls/shadcn-dialog-sm-max-w-lg-default.md) — Dialog 宽度被 `sm:max-w-lg` 卡住的根因
