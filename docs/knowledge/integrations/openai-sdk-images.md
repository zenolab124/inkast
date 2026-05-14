# `openai` SDK — images.generate

OpenAI 官方 TS SDK,inkast 用它调 OpenAI 兼容图像端点。

## 选型原因

见 [openai-sdk-over-fetch](../decisions/openai-sdk-over-fetch.md)。一句话:第三方代理对无 UA 的 raw fetch 经常 403,SDK 自带 User-Agent 才能稳定通过。

## 使用方式

`apps/api/src/drivers/image/openai-compatible.ts`:

```ts
import OpenAI, { APIError } from "openai";
import type { ImageGenerateParams } from "openai/resources/images";

const client = new OpenAI({
  apiKey,
  baseURL: provider.baseUrl.replace(/\/+$/, ""),
  timeout: 600_000,        // 10 分钟
  // maxRetries 用 SDK 默认 (2),透明重试 transient 网络错误
});

const body = {
  model: provider.model,
  prompt: input.promptText,
  size: input.size ?? "1024x1024",
  quality: input.quality ?? "high",
  output_format: "png",    // ⚠️ 必传,见 pitfalls/sdk-output-format-missing
  n: input.n ?? 1,
} as unknown as ImageGenerateParams;

const response = await client.images.generate(body, { signal });
```

## 关键字段

| 字段 | 备注 |
| --- | --- |
| `model` | 来自 provider 配置的 `model` 列,默认 `gpt-image-2` |
| `prompt` | `JSON.stringify(promptObj)` — 整个 JSON 字符串(imagegen 方法论) |
| `size` | `"1024x1024"` / `"1024x1536"` / `"1536x1024"` (SDK 类型 union 滞后,强转过) |
| `quality` | `"low"` / `"medium"` / `"high"` |
| `output_format` | **`"png"` 必传** |
| `n` | 默认 1,Phase 1 不暴露给用户调 |

`as unknown as ImageGenerateParams` 强转是因为 SDK 的 TS 类型滞后于 gpt-image-2 的 size/quality/output_format 字段。功能 OK,跟 gpt-image-canvas 同套路。

## 响应处理

```ts
const first = response.data?.[0];
if (first?.b64_json) return first.b64_json;
if (first?.url) {
  // fallback: 某些代理返 URL,自己 fetch 下来 base64
  const res = await fetch(first.url, { signal });
  return Buffer.from(await res.arrayBuffer()).toString("base64");
}
throw new Error("provider returned no image");
```

`output_format: "png"` 传了的话,一般直接拿 `b64_json`。

## 错误分类

```ts
if (err instanceof APIError) {
  // err.status / err.code / err.type / err.message
  // moderation 关键字 → "moderation"(不切下家)
  // 401/403 → "auth"
  // 429 → "rate_limit"
  // 5xx → "server"
}
```

详见 [provider-pool](../domains/provider-pool.md) 错误表。

## peer dep 冲突

`openai@4.x` 要 `zod@^3.23.8`,跟 `claude-agent-sdk` 的 `zod@^4.0.0` 冲突。inkast 选 `zod@^3.25.0` 满足 openai,接受 SDK 的 peer warn(运行时无影响)。

## 已知版本

`^4.77.0`(实测 4.104.0 安装)。

## `images.edit` 分支(reference image)

`input.referenceImage` 存在时,driver 调 `client.images.edit({ image, prompt, model, size, n })` 而不是 `images.generate`。`image` 参数用 OpenAI SDK 的 `toFile(buffer, filename, { type: mimeType })` 包装成 Uploadable。

```ts
import { toFile } from "openai";
const file = await toFile(buffer, filename, { type: mimeType });
const response = await client.images.edit({
  model: provider.model, image: file, prompt: input.promptText,
  size: input.size ?? "1024x1024", n: input.n ?? 1,
});
```

注意 `images.edit` 不接 `quality` / `output_format` 参数;第三方代理也不一定实现,见 [reference-edit-endpoint-not-universal](../pitfalls/reference-edit-endpoint-not-universal.md)。

## 关联条目

- [openai-sdk-over-fetch](../decisions/openai-sdk-over-fetch.md) — 选型故事
- [image-generation](../domains/image-generation.md) — 调用方
- [reference-image](../domains/reference-image.md) — `images.edit` 的消费方
- [reference-image-via-edit](../decisions/reference-image-via-edit.md)
- [cdn-edge-403-without-ua](../pitfalls/cdn-edge-403-without-ua.md)
- [sdk-output-format-missing](../pitfalls/sdk-output-format-missing.md)
- [image-driver-timeout-chain](../pitfalls/image-driver-timeout-chain.md)
- [reference-edit-endpoint-not-universal](../pitfalls/reference-edit-endpoint-not-universal.md)
