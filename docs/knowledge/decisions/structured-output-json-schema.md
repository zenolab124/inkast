# LLM JSON 输出:用 SDK schema 强制,不靠 prompt 约束

## 背景

prompt-engine 要 LLM 输出严格的 `{ prompt, hints }` 结构。两种实现路径:

- **A**:在 system prompt 里强调"只输出 JSON、字符串内引号要转义、不要 markdown fence",祈祷模型听话
- **B**:用 Agent SDK 的 `outputFormat: { type: "json_schema", schema }` 强制

## 测试数据(我们真的跑过)

| 方案 | 5 次连测成功率 | 平均耗时 | 单次失败原因 |
| --- | --- | --- | --- |
| A — 纯 prompt 约束 | 80%(4/5) | 13s | 模型在字符串内用了未转义双引号("图鉴"两边的引号) |
| B — SDK schema 强制 | 100%(5/5) | 27-45s | — |

`error_max_structured_output_retries` 是 SDK 内部 schema validation 失败时自动重试,`maxTurns: 5` 给足重试预算。

## 方案对比

|  | A: prompt 约束 | B: SDK schema |
| --- | --- | --- |
| 实现成本 | 改 system prompt 一行 | options 多一个字段 |
| 稳定性 | 80-90% | ~100% |
| 延迟 | 13s 一次成功 | 27-45s 一次成功(多轮校验) |
| 调试 | 失败时 raw 输出可看 | 失败时只有 `error_max_*` 状态码 |
| 维护 | 模型升级后行为可能变 | SDK 跟模型同步 |

## 最终选择

**B**:Phase 1 优先稳定性。`packages/shared/src/api.ts` 的 schema 只锁顶层 `{ prompt: object, hints: array }`,**内部 `prompt` 用 `additionalProperties: true` 故意开放**——imagegen 方法论允许 LLM 自创字段。

## 副作用

延迟翻倍。后续 Phase 1.5 重对话化时,会重新评估:
- 用流式 + early return 边渲染边校验,体感延迟 < 5s
- 或者切回 A 加自动重试,做 hybrid 方案

## 当前 driver 容错

driver 仍保留 `parseTolerantJson()` 兜底:

```ts
const structured = result.structured_output;
const data = structured !== undefined
  ? (structured as T)
  : parseTolerantJson<T>(result.result);  // fallback for proxies不支持 schema
```

万一某天 SDK / 后端 routing 不返 `structured_output`,自动降级到文本解析(剥 markdown fence + 找 outer braces)。

## 关联条目

- [prompt-engine](../domains/prompt-engine.md) — 消费方
- [claude-agent-sdk](../integrations/claude-agent-sdk.md) — SDK 细节
- [llm-json-quote-escaping](../pitfalls/llm-json-quote-escaping.md) — 失败案例
