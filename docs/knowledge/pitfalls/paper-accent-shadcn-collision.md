# Paper 主题 `--accent` 与 shadcn 默认 hover 语义冲突

## 现象

shadcn UI 原语(button outline/ghost、Command items、Dialog close X、Badge 等)在 hover/selected 状态下变成**砖红色**——视觉刺眼,跟 paper 主题"低饱和、低对比"的整体语义冲突。一开始觉得是 shadcn 配色 bug,实际上是 token 语义冲突。

## 根因

shadcn 的默认设计语义:`--accent` 是**中性 hover/selected 高亮色**(灰白系)。比如 `<Button variant="ghost">` hover 时 `bg-accent text-accent-foreground` = 浅灰背景 + 深色文字。

但 paper 主题在 `apps/web/src/styles/themes/paper.css` 里把 `--accent` 重定义为:

```css
--accent: #A4453B;  /* 砖红,故意的视觉强调色 */
```

这是 paper 主题里**故意**的强调色——用于 "AI 扩充" 按钮、危险提示、"自定义" 标签等需要"红色情绪"的语义。

冲突的根源:**两套设计系统对 `--accent` 的语义不同**。shadcn 当它是"中性高亮"(hover/selected),paper 当它是"暖色情绪强调"。

## 规避

**不要重定义 token 解决**——paper 主题有 8 个业务地方合法地用这个砖红色。改 token 会让那些地方变中性灰,失去强调效果。

正确做法:**改 shadcn 原语**,把"hover/selected = `accent`"改成 `secondary`(中性背景 token)。

需要 patch 的 shadcn 文件(已 own 在 `apps/web/src/components/ui/`):

| 组件 | 改哪里 |
| --- | --- |
| `button.tsx` | outline / ghost variant 的 hover/active class:`hover:bg-accent` → `hover:bg-secondary` |
| `command.tsx` | item selected/hover 样式:`data-[selected]:bg-accent` → `bg-secondary` |
| `dialog.tsx` | close X 按钮 hover:`hover:bg-accent` → `hover:bg-secondary` |
| `badge.tsx` | variant 默认色:`bg-accent` → `bg-secondary` |
| 类似 | tabs / dropdown / popover / select 内的选中项 |

**仍保留 accent 用于业务强调**——比如 "+ AI" 徽章、size 行的 "Auto" 芯片(`tone="accent"`),仍走 `bg-accent/12 border-accent/50 text-accent`。

## 检测

写新 shadcn primitive 或改 paper token 后,**先看 ghost button hover 是不是变红**——是的话又踩坑了。

## 关联条目

- [paper-theme-tokens](../shared/paper-theme-tokens.md) — token 真理源
- [paper-theme-locked](../decisions/paper-theme-locked.md) — 视觉规范红线
- [shadcn-primitives](../shared/shadcn-primitives.md) — 已 patch 的原语清单
- [shadcn-first-rule](../decisions/shadcn-first-rule.md) — 为什么不手撸
