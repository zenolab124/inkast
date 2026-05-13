# Paper 主题视觉规范锁定

## 背景

inkast 第一次视觉迭代后,用户认可了"纸张质感"方向。但视觉容易被后续 AI/手改打破(组件里写颜色字面量、加新字体、用错圆角等)。

需要一个**机制确保视觉一致性**,而不是依赖人记忆。

## 方案对比

|  | A: 仅文档说明 | B: CLAUDE.md 红线 + token 顶部注释 |
| --- | --- | --- |
| 防御层数 | 1(用户读了才生效) | 2(改组件读 CLAUDE.md,改 token 读文件注释) |
| AI 协作可执行性 | 弱(AI 不一定读到) | 强(AI 改任何文件前都会读 CLAUDE.md) |
| 灵活性 | 高 | 中(改变规范也要改文档) |

## 最终选择

**B**:CLAUDE.md "视觉规范"段明文锁定 + paper.css 顶部多行注释引用回 CLAUDE.md。两道防线,任何路径改视觉都会撞到。

## 锁定的红线(节选,完整版见 CLAUDE.md)

字体:
- ❌ 中文绝对禁止任何衬线(Songti / SimSun / Source Serif / Lora 等)
- ❌ 禁止 import webfont
- ❌ 禁止 `font-family` 字面量
- ✅ 走 `var(--font-sans)` 系统栈

颜色:
- ❌ 组件里禁止 `#xxx` / `rgb(...)` / `bg-zinc-50` 字面量
- ❌ 禁止纯黑/纯白
- ❌ 阴影禁止中性灰,必须棕调
- ✅ 走语义 token `bg-background` / `shadow-(--shadow-paper)`

形状:
- 圆角 ≤ `rounded-md`(0.3rem)
- paper 主题禁用 `backdrop-blur`(glass 主题的特权)
- 不要"科技感"霓虹边

## 自检清单

写或改任何 UI 组件,7 条都过才能 merge:

1. 颜色全走语义 token?
2. 字体未指定 font-family?
3. 阴影用了 paper 三层投影?
4. 圆角 ≤ rounded-md?
5. 没有引入新 webfont?
6. 中文亮/暗模式都是 PingFang?
7. 没有破坏全站 noise + vignette?

## glass 主题占位

`apps/web/src/styles/themes/glass.css` 是占位空壳,Phase 1 不实现。届时**只改 token 文件,不动组件**——这是设计意图,验证 token 真的是真理源。

## 关联条目

- [paper-theme-tokens](../shared/paper-theme-tokens.md) — token 详表
- [chinese-fallback-songti](../pitfalls/chinese-fallback-songti.md) — 红线起源
- [update-paper-theme](../workflows/update-paper-theme.md) — 改 token 步骤
