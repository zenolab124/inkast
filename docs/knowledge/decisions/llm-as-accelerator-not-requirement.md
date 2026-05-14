# LLM 是加速器不是必需品

字段编辑器是 Inkast 的**核心交互**,LLM 起草只是"快速预填"的加速器。所有设计决策以"无 LLM 也能用"为底线。

## 背景

之前的设计是"散文 → AI 起草 → 只读 JSON 卡片"——LLM 是流程必经,没接 / 失败 / 配置不全都阻塞主路径。Phase 1 跑通后,讨论怎么让 LLM 不"死板"时,意识到把"展示美化"升级成"可编辑字段"顺势就解锁了 LLM 优雅降级路径——并把"重对话化"这个 Phase 1.5 计划绕过去了。

## 方案对比

| | LLM 必需 | LLM 加速器(选定) |
| --- | --- | --- |
| 入口门槛 | 必须配 provider + Claude OAuth | 不配也能用,直接填字段 |
| LLM 失败 | 阻塞主流程 | 不阻塞,仅缺预填 |
| 离线 | 不能 | 能(provider 配好就行) |
| 用户控制感 | 弱 | 强(任何字段可改) |
| 重对话化复杂度 | 必须做(否则交互"死板") | 可推迟(70% 价值已通过字段编辑器实现) |

## 最终选择

字段编辑器永远在场,LLM 仅"快速预填"。

### 具体含义

- 字段编辑器永远在线,可从零填字段 → 生图
- 散文输入是入口选项之一(配 [AI 预填] / [直接生图] 按钮),不是必经路径
- LLM 失败 / 未配置 / 网络断 不阻塞主流程,仅是没有预填
- 预设选项(combobox 下拉值)必须覆盖常见场景,无 LLM 也能挑出像样的 prompt
- 高级用户可跳过散文直接编辑器构造 prompt

## 副作用

- 字段词典(选项预设)必须够好——参考 `apps/web/src/features/prompt/field-dict.ts`,后续可从 imagegen 等方法论补充
- 重对话化推迟,但路径仍开放([defer-conversational-redesign](defer-conversational-redesign.md))

## 关联条目

- [field-editor](../domains/field-editor.md) — 实现
- [defer-conversational-redesign](defer-conversational-redesign.md) — 被这条决策覆盖了 70% 价值
- [generate-now-raw-prompt-path](generate-now-raw-prompt-path.md) — 同主义下的"完全跳过 LLM 起草"路径
