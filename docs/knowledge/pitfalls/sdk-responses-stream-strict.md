# SDK `responses.stream` 要求事件序列以 `response.created` 开头

## 现象

调用 `client.responses.stream(body)` 通过 anyrouter 这类第三方代理时,SDK 抛错:

```
OpenAIError: When snapshot hasn't been set yet, expected
'response.created' event, got response.output_item.added
```

整个调用立即 unwind,即使后续事件流是正常的也拿不到结果。

## 根因

OpenAI SDK 内部 `ResponseStream` 维护一个状态机:第一个事件**必须**是 `response.created` 用来初始化 snapshot;snapshot 之后每个事件按 type 增量修改它(`output_item.added` 往 output 数组里 push 等)。

```js
// node_modules/openai/lib/responses/ResponseStream.mjs
if (!snapshot) {
  if (event.type !== 'response.created') {
    throw new OpenAIError(
      `When snapshot hasn't been set yet, expected 'response.created' event, got ${event.type}`,
    );
  }
  snapshot = event.response;
  return;
}
```

第三方代理(anyrouter 等)在转发 SSE 时有时**省略** `response.created` 事件,认为"客户端不需要 metadata"。SDK 容忍度=0,直接抛错。

## 规避

不要用 SDK 的 `responses.stream` 对接第三方代理。用 raw fetch + 手写 SSE parser 自己读事件(详见 [responses-mode-raw-fetch-sse](../decisions/responses-mode-raw-fetch-sse.md))。手写 parser 容忍任何事件顺序:

```ts
for await each event:
  switch (event.type) {
    case "response.output_item.done":
      if (event.item.type === "image_generation_call" && event.item.result) {
        finalFromDone = event.item.result;
      }
      break;
    case "response.image_generation_call.partial_image":
      lastPartial = event.partial_image_b64;
      break;
    // 其他事件忽略
  }
```

OpenAI 官方端点该用 SDK 仍然可用——SDK 严格性对官方是 feature,对代理是 bug。**两条路并存**:images 端点用 SDK([openai-sdk-over-fetch](../decisions/openai-sdk-over-fetch.md)),responses 端点用 raw fetch([responses-mode-raw-fetch-sse](../decisions/responses-mode-raw-fetch-sse.md))。

## 关联条目

- [responses-mode-raw-fetch-sse](../decisions/responses-mode-raw-fetch-sse.md) — 我们的对策
- [openai-sdk-over-fetch](../decisions/openai-sdk-over-fetch.md) — 对偶决策(images 端点继续用 SDK)
- [proxy-no-retrieve-endpoint](./proxy-no-retrieve-endpoint.md) — 同一代理另一个不兼容点
