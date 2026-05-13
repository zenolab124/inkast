# Gallery 历史展示

本地落盘的所有生成图都按时间倒序展示在主页下方的网格里。点击卡片打开详情弹窗,提供完整 JSON、复制、下载、复用四种操作。

## 架构

```
useEffect(refreshKey) → listGenerations(limit=100)
    │ GET /api/generations?limit=100
    ▼
items: GenerationRecord[]
    │
    ├─ <Gallery> 网格(grid-cols-2/3/4 响应式)
    │    └─ <GalleryCard>
    │         ├─ <img src={generationImageUrl(id)} loading="lazy">  ← 点击打开详情
    │         ├─ type/style/subject 三行截断
    │         └─ 复用 / 下载 图标按钮
    │
    └─ <GalleryDetailDialog open={openRecord !== null}>
         ├─ 大图(object-contain,保持比例)
         ├─ JsonTreeView(完整 prompt JSON)
         ├─ 复制 JSON 按钮(navigator.clipboard)
         └─ 下载 / 复用 prompt 按钮
```

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `apps/web/src/features/gallery/Gallery.tsx` | 网格 + 卡片 + 状态(items / openRecord) |
| `apps/web/src/features/gallery/GalleryDetailDialog.tsx` | 详情弹窗 |
| `apps/web/src/features/gallery/api.ts` | `listGenerations` / `generationImageUrl` / `generateImage` |
| `apps/web/src/features/prompt/JsonTreeView.tsx` | 详情弹窗里渲染 prompt 用同一个组件 |

## 触发刷新

`Gallery` 接收 `refreshKey: number` prop。`App.tsx` 在生图成功后调 `setGalleryKey(k => k + 1)`,触发重新 fetch。

## 卡片摘要字段

每张卡片显示三行(从 `record.promptSnapshot` 取):

1. `type` — 大写小标签(uppercase,11px)
2. `style` — 一行截断
3. `subject` — 两行截断 (`stringifyMaybeObject`:string 直接用,object 取 `.description` 或整体 stringify)

## 复用 prompt 流程

点弹窗内"复用 prompt" → `onReuse(record)`(从 Gallery 透传到 App)→ App 把 `record.promptSnapshot` 包成假 `PromptDraft`(hints=[]) 注入 `state` → 关闭弹窗 → 用户调整后再生图。

## 已知遗漏

- ❌ 无"删除一张作品"按钮(顺手要补)
- ❌ 无搜索/过滤(数量多时再做)
- ❌ 无虚拟滚动(性能假设 < 几百张,目前足够)

## 关联条目

- [image-generation](./image-generation.md) — 数据从哪儿来
- [json-tree-view](../shared/json-tree-view.md) — JSON 树渲染组件
- [shared-contracts](../shared/shared-contracts.md) — `GenerationRecord` 类型
