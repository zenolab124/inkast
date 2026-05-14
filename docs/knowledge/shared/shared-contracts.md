# 前后端共享契约 — `@inkast/shared`

唯一一个 pure-types 包,packages/shared 没有运行时代码。任何"前端调后端"或"两端共用形状"的类型都在这里,被 `apps/api` 和 `apps/web` 同时 import。

## 导出清单

```
@inkast/shared
  ├─ prompt.ts        ImagePrompt / TextElement / AmbiguityHint / PromptDraft
  └─ api.ts           DraftPromptRequest/Response / GenerateImageRequest/Response
                      ProviderSummary / ProviderCreate/UpdateRequest
                      GenerationRecord / GenerateImageAttempt
                      LlmBackend / ImageSize / ImageQuality
```

## 关键类型角色

### `ImagePrompt`(prompt.ts)

```ts
interface ImagePrompt {
  type: string;         // 必填:image type (照片/插画/海报/信息图...)
  style: string;        // 必填:画风
  subject: string;      // 必填:主体 — 也可以是 object(被 LLM 自动展开)
  background?: string;
  layout?: string;
  text_elements?: TextElement[];
  lighting?: string;
  mood?: string;
  camera?: string;
  color_palette?: string[];
  count?: number;
  [extra: string]: unknown;  // 故意开放:LLM 可自创字段
}
```

**开放结构是设计意图**:imagegen 方法论允许 LLM 按场景自创 `subject_details`、`grid`、`card_structure` 等子字段。schema 校验只锁顶层 `{prompt, hints}`。

### `AmbiguityHint`(prompt.ts)

```ts
interface AmbiguityHint {
  field: string;        // 哪个字段需要补
  suggestion: string;   // 怎么补
}
```

`field` 是 `string` 而不是 `keyof ImagePrompt`——因为 ImagePrompt 是开放结构,索引签名让 keyof 变成 `string | number | symbol`,反而难用。

### `ProviderSummary`(api.ts)

`keyMasked: string`(`sk-x••••••••wxyz`)而不是原 key。**前端永远拿不到 plaintext key**——加密在 SQLite,解密只在 driver 调用时透明发生。

### `GenerateImageResponse.driver.attempts: GenerateImageAttempt[]`

每次生图请求,响应里完整列出所有 attempt(成功 + 失败),前端 flash 用来展示 fallback 链。

## 编译产物

`packages/shared/package.json` 用 tsc 输出 `dist/`(包含 .js + .d.ts + .d.ts.map),`apps/*` 通过 `workspace:*` 引用。

**Important**: 改动 `packages/shared/src/` 后,**必须 `pnpm --filter @inkast/shared build` 重建**,然后下游 tsc 才能看到新类型。开发期 watch 模式:`pnpm --filter @inkast/shared dev`。

## 新增类型(async jobs / reference image / i18n)

| 类型 | 用途 |
| --- | --- |
| `OutputLang = "zh" \| "en"` | LLM 起草的输出语言(`DraftPromptRequest.lang`) |
| `ReferenceImage` | 参考图,union `{kind:"generation",generationId}` 或 `{kind:"upload",mimeType,dataBase64}` |
| `JobStatus = "pending"\|"running"\|"succeeded"\|"failed"` | 异步 job 生命周期 |
| `JobRecord` | jobs 表行,含 promptSnapshot / promptText / isRaw / size / quality / generationId / attempts / errorCode / errorMessage / createdAt / startedAt / completedAt |
| `SubmitJobRequest = GenerateImageRequest` | 提交 job 用,与同步 generate 一样 body |
| `SubmitJobResponse` | `{jobId, status:"pending"}` |
| `ListJobsResponse` | `{jobs: JobRecord[]}` |

`GenerateImageRequest` 加了:
- `rawPrompt?: string` —— 直接生图路径(绕 prompt engine,见 [generate-now-raw-prompt-path](../decisions/generate-now-raw-prompt-path.md))
- `referenceImage?: ReferenceImage` —— 启用 `images.edit` 路径

`DraftPromptRequest` 加了 `lang?: OutputLang`。

## 关联条目

- [prompt-engine](../domains/prompt-engine.md) — `PromptDraft` 的产出方
- [provider-pool](../domains/provider-pool.md) — `ProviderSummary` 的消费方
- [image-generation](../domains/image-generation.md) — `GenerationRecord` 的产出方
- [async-job-pipeline](../domains/async-job-pipeline.md) — `JobRecord` 的消费方
- [reference-image](../domains/reference-image.md) — `ReferenceImage` 用法
- [i18n](../domains/i18n.md) — `OutputLang`
- [crypto-utils](./crypto-utils.md) — 为什么前端拿不到 plaintext
