# OpenAI SDK 不传 `output_format` 走 URL 慢路径

**What**: 用 `openai` SDK 调 `images.generate` 时,**没传 `output_format` 字段**。某些第三方 OpenAI 兼容代理**默认返 URL 而不是 `b64_json`**——driver 不得不再 fetch URL 一遍才拿到字节,多一个网络 hop。在慢链路 + 不稳定 CDN 上,这个多余 hop 容易触发超时。

**Why**: OpenAI 官方 `gpt-image-2` 文档约定 `output_format` 字段(`"png"` / `"jpeg"` / `"webp"`)。不传时**官方端默认返 `b64_json`**,但第三方代理实现不一致:

- 有的兼容默认 b64
- 有的兼容默认 URL(节省他们的带宽,把图丢到 CDN 让客户端去拉)
- 有的兼容报 400(嫌字段缺失)

不传等于把行为决定权完全让给上游,延迟和稳定性都不可控。

**Action**: **永远传 `output_format: "png"`**(或 jpeg/webp,根据需要):

```ts
const body = {
  model, prompt, size, quality,
  output_format: "png",          // 必传
  n: 1,
} as unknown as ImageGenerateParams;
```

`ImageGenerateParams` 类型 union 还没含 output_format(SDK 滞后),用 `as unknown as` 强转。

driver 仍保留 `b64_json` / `url` 双路径解析(`url` fallback 还能用,但应该极少触发)。

## 关联条目

- [openai-sdk-images](../integrations/openai-sdk-images.md)
- [openai-sdk-over-fetch](../decisions/openai-sdk-over-fetch.md)
- [image-driver-timeout-chain](./image-driver-timeout-chain.md)
