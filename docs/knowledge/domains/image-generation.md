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

## 两种 image mode 调度(images / responses)

`drivers/image/openai-compatible.ts` 池循环里现在按 `capability.extras.mode` 派发,默认 `images`:

```
provider.extras.mode = "images"    → callProvider() = client.images.generate / images.edit
                     = "responses" → callImageGenerationTool() = raw fetch /v1/responses + SSE
```

`responses` mode 是为接入"通用聊天模型 + image_generation 工具"(gpt-5.3-codex 等)新加的,**走完全不同的代码路径**——不用 OpenAI SDK,直接 fetch + 手写 SSE 解析。详见 [image-mode-coexistence](../decisions/image-mode-coexistence.md) 和 [responses-mode-raw-fetch-sse](../decisions/responses-mode-raw-fetch-sse.md)。

错误分类、attempts 计数、fallback 切换在两个 mode 之间**共享**——池语义不变。

## Size 三种 wire 形态翻译

`input.size` 字段(类型 `ImageSize = string`)目前接受三种形态,driver 在传给上游前必须翻译:

| Wire 值 | images mode | responses mode |
| --- | --- | --- |
| `"auto"` | `size: "auto"` 给 SDK | prompt 不加 dimension 提示 |
| `"WxH"`(如 `1024x1536`) | `size: "1024x1536"` | prompt 加 `Target size: 1024x1536.` |
| `"ratio:W:H"`(如 `ratio:9:16`) | **不传 size 参数** + prompt 加 `Target aspect ratio: 9:16.` | prompt 加 `Target aspect ratio: 9:16.` |

详见 [ratio-wire-encoding](../decisions/ratio-wire-encoding.md)。

## 批量生图

前端"一次生 N 张"(滑块 1-20)通过 **前端 N 个并发 submitJob 调用**实现,**不**通过 driver 一次调用拿 N 张——`gpt-image-2` 官方 `n=1`,绕过这个限制最干净的方式是 fan-out 多 job。详见 [batch-fan-out-frontend](../decisions/batch-fan-out-frontend.md)。

## 关联条目

- [async-job-pipeline](./async-job-pipeline.md) — 异步任务包装
- [reference-image](./reference-image.md) — `images.edit` 分支
- [provider-pool](./provider-pool.md) — 池切换语义
- [gallery](./gallery.md) — 看图
- [openai-sdk-images](../integrations/openai-sdk-images.md) — SDK 调用细节
- [image-mode-coexistence](../decisions/image-mode-coexistence.md) — images / responses 两模式并存
- [responses-mode-raw-fetch-sse](../decisions/responses-mode-raw-fetch-sse.md) — responses driver 设计
- [ratio-wire-encoding](../decisions/ratio-wire-encoding.md) — size 第三种形态
- [batch-fan-out-frontend](../decisions/batch-fan-out-frontend.md) — N 张并发
- [image-driver-timeout-chain](../pitfalls/image-driver-timeout-chain.md) — 超时设计
- [sdk-output-format-missing](../pitfalls/sdk-output-format-missing.md) — output_format 字段的坑
- [browser-idle-timeout-long-http](../pitfalls/browser-idle-timeout-long-http.md) — 推动异步化的根因
- [shared-contracts](../shared/shared-contracts.md) — `GenerateImageRequest` / `JobRecord` / `ReferenceImage` 字段
