# 第三方代理不实现 `GET /v1/responses/:id`,polling 路死

## 现象

非流式调用 `client.responses.create()`,收到 `response.status="completed"` 但 `image_generation_call.status="generating"` + `result=null` 的"半成品"响应(代理在自己 HTTP 超时点强行 close)。

为了拿到完整结果,调用 `client.responses.retrieve(response.id)` 想轮询——立即 HTTP 404:

```
HTTP 404: Invalid URL (GET /v1/responses/resp_06baf4b7144bd113...)
```

## 根因

第三方 OpenAI 兼容代理(anyrouter 等)只**部分**实现 OpenAI API——通常只实现高频端点(POST /chat/completions、POST /images/generations、POST /responses),不实现配套的 retrieve / delete / list 端点(GET /v1/responses/:id、DELETE 等)。

这是设计取舍而不是 bug:代理大多无状态转发,没存任何 `response.id`,自然实现不了 retrieve。

## 规避

不要依赖 retrieve 轮询。两条路:

1. **流式调用** (`stream: true` 进 body)——代理会保持连接直到工具完成,在一次 HTTP 调用里把所有事件推过来。**当前 inkast 走这条**(详见 [responses-mode-raw-fetch-sse](../decisions/responses-mode-raw-fetch-sse.md))
2. **依赖 OpenAI 官方端点**——它实现完整,polling 可工作。但代理无法兜底

如果将来有"长任务 + 断线续传"场景,只能通过本机后端 + 推送(不依赖 retrieve)实现。

## 关联条目

- [responses-mode-raw-fetch-sse](../decisions/responses-mode-raw-fetch-sse.md) — 流式是当前的对策
- [sdk-responses-stream-strict](./sdk-responses-stream-strict.md) — 流式 SDK 又有另一个坑(不能用 SDK 流式)
- [responses-stream-result-missing](./responses-stream-result-missing.md) — 流式调用本身也可能拿不到结果
