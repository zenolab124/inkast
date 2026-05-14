# Sprite 大图分格 vs 每选项独立图

字段选项的预览图用 **N 张 sprite sheet(每张 3×3 = 9 cells)**,而不是每 option 配一张独立 png。

## 背景

字段编辑器的 OptionPicker 弹窗里,要给每个选项显示真实预览图(SVG 几何占位辨识度不够)。Style 36 / Mood 15 / Lighting 15 / Camera 12 / Layout 12 / Type 15 = 总 **105 个选项**。

每个 option 单独生图意味着 105 次 API 调用,每次 30-60s,总成本 1-2 小时 + 巨额费用 + 主体一致性靠运气(105 张苹果,每张苹果都长不一样)。

## 方案对比

| | 每 option 独立图 | sprite sheet 分格(选定) |
| --- | --- | --- |
| 生图次数 | 105 | 14 |
| 主体一致性 | 各画各的 | 同 sheet 内 9 cells 同一主体,跨 sheet 靠 reference 链 |
| 文件数 | 105+ | 14 |
| 客户端切片复杂度 | 0 | CSS sprite + 公式计算 |
| 单选项更新成本 | 重生那一张 | 重生整张 sheet(9 个一组) |
| 跨字段统一画风 | 难 | 同字段 sheet 内有保证 |

## 最终选择

sprite sheet。

- 每张 1024×1024,3×3 = 9 cells(每 cell ~341px,picker 卡片 140px 显示足够清晰)
- 105 选项 → 14 张 sheet:Style 4 / Mood 2 / Lighting 2 / Camera 2 / Layout 2 / Type 2
- Sheet 2/3/4 用 Sheet 1 作 reference image,主体一致性飙升(见 [reference-image-via-edit](reference-image-via-edit.md))
- 客户端 PreviewIcon 用 CSS `background-image + background-size + background-position` 切片,无 JS 解析
- field-dict.ts 里 `FieldOption.sprite = { src, cols, rows, index }` 标坐标

## 副作用

- **单选项更新麻烦**:想换"水墨"那一格,要重生整张 mood-2.png。但实测每张 sheet 几分钟生完,可接受
- **客户端切片公式**:见 [inset-zoom-on-sprite-slice](inset-zoom-on-sprite-slice.md)
- **生图必须严格 9 等分**:模型对网格约束不天然守住,需要明确"无外框无 gridline 边对边",见 [edge-to-edge-no-border-prompts](edge-to-edge-no-border-prompts.md)
- **同字段同 cell 描述对等长**:否则模型给"复杂内容"更多空间,行高/列宽不均,见 [asymmetric-cell-descriptions](../pitfalls/asymmetric-cell-descriptions.md)

## 关联条目

- [sprite-previews](../domains/sprite-previews.md) — 实现
- [reference-image-via-edit](reference-image-via-edit.md) — 主体一致性引擎
- [edge-to-edge-no-border-prompts](edge-to-edge-no-border-prompts.md)
- [inset-zoom-on-sprite-slice](inset-zoom-on-sprite-slice.md)
- [square-sprite-cells](square-sprite-cells.md)
