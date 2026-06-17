# 生图端到端

从用户点击"生图"到图持久化(R2 / 本地)+ 入库的完整流水。

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
    │  3. persistImage(bytes, format)  ← 配置驱动(R2 enabled / 本地降级)
    │     · R2 enabled(凭据齐,生产):PUT inkast-storage/webui/<uuid>.<ext>,
    │       image_path 存 R2 key、image_url 存公开 URL,不写本地
    │     · R2 disabled(dev 无凭据):writeFile <DATA_DIR>/images/YYYY/MM/<uuid>.<ext>,
    │       image_path 存相对路径、image_url=null
    │
    │  4. createGeneration({...imagePath, imageUrl}) → INSERT INTO generations
    │
    ▼
{ generation: GenerationRecord, driver: { providerName, providerId, attempts, totalDurationMs } }
```

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `apps/api/src/server/routes/generate.ts` | POST /generate-image, GET /generations, GET /generations/:id/image |
| `apps/api/src/domain/generate/index.ts` | 编排 driver + 落盘 + 入库 |
| `apps/api/src/drivers/image/openai-compatible.ts` | 池 walk + 三路 mode 分发 |
| `apps/api/src/drivers/image/c2i-tasks.ts` | c2i-tasks 异步任务 driver(chatgpt2api) |
| `apps/api/src/storage/generations.ts` | generations 表 CRUD |
| `apps/api/src/domain/generate/r2-config.ts` | Web UI 通道 R2 配置(`enabled = 凭据齐`,bucket/base/prefix 带默认值) |
| `apps/api/src/storage/runtime.ts` | `imagesDir()` 解析 `<DATA_DIR>/images/`(仅 R2 disabled 降级时用) |
| `apps/web/src/features/gallery/api.ts` | 前端 client + `generationImageUrl(id)` |

## 图片持久化:纯 R2 / 本地降级(v2.43 起)

`persistImage(bytes, format)` 配置驱动二选一,开关是 `loadWebuiR2Config().enabled`:

| | R2 enabled(生产 jdc) | R2 disabled(本地 dev) |
| --- | --- | --- |
| 触发条件 | `R2_*` 凭据三件齐(bucket/base 有默认值,实质只看凭据) | 缺凭据 |
| 落点 | PUT `inkast-storage/webui/<uuid>.<ext>` | `<DATA_DIR>/images/YYYY/MM/<uuid>.<ext>` |
| `image_path` | R2 key(`webui/<uuid>.<ext>`) | 本地相对路径(`YYYY/MM`,UTC) |
| `image_url` | 公开 URL `https://static.124213.xyz/webui/...` | `null` |
| 失败 | 抛 `ImageGenError`(该次生图失败,**无本地兜底**) | — |

- 文件名用 `crypto.randomUUID()`,**不复用 generation row id**——图先持久化,row 后建,id 顺序倒过来会冲突
- bucket/base/prefix 默认 `inkast-storage` / `static.124213.xyz` / `webui/`,可 `INKAST_WEBUI_R2_*` env 覆盖,凭据复用 `R2_*`(与 plugin 通道同一套)
- 为什么纯 R2 不留本地、为什么 R2 挂就 fail,见 [webui-channel-pure-r2](../decisions/webui-channel-pure-r2.md)

## 图片 URL:302 重定向

`GET /api/generations/:id/image` —— **前端始终调这个端点**(`generationImageUrl(id)`),后端按 row 状态二选一:

- `image_url` 有值(纯 R2)→ `302` 重定向到 CDN,浏览器直连 `static.124213.xyz`,**图字节不过 jdc 上行**
- `image_url` 为 null(dev / pre-R2 历史)→ 读本地字节返回(`Content-Type` 按 `imageFormat`,`Cache-Control: immutable`),路径用 `sanitizeRelativePath()` 防 `..` 越界

302 方案让前端零改动,且存量迁移期间平滑兼容(未迁的走本地、已迁的走 CDN),见 [migrate-webui-images-to-r2](../workflows/migrate-webui-images-to-r2.md)。

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

## 三种 image mode 调度(images / responses / c2i-tasks)

`drivers/image/openai-compatible.ts` 池循环里按 `capability.extras.mode` 派发(默认 `images`):

```
provider.extras.mode = "images"    → callProvider() = client.images.generate / images.edit (OpenAI SDK)
                     = "responses" → callImageGenerationTool() = raw fetch /v1/responses + SSE
                     = "c2i-tasks" → callC2iTasksApi() = chatgpt2api 异步任务 API
```

`responses` mode 为接入"通用聊天模型 + image_generation 工具"(gpt-5.3-codex 等)新加的,不用 OpenAI SDK,直接 fetch + SSE。详见 [image-mode-coexistence](../decisions/image-mode-coexistence.md) 和 [responses-mode-raw-fetch-sse](../decisions/responses-mode-raw-fetch-sse.md)。

`c2i-tasks` mode 为接入 chatgpt2api 异步任务 API 新加,支持**无数量限制的多参考图**。流程:

1. **submit**: POST `/api/image-tasks/{edits|generations}`(有参考图走 edits,无走 generations）
2. **poll**: GET `/api/image-tasks?ids=${taskId}`——初始 3s,×1.5 退避,cap 15s
3. **success** → 取 `data[0].b64_json`;**error** → 抛错进 classifyError
4. running 超 5 分钟 → 触发一次 `resume-poll` 续期

参考图传输格式:JSON `images` 数组,每项 `data:${mimeType};base64,${buffer}`。

| 方面 | images | responses | c2i-tasks |
| --- | --- | --- | --- |
| 参考图上限 | 1 张 | 16 张 | 无限制 |
| 同步性 | 同步 | 同步(SSE) | 异步(轮询) |
| 上游 API | /v1/images/* | /v1/responses | /api/image-tasks/* |

错误分类、attempts 计数、fallback 切换在三个 mode 之间**共享**——池语义不变。

## Size 三种 wire 形态翻译

`input.size` 字段(类型 `ImageSize = string`)目前接受三种形态,driver 在传给上游前必须翻译:

| Wire 值 | images mode | responses mode | c2i-tasks mode |
| --- | --- | --- | --- |
| `"auto"` | `size: "auto"` 给 SDK | prompt 不加 dimension 提示 | 不传 size |
| `"WxH"`(如 `1024x1536`) | `size: "1024x1536"` | prompt 加 `Target size: 1024x1536.` | `size: "1024x1536"` |
| `"ratio:W:H"`(如 `ratio:9:16`) | **不传 size** + prompt 加 ratio | prompt 加 ratio | **不传 size** + prompt 加 ratio |

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
- [webui-channel-pure-r2](../decisions/webui-channel-pure-r2.md) — 生图存储为什么改纯 R2
- [cloudflare-r2](../integrations/cloudflare-r2.md) — R2 driver + webui/ 路径
- [migrate-webui-images-to-r2](../workflows/migrate-webui-images-to-r2.md) — 存量迁移流程
