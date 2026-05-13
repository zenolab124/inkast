# 散文 → JSON Prompt 引擎

把用户的散文/想法,通过 ClaudeCode 转成 GPT Image 2 风格的结构化 JSON prompt,并主动指出 2-3 个"模糊点"建议让用户补充。这是 inkast 的核心差异化能力。

## 架构

```
用户散文
    │ POST /api/draft-prompt { input }
    ▼
server/routes/prompt.ts
    │ readJson + 空字符串校验
    ▼
domain/prompt-engine/index.ts  · draftPrompt()
    │ 选 driver(默认 claude-code)
    ▼
drivers/llm/claude-code.ts
    │ query({ systemPrompt: PROMPT_ENGINE_SYSTEM_PROMPT,
    │         outputFormat: { type: 'json_schema', schema: PROMPT_DRAFT_SCHEMA },
    │         tools: [], maxTurns: 5 })
    │ ← 等待 SDKResultSuccess.structured_output
    ▼
{ prompt: ImagePrompt, hints: AmbiguityHint[] }
    │ 校验 type/style/subject 必填,hints 默认为 []
    ▼
HTTP 200 { ...draft, _meta: { backend, durationMs } }
```

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `apps/api/src/server/routes/prompt.ts` | POST /api/draft-prompt 路由,错误码映射 |
| `apps/api/src/domain/prompt-engine/index.ts` | 服务层 + 必填字段校验 |
| `apps/api/src/domain/prompt-engine/system-prompt.ts` | 注入 LLM 的方法论(精简自 imagegen SKILL) |
| `apps/api/src/drivers/llm/claude-code.ts` | SDK 调用 + JSON schema 强制 + 错误分类 |
| `apps/api/src/drivers/llm/types.ts` | `LlmDriver` 接口 + `LlmDriverError` |
| `packages/shared/src/prompt.ts` | `ImagePrompt` / `AmbiguityHint` / `PromptDraft` 契约 |

## System Prompt 的设计

`system-prompt.ts` 注入的是 **imagegen 方法论的精华版**(~120 行),不是把 imagegen 的 700 行 reference 全塞进去。包含:

- **6 大核心字段速查**(type / style / subject / background / layout / text_elements + 按需扩展 lighting/mood/camera/color_palette/count)
- **8 条散文拆解套路**(形容词→style,主体→subject,光照→lighting...)
- **模糊点反馈机制**(2-3 条 hint,格式严格 `{field, suggestion}`)
- **安全/IP 红线**(人物+亲密/已注册商标用通用化重构)
- **严格输出格式**(只输出 JSON 对象,不要 markdown fence,不要解释)

## 输出 schema

```js
{
  type: "object",
  required: ["prompt", "hints"],
  properties: {
    prompt: { type: "object", additionalProperties: true },  // 开放结构
    hints: {
      type: "array",
      items: { required: ["field", "suggestion"], ... }
    }
  }
}
```

`prompt` 故意开放——imagegen 方法论允许 LLM 自创字段(如 `subject_details` 数组、`card_structure` 子结构)。

## 延迟权衡

启用 `outputFormat: json_schema` 后,稳定性从 80% → 100%,但延迟翻倍(13s → 27-45s)——SDK 走多轮 schema validation 循环。Phase 1 选稳定性,延迟优化留给 Phase 1.5(流式 + early return)。

## 关联条目

- [prompt-composer-loop](./prompt-composer-loop.md) — 前端如何驱动这个引擎
- [structured-output-json-schema](../decisions/structured-output-json-schema.md) — schema 强制 vs prompt 约束的取舍
- [prompt-as-json-not-prose](../decisions/prompt-as-json-not-prose.md) — 为什么把 JSON 喂给生图模型
- [claude-agent-sdk](../integrations/claude-agent-sdk.md) — SDK 集成细节
- [llm-json-quote-escaping](../pitfalls/llm-json-quote-escaping.md) — 没有 schema 时模型 JSON 字符串引号未转义
