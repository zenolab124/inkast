# Plugin prompt 协议升级前:style 被 LLM 翻译/近义改写,出图风格漂移但 rewritten_prompt 看起来合理

**What**: plugin 通道生图,用户期望 `中国水墨画` 风格,出图变成水彩 / 西式素描 / 油画。`rewritten_prompt` 文本里有 "Chinese ink painting" 或 "ink wash" 字样,看起来 LLM 听话了,但生图模型仍然画错。

**Why**: 旧 prompt 协议把 style 当散文里的一句话 (`SpiderMan. Style and theme: 中国水墨画`),R1/R2/R3 system prompt **没把 style 列为硬锚定**——LLM 重写时会:
1. **翻译**(中→英),生图模型对英文术语权重不同
2. **近义改写**(水墨 → 水彩 → 水彩泼墨),细节漂移
3. **省略**(LLM 觉得 style 不重要)
4. **混淆**(style 出现但跟其他描述堆在一起,生图模型权重低)

更隐蔽的是 `rewritten_prompt` 里能 grep 到一些风格字样,**排查人凭印象会以为 style 没丢**,而真实问题在于 style 词被翻译/同义替换后,生图模型把握到的概念跟用户想要的不同。

**Action**:
- 已在 v2.30 修复:协议切到 CJK「」原子格式 + style 作为第四个硬锚定(见 [cjk-bracket-atomic-protocol](../decisions/cjk-bracket-atomic-protocol.md) + [style-as-fourth-anchor](../decisions/style-as-fourth-anchor.md))。
- 新版本中 style 文本被 `「」` 圈起来,4 个 R 的 system prompt 都加红线"原文出现,不翻译/不近义改写/不省略",并叠 force-prepend block `【画风(必须严格遵循)】「<style>」` 兜底。
- 排查后续类似 bug 时:**grep `rewritten_prompt` 是否含 `「<style 原文>」` 字面 atom**——不含就是 LLM 不听话(R1 listening 失败)。

## 关联条目

- [cjk-bracket-atomic-protocol](../decisions/cjk-bracket-atomic-protocol.md) — 协议升级决策
- [style-as-fourth-anchor](../decisions/style-as-fourth-anchor.md) — style 锚定强化
- [rewrite-chain](../domains/rewrite-chain.md) — 协议使用方
- [grayscale-style-palette-conflict](grayscale-style-palette-conflict.md) — style 没丢但 palette 跟它冲突的另一类 bug
