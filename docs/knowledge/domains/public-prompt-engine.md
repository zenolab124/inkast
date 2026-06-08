# 公开版散文→JSON Prompt 引擎

公开版将 imagegen 方法论蒸馏为约 120 行 system prompt，通过透明代理（用户自带 LLM key）或 builtin 通道（平台扣余额）将散文转成结构化 JSON prompt，并主动产出 2-3 个模糊点 hints。

## 架构

```
前端 draftPrompt()
    │ 从 IDB 读 enabled LLM provider
    │
    ├── 有 LLM provider → 透明代理路径（不需登录，不扣余额）
    │     body.llmProvider = { baseUrl, apiKey, model, useCodexHeader }
    └── 无 LLM provider → builtin 路径（需登录 + 余额）
    │
    ▼
POST /api/prompt/draft  { input, lang?, llmProvider? }
    │
server/routes/prompt.ts
    │
    ├─[有 llmProvider]─────────────────────────────────────────
    │   getPromptEngineSystemPrompt(lang)
    │   passthroughLlmJson({ systemPrompt, userPrompt, ... })
    │   shapeDraftResponse → { prompt, hints, _meta.backend='passthrough' }
    │
    └─[无 llmProvider]─────────────────────────────────────────
        loadBuiltinLlmConfig() → enabled? 否→503
        自解 cookie → findValidSession → findUserById → 无→401
        快速余额检查(getBalance < cost) → 不足→402
        debit(consume:llm)
        passthroughLlmJson(builtin 凭据)
          成功 → shapeDraftResponse + balance_after
          失败 → credit(refund:llm) + shapePassthroughError + balance_after

passthroughLlmJson (drivers/passthrough-llm.ts)
    │ new OpenAI client（每次请求，ad-hoc，零持久化）
    │ chat.completions.create({ response_format: { type:'json_object' } })
    │ extractJson(raw)
    │   · strip ``` fence
    │   · 裁首个 { … } 块
    │   · JSON.parse
    └─ 返 { json, raw, durationMs }
```

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `apps/api-public/src/domain/prompt-engine.ts` | system prompt 全文，`getPromptEngineSystemPrompt(lang)` |
| `apps/api-public/src/server/routes/prompt.ts` | POST /api/prompt/draft，两路径逻辑，失败 saga |
| `apps/api-public/src/drivers/passthrough-llm.ts` | ad-hoc LLM client，`extractJson` 容错，`PassthroughLlmError` |
| `apps/api-public/src/domain/llm/builtin-config.ts` | 读 `PUBLIC_BUILTIN_LLM_*` env，默认模型 `gpt-4o-mini` |

## System Prompt 设计

`domain/prompt-engine.ts` 约 120 行（原始 imagegen reference 文档约 700 行），精简只留：

- **字段词典**（type/style/subject/background/lighting/mood/camera/color_palette/count/text_elements/layout，标注必填场景）
- **8 条散文拆解套路**（形容词→style，主体→subject，光照→lighting…）
- **模糊点反馈（关键！）**：2-3 个 hint，格式 `{ "field": "...", "suggestion": "..." }`，主动补足用户没说清楚的地方，这一步禁止省略
- **安全/IP 通用化**：涉及亲密/cosplay/已注册商标时重构为类型化描述，不做事后自我审查
- **严格输出格式**：仅输出 JSON 对象，禁止 markdown fence 和解释性文字
- **输出语言注入**：`LANG_INSTRUCTION[lang]` 追加到末尾，zh/en 分别给出示例，作为最高优先级约束

## 两路径对比

| 维度 | 透明代理 | builtin |
| --- | --- | --- |
| 是否需要登录 | 否 | 是 |
| 凭据来源 | 请求体 `llmProvider`，零持久化 | `PUBLIC_BUILTIN_LLM_*` env |
| 余额消耗 | 不扣 | 扣 `costPerCall`（默认 1） |
| 失败退款 | 无（本来就没扣） | `credit(refund:llm)` 退款 |
| 默认模型 | 由用户填写 | `gpt-4o-mini` |

## extractJson 容错逻辑

模型有时包 ` ```json ` fence 或在 JSON 前后插散文。`passthrough-llm.ts` 中：

1. `trim()` 去空白
2. 如果以 ` ``` ` 开头，剥去 ` ```json\n` 和尾部 ` ``` `
3. 找首个 `{` 到最后一个 `}` 裁出子串
4. `JSON.parse()`

失败时抛 `PassthroughLlmError(null, 'invalid_json', ...)`，路由层返 502。

## 与主线 prompt-engine 的关系

主线（`apps/api/src/domain/prompt-engine/`）走 ClaudeCode SDK，使用 `outputFormat: json_schema` 强制 schema，支持多 driver 抽象。公开版极简：单文件、单函数、强依赖 `response_format: json_object` + 容错解析，不做 driver 抽象，passthrough/builtin 都走同一 `passthroughLlmJson` 函数，区别只在凭据来源。

## 关联条目

- [public-image-gen](./public-image-gen.md) — 公开版生图通道（本条只管 LLM）
- [domains/prompt-engine](./prompt-engine.md) — 主线 prompt 引擎（ClaudeCode SDK 路径）
- [decisions/passthrough-vs-builtin-gen](../decisions/passthrough-vs-builtin-gen.md) — 透明代理 vs 兜底通道决策（同样适用 LLM）
- [public-balance](./public-balance.md) — builtin 路径余额消耗细节
- [public-rate-limit](./public-rate-limit.md) — /prompt/draft 的限流配置
