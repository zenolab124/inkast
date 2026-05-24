# Post-Review LLM 判 `looks_like_target=true` 偏宽松

## What

`reviewAndMaybeEdit` 的 review LLM(看参考图 + 生成图 → 判像不像同一角色)实测**倾向给 true 放过**。v2.21-v2.25 期间 19 个 r2/r3 task 中:
- 10 个判 `looks_like_target=true`(直接放过,不 edit)
- 3 个判 `looks_like_target=false`(进 edit 阶段)
- 剩余日志没完整抓到

更关键:**目测明显不像**的图(IronMan 海滩 pin-up / 哥特玻璃花窗 / Moebius 钢笔画风 / 夏日泳池 / 故障艺术),LLM 都判 `looks_like_target=true`。这些图通常只保留了 palette,角色 archetype 已脱离原型。

## Why

`REVIEW_SYSTEM_PROMPT` 写:
```
画风差异 / 姿态差异 / 构图差异不重要
```

**本意**:LLM 不要因为"风格变了"就判 false——变体本来就该接受 style 变化。

**结果偏走**:LLM 把"风格剧变后主体也变"误归类成"风格差异",直接放过。"主题类 style"(中国风 / 古风 / 远古 / 蒸汽朋克)下尤其严重——风格 token 大到压过 archetype。

## Action

**不在本次 v2.25 范围内修**(用户 2026-05-25 判定"post-review 功能链路正确,标准过宽是产品级问题,保持现状")。

如果未来要改,有 3 个方向:

**a. system prompt 改严**:加更明确的 false 触发标准
```
如果主体形态完全脱离参考图角色 type(机甲战士变武侠武者、机甲战士变纯人脸),
即使风格再美也判 false。
```

**b. 拆字段**:把单一 `looks_like_target: bool` 拆成 3 项 `palette_match` / `body_match` / `archetype_match`,任一为 false 整体判 false。

**c. 改成"打分"**:`similarity_score: 0-100`,可配阈值;给出更细粒度的判定空间。

**短期监控**:如果未来 `editApplied=true / total_r2r3_tasks` 比例长期低于 5%(当前 0/19 = 0%),review 链路实际不工作,可以考虑直接禁用 post-review 而不是修。

## 关联

- [post-review-edit](../domains/post-review-edit.md) — review 流程
- [edit-mode-images-pool-shrunk](edit-mode-images-pool-shrunk.md) — 即便 LLM 判 false 也救不回的另一病根
- [rewrite-chain](../domains/rewrite-chain.md) — r2/r3 是 review 触发条件
