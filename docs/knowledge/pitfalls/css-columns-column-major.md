# CSS `columns-*` 瀑布流是**列优先**填充,不是行优先

## 现象

Gallery 用 Tailwind `columns-2 sm:columns-3 md:columns-4 lg:columns-5 xl:columns-6` 实现瀑布流后,作品顺序"变成竖着的"——最新图(数组第一项)在左上角,**第二新在它正下方**,不是右边。

```
DOM 顺序: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
视觉:
┌────┬────┬────┬────┐
│  1 │  4 │  7 │ 10 │
│  2 │  5 │  8 │ 11 │
│  3 │  6 │  9 │ 12 │
└────┴────┴────┴────┘
```

用户期望的"最新图在第一行从左到右"做不到。

## 根因

CSS `column-count` 是浏览器原生的"文本分栏"特性,语义是**先填满第一列再填第二列**(像报纸排版)。这是 CSS 规范的本质行为,不是 bug,无法通过任何 CSS 属性翻转——它是 **column-major**(列优先)分配。

如果要 **row-major**(行优先,人类阅读期望),必须用 JS 分桶或专门的瀑布流库。

## 规避

不要用 CSS columns 做"以阅读顺序为准"的瀑布流。两条:

1. **简易自研 JS 分桶**:`items[i % colCount]` 把项目轮询塞进 N 列数组,每列内部按 DOM 顺序堆叠。缺点:列高不平衡(取决于图比例)
2. **成熟库** `react-masonry-css`:自带 `i % cols` 分桶 + 响应式 + bundle ~3KB。**inkast 选这条**(详见 [masonry-row-major-library](../decisions/masonry-row-major-library.md))

特殊情况:如果**所有图都是同样的宽高比**(比如全 1:1),无论 row-major 还是 column-major 看起来都像规整网格——瀑布感本身就需要"图比例多样"才能体现。这不是 bug,是物理特性。

## 关联条目

- [masonry-row-major-library](../decisions/masonry-row-major-library.md) — 我们的对策
- [react-masonry-css](../integrations/react-masonry-css.md) — 库用法
- [gallery](../domains/gallery.md) — 消费方
