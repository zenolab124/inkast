# shadcn UI 原语(own 进 components/ui/)

通过 `pnpm dlx shadcn@latest add <name>` own 进 `apps/web/src/components/ui/` 的 shadcn 组件。**Phase 1 baseline 这个目录是空的(只声明栈不实施),本次大改造 own 了 11 个原语 + 业务包装。**

## 已 own 的 11 个原语

| 组件 | 用途 | 依赖 |
| --- | --- | --- |
| `button.tsx` | 全应用按钮 | cva variants:default/destructive/outline/secondary/ghost/link;sizes:xs/sm/default/lg/icon-xs/icon-sm/icon/icon-lg |
| `input.tsx` | 文本输入 | 全用 paper token 通过 className 覆盖 |
| `textarea.tsx` | 多行文本 | 同上 |
| `label.tsx` | 表单 label | radix-ui Label |
| `popover.tsx` | 浮层定位 | radix-ui Popover + Portal + Anchor(combobox 依赖) |
| `command.tsx` | 命令面板搜索 | cmdk;Combobox 内部下拉用 |
| `dialog.tsx` | 弹窗 | radix-ui Dialog;**已 paper 覆盖**:overlay `bg-foreground/30`(原 `bg-black/50` 违反 paper 红线)+ Content rounded-md / bg-card / shadow-(--shadow-paper-lifted) |
| `alert.tsx` | 消息条 | variants default/destructive |
| `badge.tsx` | 小标签 | variants default/secondary/destructive/outline/ghost/link |
| `card.tsx` | 卡片容器 | ActiveJobs 任务卡片用 |
| `separator.tsx` | 分隔线 | radix-ui |

## 业务包装(在 components/,不在 ui/)

| 组件 | 内部使用 |
| --- | --- |
| [combobox.tsx](../../../apps/web/src/components/combobox.tsx) | Input + Popover + Command(自由输入下拉) |
| [option-picker.tsx](../../../apps/web/src/components/option-picker.tsx) | Dialog + Input + Button + Command + PreviewIcon |

## Paper 主题覆盖

shadcn 默认走 shadcn token(`--background` / `--foreground` 等),inkast 把 paper.css 的 token 映射到 shadcn 同名变量,直接生效。**唯一例外**:Dialog overlay 默认 `bg-black/50`,违反 paper "禁纯黑" 红线,在 `ui/dialog.tsx` 改成 `bg-foreground/30`;Content 默认 `shadow-lg + rounded-lg + bg-background` 改 `shadow-(--shadow-paper-lifted) + rounded-md + bg-card`。

## 使用规则(硬性)

见 [shadcn-first-rule](../decisions/shadcn-first-rule.md):任何 UI 必须先 own 进 ui/ 再用,**禁止手撸**。例外见决策文档。

## 关联条目

- [shadcn-first-rule](../decisions/shadcn-first-rule.md)
- [shadcn-ui-radix-cmdk](../integrations/shadcn-ui-radix-cmdk.md)
- [paper-theme-tokens](paper-theme-tokens.md)
