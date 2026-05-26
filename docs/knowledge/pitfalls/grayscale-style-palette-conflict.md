# R1 提取的 palette_anchors 跟 grayscale style 直接冲突,出图变彩色

**What**: 用户要求 black-and-white comic style / 中国水墨黑白 / Sin City 黑白红 / 深褐复古 / 剪影艺术等**限色 style**,出图却是彩色。`rewritten_prompt` 里既有"黑白漫画"又有"红蓝双主色,金色作高光"这种自相矛盾描述。style 字面词在所有 R 里都没丢,问题不在 [cjk-bracket-style-translation](cjk-bracket-style-translation.md)。

**Why**: R1 vision 看角色参考图时,**机械提取角色原始彩色配色**(CaptainMarvel 红蓝金、SpiderMan 红黑蓝、BlackPanther 黑紫银),写成 `palette_anchors: "红与蓝为双主色,金色作高光点缀..."`。然后 R2/R3 的 force-prepend block 把这一行硬注入 rewritten prompt——**rewrite 文本同时出现 style 限色描述 + 角色彩色配色,生图模型一般颜色描述权重比 style 高,所以出图变彩色**。

跟 [cjk-bracket-style-translation](cjk-bracket-style-translation.md) 的区别:那个是 style 丢了,这个是 style 在但 palette 跟它打架。同款 style 也可能两个 bug 都触发。

**Action**:
- v2.31 修了一半:R1 vision system prompt 给 `palette_anchors` 字段加 "style-aware 规则" 段——LLM 自己判断 user style 是否规定了颜色范围(黑白 / 灰阶 / 单色 / 剪影 / 深褐 / 单一色调等),命中时输出该 style 允许范围内的色值描述(例:黑白漫画 → "黑白灰阶为主,黑色作主色,白色作底,中灰过渡"),而不是角色原始彩色配色。
- **未做兜底**:不在 inkast 后端加 grayscale 关键词检测 + 强制清空 palette,见 [palette-anchors-llm-not-keyword](../decisions/palette-anchors-llm-not-keyword.md) — 给 LLM 语义判断空间。**LLM 不听话时仍踩同款 bug**,排查人能识别后调高 R1 system prompt 该段强度即可。
- 排查姿势:对照 task 的 prompt_json 看 `style` + `rewritten_prompt` 看 `palette_anchors` 段;如果 style 有限色规则但 palette 还是角色原始彩色 → 命中此 pitfall。

## 关联条目

- [palette-anchors-llm-not-keyword](../decisions/palette-anchors-llm-not-keyword.md) — 不加关键词兜底的决策
- [style-as-fourth-anchor](../decisions/style-as-fourth-anchor.md) — palette 配套的 style 锚定
- [rewrite-chain](../domains/rewrite-chain.md) — R1 system prompt 所在域
- [cjk-bracket-style-translation](cjk-bracket-style-translation.md) — style 完全丢失的另一类 bug
