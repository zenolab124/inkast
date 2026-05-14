# 新增字段或刷新 sprite preview sheet

字段编辑器 OptionPicker 的真实预览图来自 sprite sheet。新增字段 / 加选项 / 重做某张 sheet 都走这套流程。

## 步骤

### 1. 改字段词典

`apps/web/src/features/prompt/field-dict.ts`,**为每个选项加 sprite 配置**:

```ts
const style = (n: number, i: number) => ({
  src: `/previews/style-${n}.png`,
  cols: 3, rows: 3, index: i,
});

export const STYLE_OPTIONS: FieldOption[] = [
  { key: "realistic_photo", zh: "写实摄影", en: "Realistic photo",
    descZh: "照片级真实", descEn: "Photo-realistic",
    sprite: style(1, 0) },
  // ...
];
```

约定:每张 sheet 3×3 = 9 cells,1024×1024。选项不够 9 个就 baseline 占位(模型对"留 N 空白"约束守不住,改成"plain neutral 同主体"占位)。

### 2. 写提示词

模板(具体见 `prototype/` 内的历史提示词):

```
Generate an image of EXACTLY 1024 × 1024 pixels. The image must be completely
filled by a 3×3 grid of 9 cells laid out edge-to-edge. Each cell is exactly
341 × 341 pixels.

ABSOLUTE REQUIREMENTS — non-negotiable:
- NO outer border, NO margin, NO padding around the canvas
- NO gridlines, NO separators, NO gaps, NO frames between cells
- NO labels, NO numbers, NO captions, NO text anywhere
- The 9 cells abut one another directly, completely filling the canvas

Every cell shows THE SAME subject — [详细主体描述,几条款约束保持一致性].

Cells, left-to-right top-to-bottom:
- Top-left: [描述 1]
- Top-center: [描述 2]
- Top-right: [描述 3]
- Middle-left: [描述 4]
- Middle-center: [描述 5]
- Middle-right: [描述 6]
- Bottom-left: [描述 7]
- Bottom-center: [描述 8]
- Bottom-right: [描述 9]
```

**注意**:
- 用 "Top-left / Top-center / ..." 描述位置,**不用数字编号**(数字会被画进 cell,见 [numbers-leak-into-sprite-cells](../pitfalls/numbers-leak-into-sprite-cells.md))
- 每 cell 描述长度**保持对等**(否则行高列宽不均,见 [asymmetric-cell-descriptions](../pitfalls/asymmetric-cell-descriptions.md))
- Sheet 2/3/4 用 Sheet 1 作 reference image,主体一致性靠它

### 3. 生图

inkast 当前 OpenAI 兼容 provider 跑提示词。**Sheet 1 不用参考图**,**Sheet 2/3/4 选 Sheet 1 作参考图**(ReferencePicker → 作品库 → 选 Sheet 1)。

每张 sheet 1024×1024,生成时间 1-5 分钟(取决于上游模型)。

### 4. 复制图

```bash
# Sheet 1 (已生成,假设 generation id 是 <ID>)
cp data/images/<yyyy>/<mm>/<file>.png apps/web/public/previews/style-1.png
```

**当前是手工 cp**,Gallery 详情弹窗可考虑加"设为 sprite"按钮自动化。

### 5. 验证

刷新页面 → 打开 Style 字段 picker → 检查所有 cells 显示正确。如果错位 / 内容混入相邻 cell:
- 行高列宽不均 → 重生图,加强 SIZE RULE 约束(见 [asymmetric-cell-descriptions](../pitfalls/asymmetric-cell-descriptions.md))
- 有外圈 paper margin → 重生图,加强 ABSOLUTE REQUIREMENTS(见 [cream-paper-creates-outer-border](../pitfalls/cream-paper-creates-outer-border.md))
- 数字泄漏到画面 → 重生图,提示词改 Top-left 位置描述(见 [numbers-leak-into-sprite-cells](../pitfalls/numbers-leak-into-sprite-cells.md))
- 边缘瑕疵 → PreviewIcon `SPRITE_INSET_SCALE` 已经 4% inset 兜底,大概率看不见

### 6. 更新 i18n(选项 label 如果是新加的)

如果新加选项,`apps/web/src/i18n/zh.ts` / `en.ts` 通常不用动(字段词典本身双语)。

## 关联条目

- [sprite-previews](../domains/sprite-previews.md)
- [field-dictionary](../shared/field-dictionary.md)
- [edge-to-edge-no-border-prompts](../decisions/edge-to-edge-no-border-prompts.md)
- [reference-image-via-edit](../decisions/reference-image-via-edit.md)
- [asymmetric-cell-descriptions](../pitfalls/asymmetric-cell-descriptions.md)
- [numbers-leak-into-sprite-cells](../pitfalls/numbers-leak-into-sprite-cells.md)
- [cream-paper-creates-outer-border](../pitfalls/cream-paper-creates-outer-border.md)
