# `/v1/images/*` 端点:用 `openai` SDK,不手搓 fetch

**适用范围**:仅限 `provider.extras.mode = "images"` 的 driver(`/v1/images/generations` 和 `/v1/images/edits`)。**`mode = "responses"` 反向走 raw fetch + 手写 SSE**——SDK 的流式 parser 对第三方代理过严格,见 [responses-mode-raw-fetch-sse](./responses-mode-raw-fetch-sse.md)。

## 背景

image driver 调 OpenAI 兼容 `/v1/images/generations`。直觉上 raw fetch 已经够,但实测被卡。

## 故事

inkast 第一版 driver 用 `fetch(url, { method: "POST", headers, body })`。配置好 provider 后调,**第三方 OpenAI 兼容代理返 403 HTML 页**(CDN 边缘拦,robots meta 是典型拦截特征)。

排查发现:Node 22+ 的 fetch (undici) 默认没设 User-Agent,被 CDN 当 bot 拦了。同样的 endpoint 用 gpt-image-canvas(也是 inkast 蓝本)能跑通,**因为它用 `openai` SDK**——SDK 自动带 `User-Agent: OpenAI/JS x.y.z` + 一组标准 fetch headers。

## 方案对比

|  | A: raw fetch | B: `openai` SDK |
| --- | --- | --- |
| 包大小 | 0(Node 内置) | ~200KB |
| User-Agent | 默认为空 → CDN 403 | 自动 `OpenAI/JS x.y.z` |
| 字段适配 | 自己手写 body 字段 | SDK 自动适配 `output_format` 等 gpt-image-2 新字段 |
| 错误类型 | 自己 classify | `APIError` / `APIConnectionTimeoutError` 等具名 |
| 自动重试 | 自己写 | SDK 默认 maxRetries=2 |
| 进度/流式 | 自己解 SSE | SDK 内置 |
| 类型安全 | 自己写 d.ts | SDK 自带 + size union 字段用 `as ImageGenerateParams` 强转(SDK 类型滞后,但功能 OK) |

## 最终选择

**B**:`openai` SDK,跟 gpt-image-canvas 对齐。

## 关键对齐项(我们和 gpt-image-canvas 完全一致)

- `new OpenAI({ apiKey, baseURL, timeout })`
- `client.images.generate({ model, prompt, size, quality, output_format, n })`
- `output_format: "png"` **必须传**——某些代理不传走 URL 慢路径,见 [sdk-output-format-missing](../pitfalls/sdk-output-format-missing.md)
- `maxRetries` 用 SDK 默认(2)
- `timeout` 600_000 ms(10 分钟,gpt-image-canvas 是 20 分钟)

## 故意保留的差异

**prompt 内容**:gpt-image-canvas 喂散文,inkast 喂 `JSON.stringify(prompt)`——这是 imagegen 方法论的核心,见 [prompt-as-json-not-prose](./prompt-as-json-not-prose.md)。

## 关联条目

- [provider-pool](../domains/provider-pool.md) — 调用方
- [openai-sdk-images](../integrations/openai-sdk-images.md) — SDK 用法
- [cdn-edge-403-without-ua](../pitfalls/cdn-edge-403-without-ua.md) — 第一版踩坑实录
- [sdk-output-format-missing](../pitfalls/sdk-output-format-missing.md)
- [image-driver-timeout-chain](../pitfalls/image-driver-timeout-chain.md)
