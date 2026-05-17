# OpenAI Image API **不返回** seed,Gallery 不要显示 seed 字段

## 现象

早期 Gallery 详情页有一个"种子 (seed)"字段,展示一个 8 位整数,但用户复制这个数字用于 `images.generate` 的 `seed` 参数时,**完全复现不了原图**——每次出图都不一样,seed 像是假的。

## 根因

OpenAI Image API(`/v1/images/generations` 和 `/v1/images/edits`)的响应**根本没有** seed 字段。官方 schema 是:

```
{
  created: number,
  data: [{ b64_json | url, revised_prompt? }],
  // 没有 seed
  model?: string,
  output_format?: string
}
```

之前我们的 GenerationRecord 里"seed"是后端**手动 mock** 的——`Math.floor(Math.random() * 1e8)`,跟实际生图过程毫无关系。展示在 UI 上是误导。

## 规避

- **从 GenerationRecord 移除 seed 字段**(及对应 SQL 列)
- Gallery 详情页 meta 区不显示 seed
- 文档明确:gpt-image-2 / DALL-E 系列**不支持** seed 复现——它们是 transformer-based 非 diffusion,output 具体细节不可重复
- 如果将来接入 SD/SDXL 这种 diffusion 模型,**它们的 seed 是真实的**,可以重新加 seed 字段——但前提是 driver 拿得到

## 教训

第三方 API 没承诺的字段不要 mock 进数据契约——会形成"用户以为可用,实际不能用"的误导。如果非要展示什么"标识图像的整数",用 `generationId.slice(0,8)` 这种从 inkast 内部生成的 ID 截一段,语义清晰。

## 关联条目

- [openai-sdk-images](../integrations/openai-sdk-images.md) — API 实际字段
- [image-generation](../domains/image-generation.md) — GenerationRecord
- [shared-contracts](../shared/shared-contracts.md) — 类型清单
