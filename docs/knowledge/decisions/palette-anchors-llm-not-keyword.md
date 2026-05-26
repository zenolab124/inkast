# Palette_anchors 用 LLM 语义判断,不在 inkast 层加关键词兜底

v2.31 修 R1 vision system prompt 时,只在 LLM 提示层加 style-aware 规则,**否决了"在 inkast 代码层加 grayscale 关键词检测兜底"的方案**——保留产品灵活性,代价是 LLM 不听话时仍可能踩 [grayscale-style-palette-conflict](../pitfalls/grayscale-style-palette-conflict.md)。

## 背景

bug 现场:black-and-white comic style 的 task,R1 提取 palette_anchors = "红与蓝为双主色,金色作高光点缀"(角色 CaptainMarvel 原始彩色配色),R2/R3 force-prepend block 把这一行硬注入,**rewrite 文本既写"黑白漫画"又写"红蓝金配色",生图模型颜色描述权重高 → 出图变彩色**,跟用户预期的黑白完全相反。

同类问题影响所有 grayscale / 单色 / 限色 style:单色海报、深褐复古、中国水墨黑白、剪影艺术、Sin City 黑白红等。

## 方案对比

| | A: R1 system prompt 加 style-aware 语义规则 | B: inkast 后端检测 style 关键词 + 强制清空 palette |
| --- | --- | --- |
| 实现位置 | LLM prompt 层(R1 vision system prompt) | 后端 TS 代码,接 LLM 输出后扫 |
| 灵活度 | LLM 自己判断哪些 style 属于 grayscale 范畴 | inkast 维护一份关键词黑名单,新风格要加 |
| 失败模式 | LLM 不听话仍可能输出彩色 palette | 黑名单漏覆盖某个 style 仍可能注入彩色 |
| 维护成本 | system prompt 微调即可 | 每加一个新 style 都要更新黑名单 |
| **副作用** | LLM 听话率 < 100%,极端 case 仍踩坑 | **限制太死**,新 style 不在黑名单时被错杀 |

## 最终选择

**A**。用户明确表态:**"不要限制太死,给 LLM 语义判断的空间"**。R1 vision system prompt 给 palette_anchors 字段定义加 "style-aware 规则" 段——如果 user style 已规定颜色范围(黑白 / 灰阶 / 单色 / 剪影 / 深褐 / 单一色调等),palette_anchors 必须输出该 style 允许范围内的色值描述(例:黑白漫画 → "黑白灰阶为主,黑色作主色,白色作底,中灰过渡,强烈明暗对比"),而**不是**角色原始彩色配色。给 3 个 ✅ 示例 + 1 个 ❌ 示例 + 一句"没限制颜色时按角色原始配色正常输出"作反退路。

## 副作用

- **LLM 不听话时仍踩同款 bug**——接受这个风险,因为 LLM 调试比黑名单维护成本低。操作员遇到时直接调高 R1 system prompt 该段强度即可。
- 关键词检测兜底**未来仍可作为 Plan B**——如果 LLM 听话率太低,可以在 with-rewrite 层加最小化兜底(只针对最常见的几个 grayscale 关键词),但目前不做。

## 关联条目

- [style-as-fourth-anchor](style-as-fourth-anchor.md) — palette 配套的 style 锚定
- [rewrite-chain](../domains/rewrite-chain.md) — R1 system prompt 所在域
- [grayscale-style-palette-conflict](../pitfalls/grayscale-style-palette-conflict.md) — 引发本决策的 bug + 仍存在的失败模式
