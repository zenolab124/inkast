# Post-Review Edit Pool 比 Round 0 缩小 60%

## What

Post-review-edit 流程在 LLM 判 `looks_like_target=false` 时调 `generateImage(..., requireMode: 'images')`,**强制只走 mode=images 的 provider**。当前 inkast 6 个 provider 里 mode=images 只有 3 个(ciallo / 冰 / duck),pool 从 round 0 的 6 个缩到 3 个。

实测 v2.21-v2.25 期间 3/19 r2/r3 task 触发 edit,**3/3 都失败**: `exhausted all 3 providers`。

## Why

OpenAI 的 image edit API 是 `/v1/images/edits`(images-mode driver),而 inkast 一半 provider(cpa / e)走 `/v1/responses` + `image_generation` tool(responses-mode driver)。**responses-mode 没有等价的 edit 操作**(tool 只支持 generation,不支持 edit-with-reference)。

3 个 images-mode provider 当前实测健康度:
- **ciallo** — `auth` 错(key 失效或 base_url 漂移)
- **冰** — `server` / `unknown` 错(上游不稳)
- **duck** — `provider_blocked_content`(image-review 层基于"原图 + edit_instructions"判违规,合理拦截)

duck 拦截是设计上正常的(edit_instructions 本身含 IP-related 描述),但**ciallo + 冰 同时挂**让整个 edit pool 实质 0 可用。

## Action

**1. edit 想 fallback 到 responses-mode** 需要 responses driver 也支持 image edit 语义(tool 加入 `image_edit` 调用,或者实现 `/v1/responses` body 含原图的 multipart 模式)——目前 OpenAI 协议层不直接支持,**等价改造成本中等**。

**2. 短期运维**:
- 刷 ciallo 的 key / 校 base_url
- 看 冰 稳定性,必要时单调 throttle 让它喘息

**3. 评估是否值得**:实测 LLM review 10/13 直接判 `looks_like_target=true`(过于宽松,[[review-llm-too-lenient]]),真正触发 edit 的 case 本来就少。**edit pool 缩水这个 pitfall 影响面有限**,优先级低于"review 标准放严"。

**4. 监控**:Pipeline policy `post_review_edit=true` 的 task,如果 `editApplied=true / total_r2r3_tasks` 长期 < 5%,说明 edit pool 整体不工作,应该考虑要么修通道、要么直接关掉 post-review。

## 关联

- [post-review-edit](../domains/post-review-edit.md) — Edit 调用的位置
- [review-llm-too-lenient](review-llm-too-lenient.md) — Edit pool 之外的另一病根
- [pool-retry-graded](../decisions/pool-retry-graded.md) — pool walker 整体 retry/fallover 语义
- [image-mode-coexistence](../decisions/image-mode-coexistence.md) — responses vs images 双 mode 的设计
