# Sprite cell 边缘像素瑕疵

**What**: 即使提示词严格要求"边对边无外框无 gridline"(见 [edge-to-edge-no-border-prompts](../decisions/edge-to-edge-no-border-prompts.md)),客户端 sprite 切片显示 cell 时,边角偶尔能看到来自邻 cell 的颜色融合 / 跨界像素 / 模糊渐变。

**Why**: 模型在 3×3 cells 严格 1/3 切分的边界,生成像素时有几像素的"边缘融合"(adjacent cells 色调互相渗透 / 内容延伸过分割线 1-2 px)。这是模型本身的栅格化精度限制——它把"网格"理解到了,但像素级边界守不严格。

**Action**: PreviewIcon 用 4% inset zoom 兜底:

```ts
const SPRITE_INSET_SCALE = 1.08; // 4% inset on each side
// sprite image 整体放大 N 倍,cell 中心居中容器中心,
// 显示的是 cell 中心 1/N ≈ 92% 部分,四角各裁掉 ~4%
```

公式见 [inset-zoom-on-sprite-slice](../decisions/inset-zoom-on-sprite-slice.md)。

**副作用**: cell 内容显示丢失 ~8%(每边各 ~4%)。极少数选项(minimalism 的"留白构图"主体本身在 cell 边缘)可能感觉被裁,但实测 4% 是平衡值——再大裁切感明显,再小边缘瑕疵仍可见。

**症状识别**: picker 卡片显示的 cell 边角有可见的"颜色跳变" / "脏边" → 大概率是 cell 边缘融合,inset 即可解决。如果偏移严重(整个图错位),那是行高/列宽不均,见 [asymmetric-cell-descriptions](asymmetric-cell-descriptions.md)。

## 关联条目

- [sprite-previews](../domains/sprite-previews.md)
- [inset-zoom-on-sprite-slice](../decisions/inset-zoom-on-sprite-slice.md)
- [edge-to-edge-no-border-prompts](../decisions/edge-to-edge-no-border-prompts.md)
- [asymmetric-cell-descriptions](asymmetric-cell-descriptions.md) — 另一种 cell 显示错位的原因
