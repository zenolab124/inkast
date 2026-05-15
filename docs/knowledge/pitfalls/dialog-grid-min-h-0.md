# Dialog 内 grid 缺 min-h-0 导致 img 被裁 + 内部 scroll 失效

## 现象

`GalleryDetailDialog` 一开始的实现:
- 左侧大图被裁切,有的图根本看不见
- 右侧 prompt 字段编辑器**不能滚动**,内容超出视口直接被切

```tsx
<DialogContent className="flex max-h-[88vh] flex-col overflow-hidden p-0">
  <header>...</header>
  <div className="grid flex-1 grid-cols-1 md:grid-cols-[1fr_360px] overflow-hidden">
    <div className="flex items-center justify-center bg-background p-4">
      <img className="max-h-full max-w-full object-contain" />  ← max-h-full 失效
    </div>
    <aside className="flex flex-col border-l">
      <div className="flex-1 overflow-y-auto">  ← overflow 失效
        <PromptFieldEditor readOnly />
      </div>
    </aside>
  </div>
</DialogContent>
```

## 根因

CSS Grid 子项默认 `min-width: auto` 和 `min-height: auto`,意思是**子项至少要够大容纳其内容**(min-content 尺寸)。这与 `1fr` 的"按剩余空间分配"语义冲突:

- 左侧图片自然尺寸超过视口 → grid cell 被撑大到图片自然尺寸 → cell 的"100% 高度"变成图片自然高度 → `max-h-full` 等于图片自身高度 → **没起到限制作用,图片溢出**
- 右侧 aside 同理:`overflow-y-auto` 容器没有明确高度限制 → 内容超出时仍然撑大父容器而不是出滚动条

**`flex-1` 在 grid 上下文里只算了 grid 的 row,不会传递 min-h: 0 到 grid items。**

## 修复

每一层 grid / flex 容器都加 `min-h-0`(和需要的话 `min-w-0`),让 CSS 能"压缩"子项以遵守父级的 max-height:

```tsx
<DialogContent className="flex max-h-[88vh] flex-col overflow-hidden p-0">
  <header>...</header>
  <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[1fr_380px] overflow-hidden">
    <!--                ^^^^^^^^^ -->
    <div className="flex min-h-0 min-w-0 items-center justify-center overflow-hidden bg-background p-4">
      <!--             ^^^^^^^^^^^^^^^^^^ -->
      <img className="max-h-full max-w-full object-contain" />  ← 现在生效了
    </div>
    <aside className="flex min-h-0 flex-col overflow-hidden border-l">
      <!--             ^^^^^^^^^ -->
      <div className="min-h-0 flex-1 overflow-y-auto">  ← 现在能滚了
        <!--           ^^^^^^^ -->
        <PromptFieldEditor readOnly />
      </div>
    </aside>
  </div>
</DialogContent>
```

## 规避姿势

**任何嵌套 grid/flex 里需要 overflow-y-auto 或 max-h 限制时,沿父链每一层都加 `min-h-0`。** Tailwind 简单口诀:

> `overflow-y-auto` 不起作用 → 沿父链找 grid/flex 容器,每个都补 `min-h-0`

同样的坑在 App.tsx 的三栏主壳里也踩过(三栏每个 section 都加了 `min-h-0`),见 [three-column-accordion-layout](../decisions/three-column-accordion-layout.md)。

## 关联条目

- [gallery](../domains/gallery.md) — Dialog 在哪里用
- [three-column-accordion-layout](../decisions/three-column-accordion-layout.md) — 同源 grid 陷阱在主壳的应用
- [shadcn-primitives](../shared/shadcn-primitives.md) — Dialog 原语
