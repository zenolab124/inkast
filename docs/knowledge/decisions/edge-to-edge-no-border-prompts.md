# Sprite 提示词:严格边对边,无外框无 gridline

生 sprite sheet 的提示词模板**禁止任何外框 / margin / padding / gridline / cell 间距** —— 整张 1024×1024 必须被 3×3 = 9 cells 严格填满,cells 直接相邻。

## 背景

最早提示词写法:

> "A reference sheet of 9 art style swatches arranged in a strict 3×3 grid on a cream paper background, 1024×1024 pixels. Thin warm-gray gridlines between cells. Each cell is exactly 1/3 width × 1/3 height (approximately 341×341 pixels)."

实测结果:
- 模型理解"reference sheet on cream paper background"为"印刷书页",自动在整图外画一圈 paper margin
- "thin warm-gray gridlines between cells" 让 cells 之间有 5-15px 间距
- 客户端 sprite 切片按 1/3 均分,但实际 cell 不在均分位置 → 切到的内容错位

## 方案对比

| | 用 paper + gridlines | 严格边对边(选定) |
| --- | --- | --- |
| 模型守住 9 等分 | 弱(常有外框 / gap) | 强(无干扰约束) |
| 客户端切片 | 需校准每张图边界 | 标准 1/3 公式 |
| 视觉风格 | 有印刷感 | 直接画面 |
| 排错复杂度 | 高 | 低 |

## 最终选择

严格边对边,提示词加 **ABSOLUTE REQUIREMENTS** 段:

```
Generate an image of EXACTLY 1024 × 1024 pixels. The image must be completely
filled by a 3×3 grid of 9 cells laid out edge-to-edge. Each cell is exactly
341 × 341 pixels.

ABSOLUTE REQUIREMENTS — non-negotiable:
- NO outer border, NO margin, NO padding around the canvas
- NO gridlines, NO separators, NO gaps, NO frames between cells
- NO labels, NO numbers, NO captions, NO text anywhere
- The 9 cells abut one another directly, completely filling the canvas
```

## 副作用

- **失去印刷质感**:cells 边界不再有可见 gridline,但 picker 卡片层本身有 `rounded-sm + border-border/40`,视觉边界靠 UI 渲染补
- **客户端 sprite 切片仍要 inset zoom**:模型守住"9 等分边对边"约束,但 cell 边缘仍可能有 1-2 px 瑕疵(画面延伸过 cell 边界一点),所以 PreviewIcon 用 4% inset 兜底,见 [inset-zoom-on-sprite-slice](inset-zoom-on-sprite-slice.md)
- **某些字段 cells 描述对等长很重要**:边对边约束不保证 3 行 3 列高度等分 —— 模型对各 cell 描述长度敏感,见 [asymmetric-cell-descriptions](../pitfalls/asymmetric-cell-descriptions.md)
- **Blank cells 改成 "plain neutral" placeholder**:之前 Mood Sheet 2 / Lighting Sheet 2 有 3 cells 留空,模型不太守"留白"会偷偷画内容;改成"the same subject in plain neutral lighting/mood (baseline)"模型更稳定填满

## 关联条目

- [sprite-previews](../domains/sprite-previews.md)
- [sprite-sheets-over-per-option-images](sprite-sheets-over-per-option-images.md)
- [cream-paper-creates-outer-border](../pitfalls/cream-paper-creates-outer-border.md)
- [inset-zoom-on-sprite-slice](inset-zoom-on-sprite-slice.md)
- [asymmetric-cell-descriptions](../pitfalls/asymmetric-cell-descriptions.md)
- [numbers-leak-into-sprite-cells](../pitfalls/numbers-leak-into-sprite-cells.md)
