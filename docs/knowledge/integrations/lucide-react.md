# `lucide-react` — 图标库

inkast 唯一引入的图标库。Phase 1 用到的图标按出现频率:`Loader2 / X / Plus / Check / RotateCcw / Sparkles / Lightbulb / Feather / ImagePlus / ImageIcon / Download / Settings / AlertCircle / CheckCircle2 / Pencil / Trash2 / KeyRound / Save / Copy / RefreshCw`。

## 使用约定

```tsx
import { Sparkles, Loader2 } from "lucide-react";

<Sparkles className="size-4 text-primary" strokeWidth={1.5} />
<Loader2 className="size-3.5 animate-spin" strokeWidth={1.75} />
```

### 尺寸

`size-4` (16px) 是主流,`size-3.5` (14px) 用于按钮内嵌图标,`size-5` (20px) 用于 header logo。**不用 width/height props**,统一走 Tailwind size utility。

### strokeWidth

- `1.5` — 标题级、装饰性(`<Feather>` logo、卡片头部 `<Sparkles>`)
- `1.75` — 默认值,正文/按钮里的图标
- `2.5` — 强调勾选(`<Check>` 已采纳态)

视觉规范不显式列 strokeWidth 红线,但**实操中 1.5/1.75/2.5 是约定**,统一感来自这个。

### 颜色

颜色走 token:`text-primary` / `text-accent` / `text-muted-foreground` / `text-destructive`。**不直接 `stroke="#xxx"`**(违反 paper 主题红线)。

### 动画

只用过 `animate-spin`(Loader2)。需要新动画时,用 Tailwind 的 `animate-*` 工具类,不在图标上写 inline style。

## 已知版本

`^0.468.0`(实测无 peer 冲突)。

## 关联条目

- [paper-theme-tokens](../shared/paper-theme-tokens.md)
- [paper-theme-locked](../decisions/paper-theme-locked.md)
