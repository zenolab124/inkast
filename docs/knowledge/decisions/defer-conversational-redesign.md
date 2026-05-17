# 段 1 重对话化推迟到 Phase 1.5

## 背景

Phase 1 段 1 实现的"输入框 + 起草 + hint 采纳追加"循环,**本质上是表单交互**——按钮多,但 LLM 的"自然语言理解"能力没真正发挥。LLM 时代的 UX 共识(Cursor / v0 / Claude.ai / bolt.new)是**对话流 + 可见状态**,不是按钮。

用户明确反馈:"虽然接入了大模型,但点选方案稍有死板。"

## 方案对比

|  | 现状(按钮) | 轻对话化 | 重对话化(Cursor 级) |
| --- | --- | --- | --- |
| 工程量 | — | 半天 | 一周 |
| 上下文 | 单次 prompt | 历史拼到 prompt | 真 multi-turn + system reminder |
| 状态演化 | 每次重生成 | 每次重生成 | JSON diff/patch |
| 输出 | 全新 JSON | 全新 JSON | 字段级修改 + 助手回复 |
| 延迟 | 27-45s/次 | 同 | 5-10s/轮(需流式) |
| 历史持久化 | 无 | 无 | 必需(SQLite 新表) |
| LLM 价值发挥 | 30% | 50% | 95% |

## 最终选择

**Phase 1 维持现状,Phase 1.5 一次性重对话化**。理由:

1. **闭环优先**:Phase 1 真正的价值是"散文 → 图"的产品闭环跑通。先把生图 + Gallery + provider 配置做完,产品价值流被证明,再回头改交互核心。
2. **避免半残**:轻对话化(只改 UI,后端不动)是"对话皮 + 表单骨",体验更别扭。
3. **代码不全白做**:hint 数据结构、字段化 JSON 渲染、采纳逻辑——这些重对话化时**仍然要用**。要拆掉的只是"按钮 UI"。
4. **专注期值得**:重对话化牵涉流式 SDK / JSON diff / 历史 schema / UI 重写,值得一个独立 Phase 集中精力。

## 后续演变(2026-05-14 之后)

字段编辑器路径走通后,**70% LLM 价值已经通过另一条路径实现**——不是对话流,而是"AI 预填 + 用户可改字段"。见 [llm-as-accelerator-not-requirement](llm-as-accelerator-not-requirement.md) 和 [field-editor](../domains/field-editor.md)。

后果:
- Hint 采纳循环被拆掉,UI 不再有 hint 栏(hint 数据仍然从 LLM 返回,前端忽略)
- 重对话化的紧迫性显著降低 —— 用户在字段编辑器里能直接控制每个字段,不需要"对话流"再走一遍
- 重对话化变成"锦上添花"的可选 Phase,而不是"必经的下一步"
- 这条决策的判断 #3 应验:hint 数据结构 + 字段渲染都还在用,只是用法变了

## 段 3(生图)期间的"对话友好"铺垫

虽然不彻底改,Phase 1 段 3 的所有新组件**有意做成对话化能无缝接管**:

- 生图按钮位置和触发用"事件"语义(对话里"生图"能触发)
- Provider 配置不写死"右上角弹窗",抽象成"配置意图"(对话里"切换 OpenAI provider"也能触发)
- Gallery 保存的不只是图,还存"产生这张图的对话上下文"(为 Phase 1.5 续命)

## Phase 1.5 范围

```
- 流式 SDK 调用(从 SDKPartialAssistantMessage 边收边渲染)
- JSON diff/patch 协议(模型只改受影响字段,不每轮重生成)
- 对话历史持久化(SQLite 新表 conversations + messages)
- UI 重写:对话流 + 字段同步双栏
- hints 升级为"推荐下一句"快捷气泡(用户也能自由输入)
```

## 关联条目

- [session-workspace](../domains/session-workspace.md) — 当前段 1 实现(composer 在三栏左栏的形态)
- [prompt-engine](../domains/prompt-engine.md) — 后端引擎(会演进)
