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

## Size wire 第三种形态 + Image mode 类型

```ts
// api.ts
export const SIZE_AUTO = "auto";
export const SIZE_RATIO_PREFIX = "ratio:";
export type ImageGenerationMode = "images" | "responses";
export const IMAGE_GENERATION_MODE_DEFAULT: ImageGenerationMode = "images";

export function isRatioSize(v: string | null | undefined): boolean;
export function extractRatio(v: string | null | undefined): string | null;
export function makeRatioSize(ratio: string): string;
```

- `ImageSize = string` 故意宽松——三种形态(`"auto"` / `"WxH"` / `"ratio:W:H"`),driver 翻译,详见 [ratio-wire-encoding](../decisions/ratio-wire-encoding.md)
- `ImageGenerationMode` 写在 `provider_capabilities.extras.mode` 字段里,driver 调度依据,详见 [image-mode-coexistence](../decisions/image-mode-coexistence.md)
- 历史记录里的 `GenerationRecord.size` 是**当时用户选的 wire 值**,不是上游实际生成的尺寸——详见 [ratio-not-resolution-guarantee](../decisions/ratio-not-resolution-guarantee.md)

## ProviderCapability 类型

```ts
export interface ProviderCapability {
  kind: "image" | "llm";
  model: string;
  priority: number;
  disabled: boolean;
  extras: Record<string, unknown> | null;  // JSON blob, kind-specific
}
export interface ProviderSummary {
  id: string;
  name: string;
  baseUrl: string;
  keyMasked: string;
  capabilities: ProviderCapability[];  // 一个 provider 多个 kind
  createdAt: number;
  updatedAt: number;
}
```

`extras` 语义按 kind 分:

| kind | extras 已知字段 |
| --- | --- |
| `image` | `mode: "images" \| "responses"` |
| `llm` | `model / effort / thinking / fallbackModel / maxTurns`(详见 [llm-driver-knobs](../decisions/llm-driver-knobs.md)) |

`BUILTIN_CLAUDE_CODE_PROVIDER_ID = "__builtin_claude_code__"` 是保留 id(详见 [claude-code-builtin-provider](../decisions/claude-code-builtin-provider.md))。

## prose / aiFilledFields(记录用户原话 + AI 来源)

`GenerationRecord` 和 `JobRecord` 都有:

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `prose` | `string \| null` | 用户在 composer 输入的原始散文 |
| `aiFilledFields` | `string[] \| null` | 哪些字段是 AI 扩充填的(`["subject", "style"]` 等) |

`GenerateImageRequest` 和 `SubmitJobRequest` 同时接 `prose?` 和 `aiFilledFields?`,从前端透传到后端入库。详见 [prose-persisted-with-prompt](../decisions/prose-persisted-with-prompt.md)。

## 关联条目

- [prompt-engine](../domains/prompt-engine.md) — `PromptDraft` 的产出方
- [provider-pool](../domains/provider-pool.md) — `ProviderSummary` / `ProviderCapability` 的消费方
- [image-generation](../domains/image-generation.md) — `GenerationRecord` 的产出方
- [async-job-pipeline](../domains/async-job-pipeline.md) — `JobRecord` 的消费方
- [reference-image](../domains/reference-image.md) — `ReferenceImage` 用法
- [i18n](../domains/i18n.md) — `OutputLang`
- [crypto-utils](./crypto-utils.md) — 为什么前端拿不到 plaintext
- [ratio-wire-encoding](../decisions/ratio-wire-encoding.md) — `ratio:*` wire 形态
- [image-mode-coexistence](../decisions/image-mode-coexistence.md) — `ImageGenerationMode`
- [provider-capability-table-split](../decisions/provider-capability-table-split.md) — capability 类型来源
- [llm-driver-knobs](../decisions/llm-driver-knobs.md) — LLM `extras` 字段
- [prose-persisted-with-prompt](../decisions/prose-persisted-with-prompt.md) — prose / aiFilledFields
- [claude-code-builtin-provider](../decisions/claude-code-builtin-provider.md) — `BUILTIN_CLAUDE_CODE_PROVIDER_ID`
