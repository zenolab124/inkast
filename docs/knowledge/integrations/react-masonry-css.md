# `react-masonry-css` — 行优先瀑布流

轻量(~3KB)CSS-only masonry 库,Gallery 用它做行优先瀑布流(替代 CSS `column-count`)。

## 选型原因

详见 [masonry-row-major-library](../decisions/masonry-row-major-library.md)。一句话:CSS `column-count` 是**列优先**填充,违反"最新作品在第一行从左到右"的用户预期;`react-masonry-css` 用 `i % cols` 分桶达到**行优先**。

## 使用方式

`apps/web/src/features/gallery/GalleryPage.tsx`:

```tsx
import Masonry from "react-masonry-css";

const MASONRY_BREAKPOINTS = {
  default: 6,    // viewport > 1279
  1279: 5,       // viewport <= 1279
  1023: 4,       // viewport <= 1023
  767: 3,        // viewport <= 767
  639: 2,        // viewport <= 639
};

<Masonry
  breakpointCols={MASONRY_BREAKPOINTS}
  className="-ml-3 flex w-auto"
  columnClassName="bg-clip-padding pl-3"
>
  {items.map(it => <GalleryCard key={it.id} record={it} ... />)}
</Masonry>
```

每个 card 里加 `mb-3` 控制纵向间距(masonry 库不管列内 gap)。

## breakpoint 逻辑

库内逻辑:`windowWidth <= optBreakpoint` 时用对应列数,匹配**最小**的那个。`default` 是兜底(viewport 大于所有 keys)。

对齐 Tailwind:

- < 640: 2 列
- 640–767: 3 列
- 768–1023: 4 列
- 1024–1279: 5 列
- ≥ 1280: 6 列(default)

## 容器/列样式约定

- `-ml-3 flex w-auto` 在容器:负 margin 补偿子列 padding
- `bg-clip-padding pl-3` 在每个列:`pl-3` 是列间距;`bg-clip-padding` 防止背景色穿透 padding(若以后给列加背景)

## 限制

- **列高不绝对平衡** — `i % cols` 分桶,各列高度依赖每张图的实际比例。多样比例时差异自然平滑;若所有图同比例(全 1:1),看着仍像规整网格——物理特性不是 bug
- **React 18 children type 兼容** — 库 `index.d.ts` 是老版本 React 类型,React 18 下用没问题但 TS 严格时会有警告(已实测无 error)
- **不支持 SSR 初始列数** — 首屏依赖 `window.innerWidth`,SSR 时 fallback 用 `default` 列数。inkast 是 SPA 不受影响

## 已知版本

`react-masonry-css@^1.0.16`。

## 关联条目

- [masonry-row-major-library](../decisions/masonry-row-major-library.md) — 选型决策
- [css-columns-column-major](../pitfalls/css-columns-column-major.md) — 不用 CSS columns 的原因
- [gallery](../domains/gallery.md) — 消费方
- [third-party-library-admission](../decisions/third-party-library-admission.md) — 库引入策略
