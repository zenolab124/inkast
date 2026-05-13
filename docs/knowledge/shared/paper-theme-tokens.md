# Paper 主题 Token

整个 inkast UI 的视觉真理源。**所有视觉值通过 CSS 变量,组件里不写颜色/字体/阴影字面量**。换主题 = 换 token 文件,不改组件。详见 CLAUDE.md "视觉规范"段(锁定红线)。

## Token 全貌

`apps/web/src/styles/themes/paper.css` 定义两份(亮/暗),`globals.css` 通过 `@theme inline` 映射到 Tailwind 变量。

### 颜色(亮色)

| 语义 | 值 | Hex 近似 |
| --- | --- | --- |
| `--background` | `oklch(0.935 0.020 80)` | `#F2EBDC` 浓米色 |
| `--foreground` | `oklch(0.265 0.020 50)` | `#2A2620` 深棕墨 |
| `--card` | `oklch(0.965 0.014 80)` | `#FBF6EA` 米黄,比背景亮一档 |
| `--primary` | `oklch(0.43 0.06 145)` | `#3A5A40` 墨绿 |
| `--accent` | `oklch(0.55 0.13 28)` | `#A4453B` 砖红 |
| `--border` | `oklch(0.82 0.018 70)` | 暖灰棕 |
| `--muted-foreground` | `oklch(0.48 0.022 55)` | 棕灰 |

### 字体

```css
--font-sans:
  -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI Variable",
  "Segoe UI", "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei",
  system-ui, sans-serif;

--font-serif: var(--font-sans);  /* 故意指向同一栈,防止误用衬线 */
```

中文落 PingFang(macOS)/ Microsoft YaHei(Windows),**绝不允许落 Songti/SimSun**。

### 阴影(三层)

```css
--shadow-paper:
  0 1px 0 rgba(255, 250, 235, 0.6) inset,   /* 内高光描边(纸边反光) */
  0 1px 2px rgba(70, 45, 20, 0.10),         /* 紧贴棕投影 */
  0 2px 6px rgba(70, 45, 20, 0.06);         /* 漫射软投影 */

--shadow-paper-lifted: /* 同结构,数值翻倍,hover 时用 */
```

颜色一律 `rgba(70, 45, 20, *)` 棕调,不用中性灰——shadcn 默认灰阴影会破坏纸感。

### 圆角

```css
--radius: 0.3rem;  /* 4-6px,不要 16px+ */
```

## 全站 body 效果(在 globals.css)

`@layer base` 里给 body 加了两层固定覆盖:

1. **`body::before` — SVG fractalNoise 颗粒**
   - 7% 不透明度,`mix-blend-mode: multiply`
   - 暗色模式 10% + `screen` 混合
   - 棕调 colorMatrix,不是灰
2. **`body::after` — radial vignette**
   - 中心 35% 透明 → 边缘 `rgba(70, 45, 20, 0.12)`
   - 暗色模式边缘 `rgba(0, 0, 0, 0.50)`

子组件**禁止再叠 noise**,会变脏。

## @theme inline 映射(关键)

Tailwind v4 用 CSS-first 配置:

```css
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  /* ...所有 shadcn 语义 token */

  --font-sans: var(--font-sans);
  --radius-sm: calc(var(--radius) - 2px);
  --shadow-paper: var(--shadow-paper);
}
```

这让 `bg-background` `text-foreground` `shadow-(--shadow-paper)` `rounded-md` 等 Tailwind 工具类生效。

## 暗色 token

`.dark, .theme-paper.dark` 选择器下重写所有上述变量。**当前已知 bug**:dark class 加在 React root 内部 div,body 取不到——见 [dark-class-position-bug](../pitfalls/dark-class-position-bug.md)。

## Glass 主题占位

`themes/glass.css` 目前空壳。届时实现时**只动 token 文件**,不改组件。glass 主题允许 `backdrop-blur` + 深色渐变背景,paper 主题禁用这两件。

## 关联条目

- [tailwind-v4](../integrations/tailwind-v4.md) — Tailwind v4 配置全貌
- [paper-theme-locked](../decisions/paper-theme-locked.md) — 为什么锁定这套
- [chinese-fallback-songti](../pitfalls/chinese-fallback-songti.md) — 字体红线的起源
- [dark-class-position-bug](../pitfalls/dark-class-position-bug.md) — 暗色 bug 根因
- [update-paper-theme](../workflows/update-paper-theme.md) — 改 token 的步骤
