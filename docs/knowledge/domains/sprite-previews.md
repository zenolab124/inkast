# Sprite 预览图(字段选项的真实图)

字段编辑器的 OptionPicker 弹窗里,每个选项都显示一张真实小图——不是字符串列表,不是 SVG 几何占位。**14 张 sprite sheet 覆盖 105 个选项**,所有 sprite 都是 1024×1024 的 3×3 网格(每 cell ~341×341)。

## 架构

```
field-dict.ts (FieldOption)
  ├── { key, zh, en, descZh, descEn }                       — 基本元数据 + 双语
  ├── aspect?: AspectRatio                                  — 容器比例(默认 1:1,sprite 模式忽略)
  └── sprite?: { src, cols, rows, index }                   — 雪碧图坐标

apps/web/public/previews/
  ├── style-1.png ... style-4.png       — 36 个画风(分基础/东方古典/设计卡通/电影数字 4 主题)
  ├── mood-1.png, mood-2.png            — 15 mood(冷暖戏剧 / 紧张浪漫;后 3 cell 中性占位)
  ├── lighting-1.png, lighting-2.png    — 15 lighting(自然戏剧 / 室内特殊;后 3 cell 中性占位)
  ├── camera-1.png, camera-2.png        — 12 camera(景别+角度+镜头 / POV+鱼眼+微距;后 6 cell 占位)
  ├── layout-1.png, layout-2.png        — 12 layout(9 经典构图 / 分布式 + 6 baseline)
  └── type-1.png, type-2.png            — 15 type(印刷品牌 / 产品角色互动;后 3 cell 占位)

PreviewIcon (apps/web/src/features/prompt/PreviewIcon.tsx)
  ├── sprite 存在 → SpritePreview
  │     ├── 容器 aspectRatio = `${rows} / ${cols}`(3/3 → 1:1)
  │     ├── backgroundSize = (cols * 100 * N)% (rows * 100 * N)%,N = SPRITE_INSET_SCALE = 1.08
  │     ├── backgroundPosition: P = 100 * [(idx+0.5)*N - 0.5] / (count*N - 1)
  │     └── 4% inset 兜底模型边缘 pixel 瑕疵
  └── sprite 缺失 → SVG 几何占位(30+ shape 模板 + 主色副色)
```

## 关键文件

| 文件 | 职责 |
| --- | --- |
| [apps/web/src/features/prompt/PreviewIcon.tsx](../../../apps/web/src/features/prompt/PreviewIcon.tsx) | `PreviewIcon` 分流(sprite vs SVG)+ `SpritePreview` CSS sprite + 12 种 shape renderer + 各 field 预设字典 |
| [apps/web/src/features/prompt/field-dict.ts](../../../apps/web/src/features/prompt/field-dict.ts) | `SpriteCell` 类型 + 6 字段 sprite 配置 + `aspectStyle` helper + `findOptionKey` 用户值反查 key |
| [apps/web/public/previews/](../../../apps/web/public/previews/) | 14 张 sprite sheet(model 生成 + 手工 cp) |

## 生图约束(关键)

提示词模板必须明确**严格 9 等分,边对边,无外框,无 gridline**——否则模型给整图加 paper-backing border 或在 cells 间加 gridline,sprite 切片就乱。

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

详见 [edge-to-edge-no-border-prompts](../decisions/edge-to-edge-no-border-prompts.md) 和 [cream-paper-creates-outer-border](../pitfalls/cream-paper-creates-outer-border.md)。

## 一致性靠 reference 链

- **Sheet 1** 直接生图(无参考)
- **Sheet 2/3/4** 用 Sheet 1 作 reference image —— 模型 `images.edit` 模式下保留 Sheet 1 的主体形态/构图/画风,只换 cell 内容(画风 / mood / lighting / etc)。见 [reference-image](reference-image.md)
- 这把"主体一致性"从"靠提示词约束"升级到"靠参考图视觉传递",效果质变

## 同字段 cell 描述要等长

模型潜意识把"复杂 cell"塞更大空间——如果 9 cells 描述长度悬殊,行/列高会不均。Type Sheet 1 第一次生时第一行被压扁就是这个原因。Fix:每 cell 描述压到 1 行,字数对等,反复重申 "ALL 9 CELLS MUST BE PIXEL-IDENTICAL IN SIZE"。见 [asymmetric-cell-descriptions](../pitfalls/asymmetric-cell-descriptions.md)。

## 后续优化

- 真图同步流程目前**手工 cp**(从 `data/images/<yyyy>/<mm>/<uuid>.png` → `public/previews/<field>-<n>.png`)。可以做一个 "Set as sprite" Gallery 操作把它自动化
- Type 字段曾考虑用 2:3 / 3:2 aspect 表达 poster / banner 形状,后来统一回 1:1 见 [square-sprite-cells](../decisions/square-sprite-cells.md)

## 关联条目

- [sprite-sheets-over-per-option-images](../decisions/sprite-sheets-over-per-option-images.md) — sprite 设计的"为什么"
- [edge-to-edge-no-border-prompts](../decisions/edge-to-edge-no-border-prompts.md) — 画布约束
- [inset-zoom-on-sprite-slice](../decisions/inset-zoom-on-sprite-slice.md) — 4% 缩进兜底
- [square-sprite-cells](../decisions/square-sprite-cells.md) — Type 字段也用 1:1
- [reference-image](reference-image.md) — Sheet 2/3/4 一致性靠它
- [add-sprite-preview-sheet](../workflows/add-sprite-preview-sheet.md) — 操作流程
- [asymmetric-cell-descriptions](../pitfalls/asymmetric-cell-descriptions.md)
- [numbers-leak-into-sprite-cells](../pitfalls/numbers-leak-into-sprite-cells.md)
- [cream-paper-creates-outer-border](../pitfalls/cream-paper-creates-outer-border.md)
- [sprite-cell-edge-artifacts](../pitfalls/sprite-cell-edge-artifacts.md)
