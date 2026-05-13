# JsonTreeView 组件

`apps/web/src/features/prompt/JsonTreeView.tsx` 一个递归 JSON 字段化渲染组件,用于:
- `PromptDraftView` 显示 LLM 起草的 prompt
- `GalleryDetailDialog` 显示历史 prompt 详情

## 渲染规则

| 数据 | 渲染 |
| --- | --- |
| `null` / `undefined` | `∅` 灰字 |
| `string` | `text-foreground` 文本 |
| `number` / `boolean` | `text-primary` 高亮 |
| `string[]` 且全是 hex 颜色(`/^#[0-9a-f]{3,8}$/i`) | **色板**:每色小方块 + hex label 行 |
| 其他数组 | 缩进,每项前缀 `[i]` |
| object | key-value 行;value 复杂时换行 + 左竖线缩进 |
| 空对象/空数组 | `{ }` / `[ ]` 灰字 |

## 色板特殊渲染(关键差异化)

color_palette 字段在 imagegen 方法论里几乎必填。被检测为色板时:

```tsx
<span className="size-3 rounded-xs border" style={{ backgroundColor: hex }} />
<code>{hex}</code>
```

每个 hex 一个 swatch,**不依赖 Tailwind 颜色变量**——这是少数允许 inline style 颜色的地方(hex 是数据,不是设计 token)。

## key 渲染

字段名 `text-xs font-medium uppercase tracking-wider text-muted-foreground`,模仿 imagegen reference 文档里的小标签风格。

## 关联条目

- [prompt-composer-loop](../domains/prompt-composer-loop.md) — 在 PromptDraftView 里用
- [gallery](../domains/gallery.md) — 在详情弹窗里用
- [shared-contracts](./shared-contracts.md) — `ImagePrompt` 的开放结构
