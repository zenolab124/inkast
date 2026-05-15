# Gallery 历史展示([作品] Tab)

历史作品从主页底部网格升级为**独立 [作品] Tab**(全屏页面)。主页(起草 Tab)只显示**本次会话生成的图**(右栏 SessionWorkspace),刷新即清空——见 [session-workspace](./session-workspace.md)。

## 架构

```
顶部 Tab: [起草] | [作品]  ← 当前在作品时
                  │
                  ▼
useEffect(refreshKey) → listGenerations(limit=200)
    │ GET /api/generations?limit=200
    ▼
items: GenerationRecord[]
    │
    ├─ Toolbar
    │    h2 "作品" + count "· N"
    │    搜索框(模糊匹配 type / style / subject)
    │    Type filter chips(取 items 里 count 前 8 的 type)
    │
    ├─ Grid (responsive: 2/3/4/5/6 cols)
    │    GalleryCard × N
    │      img + type/style/subject(2 行截断) + reuse / download
    │      点击图打开详情弹窗
    │
    └─ GalleryDetailDialog(打开时)
         · 左:大图 object-contain
         · 右:PromptFieldEditor readOnly(5 分组只读视图)
         · 底:复制 JSON / 复用 prompt / 下载图片
```

## 关键文件

| 文件 | 职责 |
| --- | --- |
| [apps/web/src/features/gallery/GalleryPage.tsx](../../../apps/web/src/features/gallery/GalleryPage.tsx) | **独立 Tab 页面**:toolbar + 搜索 + type filter + 网格 + 详情弹窗 |
| [apps/web/src/features/gallery/Gallery.tsx](../../../apps/web/src/features/gallery/Gallery.tsx) | 旧版网格组件(主页底部用),目前已不被 App 使用——保留供别处复用 |
| [apps/web/src/features/gallery/GalleryDetailDialog.tsx](../../../apps/web/src/features/gallery/GalleryDetailDialog.tsx) | 详情弹窗 |
| [apps/web/src/features/gallery/api.ts](../../../apps/web/src/features/gallery/api.ts) | `listGenerations` / `generationImageUrl` / `generateImage` |

## 筛选 / 搜索

- 搜索: 模糊匹配 type / style / subject(都 lowercase 比较)
- Type filter chips: 用 `useMemo` 算出 items 里每个 type 的 count,按 count 倒序取前 8 个
- 当前选中 chip 高亮 primary 色,其他是 outlined

## 触发刷新

`<GalleryPage>` 接收 `refreshKey: number` prop。`App.tsx` 在 job 成功(`onJobSucceeded`)后调 `setGalleryKey(k => k + 1)`,导致 GalleryPage 重新 fetch listGenerations。所以切到 [作品] Tab 时,本次会话的新作品已经在里面。

## 复用 prompt 流程

点弹窗内"复用 prompt" → `onReuse(record)` 透传到 App → App `reuseFromHistory()`:
1. `setPrompt(record.promptSnapshot)`
2. `setAiSuggested(new Set())` (历史复用不算 AI 推荐)
3. `setLockMode("ai-filled")` (展开手风琴,字段已填)
4. `setTab("draft")` (切回起草)
5. flash 提示 `reuseLoaded`

## Dialog scroll bug 修复

详情弹窗历史上有过 grid 缺 `min-h-0` 导致**大图被裁 + 右侧字段编辑器不滚动**的问题。修复见 [pitfalls/dialog-grid-min-h-0](../pitfalls/dialog-grid-min-h-0.md)。

## 已知遗漏

- ❌ 无"删除一张作品"按钮(顺手要补)
- ❌ 无虚拟滚动(性能假设 < 几百张,目前足够)

## 关联条目

- [session-workspace](./session-workspace.md) — 主页(起草 Tab)右栏的"本次工作区"(刷新清空)
- [image-generation](./image-generation.md) — 数据从哪儿来
- [field-editor](./field-editor.md) — `PromptFieldEditor readOnly` 复用
- [shadcn-primitives](../shared/shadcn-primitives.md) — Dialog + Button
- [shared-contracts](../shared/shared-contracts.md) — `GenerationRecord` 类型
- [dialog-grid-min-h-0](../pitfalls/dialog-grid-min-h-0.md) — 详情弹窗布局陷阱
