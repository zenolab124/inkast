# UI 一律优先 shadcn(硬性规则)

任何通用交互组件(button / input / textarea / select / popover / dialog / combobox / tooltip / tabs / alert 等)**禁止手撸**,必须先 own 进 `apps/web/src/components/ui/`。

## 背景

Phase 1 baseline 时 CLAUDE.md 声明栈用 "Tailwind + shadcn/ui",但**实际 own 的 shadcn 组件是零** —— `components/ui/` 目录是空的,所有 UI 都用 `<div>` + Tailwind 手撸:`ProviderConfigDialog` 自撸 backdrop、`PromptComposer` 自撸 button、`Banner` 自撸 alert ...

讨论 OptionPicker / combobox 时发现:**手撸通用组件的边角维护成本极高**——键盘、焦点、portal 定位、可访问性、跨浏览器一致性、动画 ... 每个 shadcn 用 Radix 验证过几年的细节都要重新踩。最显眼的引爆点是 Combobox 闪烁 bug(focus/blur 与 popup open 状态竞态)。

## 方案对比

| | 全手撸 | shadcn first(选定) |
| --- | --- | --- |
| 通用组件维护 | 自己写自己修 | Radix + shadcn 维护 |
| 可访问性 | 大概率不全 | Radix 标配 |
| 跨浏览器 | 自己测 | Radix 已踩 |
| 视觉一致性 | 自己保证 | shadcn 默认 + 自定义 override |
| 学习成本 | 0(纯 Tailwind) | 中(Radix API + cmdk + shadcn 约定) |
| 初次铺设成本 | 0 | 1-2 小时(own primitives + 改造现有手撸代码) |

## 最终选择

shadcn first,硬性规则,**新写**的 UI 不许手撸。

### 红线(写入 CLAUDE.md 视觉规范 → "UI 组件库")

- ❌ 禁止手撸通用交互组件(button/input/textarea/select/popover/dialog/dropdown/combobox/tooltip/tabs/alert 等)
- ❌ 禁止用 `<div>` + Tailwind 模拟上面这些
- ✅ 第一动作:打开 `components/ui/`,有就直接 import
- ✅ 没有就先 own:`cd apps/web && pnpm dlx shadcn@latest add <name> --yes`
- ✅ 业务组件(Combobox、ColorPaletteEditor 等)放 `components/`,**内部仍用 shadcn 原语**
- ✅ 视觉细节走 paper token,通过 className 覆盖 shadcn 默认

### 唯一豁免

`<input type="color">` 是隐藏的 OS color picker trigger,shadcn 无对等组件,被业务组件 ColorPaletteEditor 内嵌使用——有注释明示豁免理由。

## 副作用

- Phase 1 baseline 的手撸 UI 是"债务",新写按规则,旧的逐步迁移(本次已迁完:App/Composer/PromptFieldEditor/TextElements/ColorPalette/combobox/Gallery/GalleryDetailDialog/ProviderConfigDialog 全部用 shadcn 原语)
- shadcn Dialog overlay 默认 `bg-black/50` 违反 paper "禁纯黑" 红线,在 `components/ui/dialog.tsx` 改成 `bg-foreground/30`;DialogContent shadow 改 `--shadow-paper-lifted`,bg 改 `bg-card`,rounded 改 `rounded-md`
- 已 own 的 11 个原语:button / input / textarea / label / popover / command / dialog / alert / badge / card / separator(+ 业务组件 combobox / option-picker / reference-picker)

## memory

`~/.claude/projects/-Users-xt-workspace-cc-apps-inkast/memory/inkast-ui-shadcn-first.md` 已记录,后续 AI 接手项目时会读。

## 关联条目

- [shadcn-primitives](../shared/shadcn-primitives.md) — 已 own 的组件清单
- [shadcn-ui-radix-cmdk](../integrations/shadcn-ui-radix-cmdk.md) — 依赖与子依赖
- [paper-theme-tokens](../shared/paper-theme-tokens.md) — paper override 规则
- [paper-theme-locked](paper-theme-locked.md) — paper 主题红线(shadcn 默认要走这套)
