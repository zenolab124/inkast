# OpenAI image_generation 工具锁死 reasoning_effort=minimal

## What

向 `POST /v1/responses` 发请求时,如果 `tools` 包含 `image_generation` 且 `reasoning.effort: "minimal"`,**OpenAI 官方直接返回 HTTP 400**:

```json
{
  "error": {
    "message": "The following tools cannot be used with reasoning.effort 'minimal': image_gen.",
    "type": "invalid_request_error",
    "param": "tools"
  }
}
```

(anyrouter 这条错误是从上游 OpenAI 透传的——不是代理自己的限制。)

## Why

OpenAI 的设计:`image_generation` 工具**必须**配 reasoning。意味着这个工具内部需要模型先做规划/思考阶段,再生成图像。`minimal` reasoning 不允许,最低允许的是 `"low"`。

这条限制的下游含义:**每次 image_generation 工具调用都强制消耗 reasoning tokens**。复杂 prompt 的 reasoning 负担直接传导到工具调用,reasoning 吃光 token 后工具可能卡死(见 [anyrouter-complex-prompt-ceiling](anyrouter-complex-prompt-ceiling.md))。

## Action

- ❌ 不要传 `reasoning.effort: "minimal"`(会 400)
- ❌ 不要靠 `reasoning.effort: "low"` 来"减少 reasoning 拯救复杂 prompt"——实测 `low` 跟不传 / `medium` / 默认行为 0/3 失败模式完全一致,token 假设破产
- ✅ 当前 driver 不传 `reasoning` 字段,走 OpenAI 默认(应该是 `medium`),让上游自决
- ✅ `max_output_tokens` 也不传——验证过显式给大数也救不了复杂 prompt

driver 实现:[apps/api/src/drivers/image/openai-responses.ts](../../../apps/api/src/drivers/image/openai-responses.ts) body 构造时**不传**这两个字段,保留默认。

## 关联条目

- [pitfalls/anyrouter-complex-prompt-ceiling](anyrouter-complex-prompt-ceiling.md) — 配套现象(0% 成功率)
- [decisions/responses-mode-raw-fetch-sse](../decisions/responses-mode-raw-fetch-sse.md) — 为什么用裸 fetch 而非 SDK(看得见 OpenAI 原始错误)
