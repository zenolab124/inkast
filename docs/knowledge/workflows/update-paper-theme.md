# 修改 Paper 主题 Token

改 paper.css 是改视觉**唯一**正确的入口。不要去组件里改颜色/字体/阴影——那违反视觉规范红线。

## 步骤

1. **打开 `apps/web/src/styles/themes/paper.css`**
2. **看文件头注释**——它列了 5 条硬规则 + 指回 CLAUDE.md
3. **改对应变量**
   - 改背景色 → `--background`(亮/暗两份)
   - 改文字 → `--foreground` / `--muted-foreground`
   - 改卡片 → `--card`
   - 改主色 → `--primary`(墨绿)
   - 改强调 → `--accent`(砖红)
   - 改阴影 → `--shadow-paper` / `--shadow-paper-lifted`(三层 + 棕调)
   - 改圆角 → `--radius`(整体缩放,sm/md/lg 自动跟着)
4. **不需要重启 dev**——Vite HMR 自动应用 CSS
5. **在亮/暗模式都看一遍**(右上角 Paper · Light/Dark 按钮)
6. **对照 CLAUDE.md "组件新增/修改自检清单"7 条** 全过才能 commit

## 红线提醒(再列一次)

- ❌ 颜色不能用纯黑/纯白
- ❌ 阴影不能用中性灰(`rgba(0,0,0,*)` 在亮色下被禁,改 `rgba(70,45,20,*)`)
- ❌ 字体不能改成 serif / webfont
- ❌ 圆角不能超过 ~0.5rem(`--radius` 上限)
- ❌ 不能在 paper.css 之外的组件里 hardcode 颜色

## 常见调整场景

### 想让颜色更冷/更暖

改 `--background` 的 `oklch(0.935 0.020 80)` 第三个参数 chroma(80 = 暖橙调,60-65 偏冷,90+ 更暖)。

### 想让卡片更明显

加大 `--card` 和 `--background` 的 lightness 差(当前 0.965 vs 0.935 = 差 3%,可拉到 0.97 vs 0.93)。或加大 `--shadow-paper` 第二层 rgba 透明度。

### 想换主色(墨绿 → 别的)

`--primary` 的 oklch(0.43 0.06 145),最后一个参数 hue:`145` 是绿,`28` 是砖红,`240` 是蓝,`60` 是黄。改完看 hover 态、按钮、focus ring 是否还协调。

### 想做 glass 主题

不要碰 paper.css。新增 `glass.css` token,App.tsx 把 `theme-paper` 替换为 `theme-glass`。所有组件不用改——这是 token 真理源的设计意图。

## 关联条目

- [paper-theme-tokens](../shared/paper-theme-tokens.md) — token 全貌
- [paper-theme-locked](../decisions/paper-theme-locked.md) — 规范来源
- [tailwind-v4](../integrations/tailwind-v4.md) — Tailwind 怎么消费这些 token
- [dark-class-position-bug](../pitfalls/dark-class-position-bug.md) — 改暗色 token 时遇到的已知坑
