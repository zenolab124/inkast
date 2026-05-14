# 字段词典 field-dict.ts

字段编辑器 + OptionPicker 的"选项数据库"。**6 个字段共 105 个选项**,每个选项有 zh/en label + zh/en 描述 + sprite 坐标。

## 文件

[apps/web/src/features/prompt/field-dict.ts](../../../apps/web/src/features/prompt/field-dict.ts)

## 核心类型

```ts
type Lang = "zh" | "en";
type AspectRatio = "1:1" | "2:3" | "3:2" | "16:9" | "9:16";

interface SpriteCell {
  src: string;     // 路径 e.g. "/previews/style-1.png"
  cols: number;    // 3
  rows: number;    // 3
  index: number;   // 0-8(左→右,上→下)
}

interface FieldOption {
  key: string;     // 唯一标识(代码内查找用)
  zh: string;      // 中文 label
  en: string;      // 英文 label
  descZh?: string; // 中文简短描述
  descEn?: string; // 英文简短描述
  aspect?: AspectRatio;  // 默认 1:1,sprite 路径忽略此字段
  sprite?: SpriteCell;   // 真实预览图坐标
}

type FieldId =
  | "type" | "style" | "mood" | "lighting" | "camera" | "layout"
  | "text_position" | "text_font" | "text_size";
```

## 6 个主字段(picker 用 sprite)

| FieldId | 选项数 | sprite 数 | 主体 |
| --- | --- | --- | --- |
| `style` | 36 | 4 张(style-1..4) | 红 Honeycrisp 苹果 |
| `mood` | 15(6+3 baseline) | 2 张(mood-1..2) | 森林木屋 |
| `lighting` | 15(6+3 baseline) | 2 张(lighting-1..2) | 哑光白瓷瓶 |
| `camera` | 12(3+6 baseline) | 2 张(camera-1..2) | 田野小屋 |
| `layout` | 12(3+6 baseline) | 2 张(layout-1..2) | 红苹果 + 构图变体 |
| `type` | 15(6+3 baseline) | 2 张(type-1..2) | 多主体(海报/插画/icon...) |

## 3 个子字段(text_elements 内用 Combobox,无 sprite)

| FieldId | 选项数 | 用途 |
| --- | --- | --- |
| `text_position` | 12 | 文字位置(top-left / center / bottom-right / ...) |
| `text_font` | 9 | 字体风格(handwriting / serif / pixel / ...) |
| `text_size` | 5 | 字号(xlarge → xsmall) |

## 调色板预设(独立)

`PALETTE_PRESETS` 8 组配色:Morandi 灰 / Monet 蓝紫 / 自然森林 / 夕阳粉橙 / 黑白灰 / 中国朱砂 / 深海蓝 / 米色复古。每个 `{ key, zh, en, colors: string[] }`。

## Helpers

```ts
localizedLabel(opt, lang)  → opt[lang]
localizedDesc(opt, lang)   → lang === "zh" ? opt.descZh : opt.descEn
findOptionKey(options, value) → 反向查 key:value(用户输入)匹配 zh / en label
aspectStyle(aspect)        → CSS aspect-ratio 字符串("1 / 1" / "2 / 3" / ...)
```

## 一致性约定

- **每张 sprite sheet 都是 3×3 = 9 cells**,1024×1024 严格边对边
- 字段词典里某 sheet 引用的 index 是 0-N,**未引用的 index**(如 Sheet 2 后 3 baseline cells)在 sprite 图上仍要画内容(不能留白),否则模型守不住 9 等分约束。见 [edge-to-edge-no-border-prompts](../decisions/edge-to-edge-no-border-prompts.md)
- 新增 / 修改选项需同步:field-dict 改数据 → sprite 提示词改 → 重生 → 复制图

## 关联条目

- [field-editor](../domains/field-editor.md)
- [sprite-previews](../domains/sprite-previews.md)
- [add-sprite-preview-sheet](../workflows/add-sprite-preview-sheet.md)
- [i18n-dictionary](i18n-dictionary.md)
