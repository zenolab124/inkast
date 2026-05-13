# Tailwind CSS v4 — CSS-First 配置

inkast 用 Tailwind v4,**没有 `tailwind.config.ts`**——所有配置在 `globals.css` 的 `@theme inline` 块里。

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `apps/web/vite.config.ts` | `tailwindcss()` Vite 插件挂载 |
| `apps/web/src/styles/globals.css` | `@import "tailwindcss"` + `@theme inline` 映射 + `@layer base` |
| `apps/web/src/styles/themes/paper.css` | 真理源 CSS 变量 |
| `apps/web/components.json` | shadcn 配置(指向 globals.css + neutral baseColor) |

## CSS-First 配置范式

v4 用 CSS 而非 JS/TS 配置:

```css
@import "tailwindcss";
@import "tw-animate-css";

@import "./themes/paper.css";
@import "./themes/glass.css";

@custom-variant dark (&:is(.dark *));

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  /* ... 所有 shadcn 语义 token */

  --font-sans: var(--font-sans);
  --radius-sm: calc(var(--radius) - 2px);
  --shadow-paper: var(--shadow-paper);
}
```

`@theme inline` 把 `--background` 暴露成 `bg-background` 工具类,Tailwind 编译期识别。

## 暗色变体

`@custom-variant dark (&:is(.dark *))` 定义"`.dark` 祖先 → 子元素的 dark 变体"。当前 dark class 加在 React root 内部,**body 不在内部**——见 [dark-class-position-bug](../pitfalls/dark-class-position-bug.md)。

## 关键工具类(全部基于 token)

| 类 | 解析为 |
| --- | --- |
| `bg-background` | `background-color: var(--color-background)` → `var(--background)` |
| `text-foreground` | 文字色 |
| `bg-card` | 卡片背景 |
| `text-muted-foreground` | 次要文字 |
| `border-border` | 边框色 |
| `shadow-(--shadow-paper)` | 任意 CSS 变量阴影(v4 新语法) |
| `rounded-md` | `border-radius: var(--radius-md)` |

`shadow-(--shadow-paper)` 是 v4 的"任意变量"语法——直接引用 CSS 变量,不需要在 theme 里注册成 namespace。

## @layer base(全站修饰)

`body::before` SVG noise + `body::after` vignette + `body` 字体/抗锯齿 + `*` border-color 默认。

```css
@layer base {
  body { @apply bg-background text-foreground font-sans antialiased; }
  body::before { /* noise */ }
  body::after { /* vignette */ }
  h1, h2, h3, h4 { font-weight: 600; letter-spacing: -0.012em; }
  *, *::before, *::after { border-color: var(--color-border); }
}
```

`*` 默认 border-color 让 `border` 工具类不用单独写颜色。

## 关联条目

- [paper-theme-tokens](../shared/paper-theme-tokens.md) — 真理源
- [paper-theme-locked](../decisions/paper-theme-locked.md) — 视觉规范
- [cn-util](../shared/cn-util.md) — 类名合并工具
