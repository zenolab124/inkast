# 生图端到端

从用户点击"生图"到图落盘 + 入库的完整流水。

## 架构

```
POST /api/generate-image { prompt: ImagePrompt, size?, quality? }
    │
    ▼
server/routes/generate.ts  · 参数校验 + 错误码映射
    │
    ▼
domain/generate/index.ts  · generate()
    │
    │  1. promptText = JSON.stringify(prompt)  ← 整个 JSON 字符串作 prompt
    │
    │  2. drivers/image/openai-compatible.ts · generateImage(input)
    │     · listProviderKeys() 拿池
    │     · for-of 走池,内部 new OpenAI(...) → client.images.generate({...})
    │     · 返 ImageGenOutcome { imageB64, format, providerId, attempts }
    │
    │  3. 路径:imagePathFor("png") → YYYY/MM/<uuid>.png  (UTC)
    │     · mkdirSync 递归
    │     · writeFile(absolutePath, Buffer.from(b64, 'base64'))
    │
    │  4. createGeneration({...}) → INSERT INTO generations
    │
    ▼
{ generation: GenerationRecord, driver: { providerName, providerId, attempts, totalDurationMs } }
```

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `apps/api/src/server/routes/generate.ts` | POST /generate-image, GET /generations, GET /generations/:id/image |
| `apps/api/src/domain/generate/index.ts` | 编排 driver + 落盘 + 入库 |
| `apps/api/src/drivers/image/openai-compatible.ts` | 池 walk + openai SDK 调用 |
| `apps/api/src/storage/generations.ts` | generations 表 CRUD |
| `apps/api/src/storage/runtime.ts` | `imagesDir()` 解析 `<DATA_DIR>/images/` |
| `apps/web/src/features/gallery/api.ts` | 前端 client + `generationImageUrl(id)` |

## 落盘路径策略

```
<DATA_DIR>/images/YYYY/MM/<uuid>.png
```

- `<DATA_DIR>`: 默认 `<repo>/data`(开发),可由 `INKAST_DATA_DIR` 环境变量覆盖
- `YYYY/MM` 按 UTC 计算
- 文件名用 `crypto.randomUUID()`,**不复用 generation row id**——因为图先写,row 后建,id 顺序倒过来会冲突

## 图片 URL

`GET /api/generations/:id/image` 直接返图片字节(不是 base64),响应头:

- `Content-Type: image/png|jpeg|webp`(按 `imageFormat` 字段)
- `Cache-Control: private, max-age=31536000, immutable`(uuid 文件名保证不变,可长缓存)

URL 路径用 `sanitizeRelativePath()` 防止 `..` 越界。

## 默认参数

| 字段 | 默认 |
| --- | --- |
| `size` | `1024x1024` |
| `quality` | `high` |
| `n` | `1` |
| `output_format` | `png` |
| timeout | `600_000` ms (10 分钟) |

## 异步化 + Reference Image 分支

`generate()` 现在被 `runGenerationJob(jobId, input)` 包装(`domain/generate/index.ts`),前端通过 `POST /api/jobs/generate` 触发异步任务流水线,见 [async-job-pipeline](./async-job-pipeline.md)。同步路径 `POST /api/generate-image` 保留兜底但前端已不调用。

driver 内部根据 `input.referenceImage` 是否存在,分流走 `client.images.edit`(图 + 文本)或 `client.images.generate`(纯文本),见 [reference-image](./reference-image.md)。

`generate()` 也接受 `rawPrompt?: string` —— "直接生图"路径绕过 prompt engine,把散文文本直接喂给图像模型,见 [generate-now-raw-prompt-path](../decisions/generate-now-raw-prompt-path.md)。

## 关联条目

- [async-job-pipeline](./async-job-pipeline.md) — 异步任务包装
- [reference-image](./reference-image.md) — `images.edit` 分支
- [provider-pool](./provider-pool.md) — 池切换语义
- [gallery](./gallery.md) — 看图
- [openai-sdk-images](../integrations/openai-sdk-images.md) — SDK 调用细节
- [image-driver-timeout-chain](../pitfalls/image-driver-timeout-chain.md) — 超时设计
- [sdk-output-format-missing](../pitfalls/sdk-output-format-missing.md) — output_format 字段的坑
- [browser-idle-timeout-long-http](../pitfalls/browser-idle-timeout-long-http.md) — 推动异步化的根因
- [shared-contracts](../shared/shared-contracts.md) — `GenerateImageRequest` / `JobRecord` / `ReferenceImage` 字段
