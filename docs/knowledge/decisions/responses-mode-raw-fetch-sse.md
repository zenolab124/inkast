# Responses mode driver:裸 fetch + 手写 SSE,**不用** OpenAI SDK

一句话:`/v1/responses` 端点的 driver 绕开 OpenAI SDK,直接用 Node fetch + 自己解析 SSE 事件流。这跟 [openai-sdk-over-fetch](./openai-sdk-over-fetch.md)(images 端点用 SDK)是对偶决策——两个端点走两条路。

## 背景

接入 anyrouter 这类第三方 OpenAI 兼容代理时,`/v1/responses` 路径连续踩了 3 个坑(全部归因于代理的"OpenAI 兼容"不严格):

1. **非流式 create 返回半成品** — 代理在自己 HTTP 超时(~60s)后强行 close,response.status="completed" 但 image_generation_call.status="generating",`result=null`
2. **没有 GET /v1/responses/:id** — 用 SDK 的 `responses.retrieve(id)` 想轮询,直接 HTTP 404
3. **SDK 的 stream parser 严格** — `client.responses.stream()` 内部维护 snapshot 状态机,**必须**第一个事件是 `response.created`,代理跳过了这个事件直接发 `output_item.added`,SDK 抛 `When snapshot hasn't been set yet, expected 'response.created' event, got X` 然后整个调用炸掉

## 方案对比

| | SDK 非流式 | SDK 流式 | 裸 fetch + 手写 SSE(选中) |
| --- | --- | --- | --- |
| 代码量 | 最小 | 中 | 中(SSE parser ~50 行) |
| 长任务(>60s) | 拿不到完整 result | 可拿到 | 可拿到 |
| 严格事件顺序 | n/a | 必须 | 容忍任何顺序 |
| 漏发事件 | 不存在(单 response) | SDK 直接抛错 | 跳过不识别的 |
| 透传额外字段 | SDK 过滤 | SDK 过滤 | 全部留 |

## 最终选择

裸 fetch + 自己解 SSE。三层防御取 base64:

1. **首选** `response.output_item.done`,item.type=`image_generation_call`,item.result 是 base64
2. **次选**:累计 `response.image_generation_call.partial_image` 事件,最后一帧是完整图
3. **保底**:有些代理把 result 塞在 `response.image_generation_call.completed` 上,也接收

只要任一命中,流结束就返回。三种都没命中才报"stream ended without result"。

实现位置:`apps/api/src/drivers/image/openai-responses.ts`(整文件不 import openai SDK)。

## 副作用

- 失去 SDK 自带 User-Agent 优势——但 anyrouter 这类代理对 raw fetch 友好(它们本身就在用 fetch 转发);grok2api 等老牌代理 UA 拦截 CDN 不走 /v1/responses,影响有限
- 失去 SDK 自动重试——但我们的 provider 池在外层做 fallback,重试粒度更合适
- 失去类型安全——SSE 事件体是 `Record<string, unknown>`,手写一个 `SseEventPayload` 局部类型兜底

## 关联条目

- [openai-sdk-over-fetch](./openai-sdk-over-fetch.md) — 对偶决策(images 端点为何用 SDK)
- [image-mode-coexistence](./image-mode-coexistence.md) — 上层架构
- [forced-tool-choice-plus-directive](./forced-tool-choice-plus-directive.md) — 让模型真的调工具
- [sdk-responses-stream-strict](../pitfalls/sdk-responses-stream-strict.md) — SDK 严格性的具体表现
- [proxy-no-retrieve-endpoint](../pitfalls/proxy-no-retrieve-endpoint.md) — 为什么不能 polling
- [responses-stream-result-missing](../pitfalls/responses-stream-result-missing.md) — 三层兜底的依据
