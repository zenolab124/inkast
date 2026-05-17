# Gallery 瀑布流:用 `react-masonry-css`,不用 CSS columns

一句话:GalleryPage 从 `grid grid-cols-* + aspect-square` 改成 `react-masonry-css` 库做行优先(row-major)瀑布流,**不是** CSS `columns-*`——后者是列优先,违反"最新在第一行横向读"的用户预期。

## 背景

旧实现 `apps/web/src/features/gallery/GalleryPage.tsx`:
1. 容器 `grid grid-cols-*`——是网格不是瀑布流
2. 卡片图 `aspect-square + object-cover`——所有图被强制裁成正方形,1:1 / 16:9 / 9:16 看着都一样

整改时第一版用 CSS `columns-2 sm:columns-3 ...`(就是 [Gallery.tsx](../../apps/web/src/features/gallery/Gallery.tsx) 那个孤儿组件用的方案)。用户反馈"顺序变成竖着的"——CSS columns 按 DOM 顺序**先填满第一列再填第二列**,实际阅读是:

```
DOM: [1,2,3,4,5,6,7,8,9,10,11,12]  →  视觉:
┌────┬────┬────┬────┐
│  1 │  4 │  7 │ 10 │
│  2 │  5 │  8 │ 11 │
│  3 │  6 │  9 │ 12 │
└────┴────┴────┴────┘
```

最新图(1)在左上,第二新(2)**在它下面**而不是右边。用户想要的是行优先:

```
┌────┬────┬────┬────┐
│  1 │  2 │  3 │  4 │
│  5 │  6 │  7 │  8 │
│  9 │ 10 │ 11 │ 12 │
└────┴────┴────┴────┘
```

CSS columns **物理上**做不到这个。

## 方案对比

| | A. 自研分桶 | B. CSS columns | C. `react-masonry-css`(选中) |
| --- | --- | --- | --- |
| 排序 | row-major | column-major | row-major |
| 列高平衡 | 简单 `i % cols` 不平衡 | 浏览器自动 | 库自带平衡逻辑 |
| 响应式列数 | 手写 ResizeObserver | media query 内建 | breakpoint 对象 |
| 依赖体积 | 0 | 0 | ~3KB |
| 维护成本 | 自己改 bug | 0 | 库稳定 |

## 最终选择

C `react-masonry-css`。配合 [third-party-library-admission](./third-party-library-admission.md)——这种成熟功能型库直接引入。

```ts
const MASONRY_BREAKPOINTS = {
  default: 6,
  1279: 5,  // ≤1279px
  1023: 4,  // ≤1023px
  767: 3,
  639: 2,
};
```

库内部 `i % currentColumnCount` 分桶,所以**列高不绝对平衡**——但实测图片比例多样时差异可接受;若所有图都 1:1(用户默认 1024x1024 测试)看起来仍像网格,**这是物理特性不是 bug**,需要图比例多样才能体现瀑布感。

## 同时附带的改动

- 删除孤儿 `apps/web/src/features/gallery/Gallery.tsx`(180 行死代码,跟 GalleryPage 重复维护是债务)
- `GalleryCard` 去掉 `aspect-square + object-cover`,改成 `block w-full` 按原图比例展示
- 顺手删 `break-inside-avoid`(masonry 模式下不需要)

## 关联条目

- [gallery](../domains/gallery.md) — 上层数据流
- [css-columns-column-major](../pitfalls/css-columns-column-major.md) — 我们踩过的坑
- [third-party-library-admission](./third-party-library-admission.md) — 为什么直接引库
- [react-masonry-css](../integrations/react-masonry-css.md) — 库用法
