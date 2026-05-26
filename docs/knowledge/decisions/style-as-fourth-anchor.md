# Style 作为第四个硬锚定(identity + character + palette + style)

v2.30 把 `style` 从"用户意图自由发挥"升级为第四个**硬锚定字段**——跟 identity_feature / character_key / palette_anchors 同级,3 轮 rewrite + post-review-edit 都不准对 style 文本动手脚。

## 背景

R1/R2/R3 system prompt 之前对三个字段做了 force-prepend 兜底(identity_feature 用作脸部特征锚、character_key 锚到漫画角色名、palette_anchors 锚到配色),**但 style 完全交给 LLM 自由发挥**。实测 LLM 会:

- **翻译**:`中国水墨画` → `Chinese ink painting style`(出图风格漂移)
- **近义改写**:`中国水墨画` → `Chinese watercolor`(出图变水彩)
- **省略**:LLM 觉得 style 不重要,直接丢掉
- **混淆**:在 rewrite 文本里出现,但跟其他描述混在一起,出图模型权重低

最致命的是 rewritten_prompt 文本看起来合理(里面有 "ink painting" 字样),操作员排查时不会注意到画风跑偏的根因在 style 而非 prompt 其他部分。

## 方案对比

| | A: 4 锚定 + force-prepend 兜底 | B: 只加 system prompt 红线 | C: 后端代码层硬替换(出图前重新拼回 style 字面词) |
| --- | --- | --- | --- |
| LLM 听话 | 听话不重复 prepend(idempotent),不听话兜底有效 | 仍依赖 LLM 自觉,实测不够 | 100% 强制 |
| 灵活度 | LLM 可在 prepend 后追加风格描述细节 | 同 A | 完全僵化,失去 LLM 重写空间 |
| 代码复杂度 | 一套 prepend 模式复用 identity / palette 现成的 | 最低 | 高,且要每个 R 路径都改 |

## 最终选择

**A**。复用现有 idempotent guard 模式:`rewrittenCore` 处理时先检查 rewritten 文本是否已含字面 atom `「<styleText>」`,不含就 prepend `【画风(必须严格遵循)】「<style>」\n\n`。LLM 听话就不重复,LLM 不听话兜底有效——跟现有 identity anchors / hard_constraint 同一套模式。

同时给 4 个 R 的 system prompt(R1 vision、R1 text-only、R2、R3)各加一行红线:**「」圈起来的画风文本必须原文出现,不翻译/不近义改写/不省略**。

## 副作用

- prepend block 跟 [palette-anchors-llm-not-keyword](palette-anchors-llm-not-keyword.md) 是配套设计——palette 必须 style-aware,否则黑白漫画 style 注入彩色 palette 会自相矛盾(见 [grayscale-style-palette-conflict](../pitfalls/grayscale-style-palette-conflict.md))。
- Web UI 通道(JSON prompt)走 text-only 分支,不经 `extractStyleText`,故第四锚定只对 plugin 通道生效;Web UI 通道的 style 通过 JSON `style` 字段直接传给生图模型,问题不存在。

## 关联条目

- [cjk-bracket-atomic-protocol](cjk-bracket-atomic-protocol.md) — 配套的 prompt 协议升级
- [palette-anchors-llm-not-keyword](palette-anchors-llm-not-keyword.md) — palette style-aware 配套
- [three-anchor-design](three-anchor-design.md) — 升级前的 3 锚定基础(identity + character + palette)
- [rewrite-chain](../domains/rewrite-chain.md) — 实现 force-prepend 的链路
- [cjk-bracket-style-translation](../pitfalls/cjk-bracket-style-translation.md) — 引发本决策的 bug
