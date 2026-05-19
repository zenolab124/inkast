# 无法 fix 渠道时,诊断完整性优先于"假装能修"

一句话:当上游渠道(如 anyrouter + image_generation 工具)的失败是结构性的、driver 层修不了时,**所有工程精力投入到诊断信息的完整性上**——让每次失败都暴露出最详细的"为什么"和"在哪一步死的",而不是去做无效的兜底。

## 背景

调研期间对 anyrouter + image_generation 工具做了 15 个对照实验,**全部 driver 杠杆都无效**:reasoning_effort、instructions、tool_choice、detail、partial_images、不传 reasoning、不同 model、JSON 路径……全部 0% 救不了复杂 prompt + 参考图场景(见 [pitfalls/anyrouter-complex-prompt-ceiling](../pitfalls/anyrouter-complex-prompt-ceiling.md))。

面对这种"修不了"的渠道现状,有两条路:

1. **假装能修**:加更多 driver 兜底逻辑、更激进的 retry、隐藏失败、给用户假装乐观的错误信息
2. **正视无解,做最好的诊断**:每次失败都暴露完整死亡现场,让开发者能区分"渠道问题"vs"我们的 bug"vs"用户 prompt 问题"

## 方案对比

| 方案 | 优势 | 劣势 |
| --- | --- | --- |
| 假装能修 | 用户感觉好一点(短期) | 长期掩盖问题,debug 灾难;失败时啥也看不到;开发者反复掉进同一个坑 |
| **诊断优先**(选中) | 每次失败可解释、可分类、可定位;为未来"换 provider / 加 LLM-rewrite"等真治本方案铺路 | 失败时用户看到的错误信息更详细但不那么"友好"——但 inkast 是本地优先开发工具,目标用户能看懂技术错误 |

## 最终选择

实现在 [apps/api/src/drivers/image/openai-responses.ts](../../../apps/api/src/drivers/image/openai-responses.ts) 的 `SseDiagnostics` 类型 + `formatStreamFailure`,以及 [apps/api/src/drivers/image/openai-compatible.ts](../../../apps/api/src/drivers/image/openai-compatible.ts) 的 `classifyError`。

完整诊断维度(失败时全部 surface 到 console + `attempts[].errorMessage`):

| 维度 | 字段 | 价值 |
| --- | --- | --- |
| 事件谱 | `eventTypes: Record<string, number>` | 看上游发了哪些 SSE 事件类型——区分"代理静默"vs"代理发了 message item"vs"工具 incomplete" |
| Items added vs done | `itemsAdded` / `itemsDone` 按 `item.type` 分组 | 看模型调了几次工具、完成了几次——`added > done` 表示卡在 generating |
| Partial frames | `partialFrames` | 看是否拿到了部分图(代理在 partial 上有时能漏出图) |
| 模型说话 | `modelText` / `reasoningText` | 看模型有没有先输出文字"先分析一下..."这种 reasoning 偏离 |
| 上游错误 | `upstreamErrors[]` | 从 `response.failed` / `response.incomplete` 收割 `error.message` 字段 |
| 网络死法 | `streamError` + `describeCause(err)` | 解开 `err.cause` 区分 `UND_ERR_SOCKET`(代理 RST)/ `UND_ERR_BODY_TIMEOUT`(undici 掐)/ `ECONNRESET` |
| 跨代理 trace | `pickHeaderSnapshot(res.headers)` | 提取 `x-request-id` / `cf-ray` / `via` / `openai-request-id` 等 20 个常见追溯头 |
| 时间分布 | `maxEventGapMs` / `responseId` / `responseModel` | 看流卡在哪个空白段;上游真用了什么 model;上游 response id 用于查代理日志 |

## 副作用

- 失败错误信息比简单"fetch failed"长很多——但**诊断的目的就是不让任何一次失败浪费**
- 每个失败 attempt 在 SQLite `jobs.attempts` JSON 数组里多占空间(~1KB / attempt)——可接受
- 主流程零成本:`SseDiagnostics` 边读 SSE 边累积,成功路径不读 diag

## 关联条目

- [decisions/responses-mode-raw-fetch-sse](responses-mode-raw-fetch-sse.md) — 为什么用裸 fetch(就是为了诊断能看到原始事件)
- [pitfalls/anyrouter-complex-prompt-ceiling](../pitfalls/anyrouter-complex-prompt-ceiling.md) — 诊断完整性帮助锁定真凶的实战案例
- [pitfalls/responses-stream-result-missing](../pitfalls/responses-stream-result-missing.md) — diagnostic 在该 pitfall 里的具体应用
- [decisions/pool-retry-graded](pool-retry-graded.md) — `classifyError` 的诊断分支驱动 retry 决策
