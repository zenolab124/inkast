# LLM Multi-Backend Fallover Helper

`completeJsonWithFallover<T>()` 是所有"业务层 LLM 调用"的统一入口,替代了之前每个 callsite 各自 `getLlmDriver().completeJson()` 的单 backend 写法。

**为什么**:实测发现单 backend LLM 调用会在上游瞬时 502 / rate_limit / safety refusal 时**让整个 plugin task 失败**——LLM 通道没有 pool walker,跟 image driver 不对称。

## 核心契约

```ts
completeJsonWithFallover<T>(
  opts: CompleteJsonOptions,
  contextLabel = "llm",
  postValidate?: (data: T) => string | null,
): Promise<CompleteJsonResult<T>>
```

## Candidate 顺序(每次调用都重算)

1. 所有 enabled LLM-kind capability 按 **DB priority 升序**(= Web UI 拖拽顺序,所见即所得),去重内置 claude-code id
2. **`"claude-code"` tail(v2.32 起受 DB disabled 控制)**——只在 `listEnabledCapabilities("llm")` 包含 `BUILTIN_CLAUDE_CODE_ID` 时才追加;jdc 操作员显式 disable 后,所有远程 LLM 都挂时直接干净 fail,见 [claude-code-tail-bypassed-disabled](../pitfalls/claude-code-tail-bypassed-disabled.md)。

> **历史变更(v2.37)**:之前 `INKAST_DEFAULT_LLM_PROVIDER_ID` env 会把 primary 顶到位置 1,造成 Web 拖拽顺序 ≠ 实际 fallover 顺序。从 v2.37 起这层覆盖被砍掉,env 只剩 [`resolveLlmBackend()`](../../../apps/api/src/plugins/registry.ts) 那个用途(plugin overlay 没写 `llmBackend` 时的回落),不再影响 fallover 池序。

## 失败分类与跳转策略

每个 candidate 内部:

| LlmDriverError.code | 行为 |
|---|---|
| `aborted` | **立刻 throw**,不切(caller / 上游 abort) |
| `invalid_json` | 同 backend retry-once(stochastic refusal),仍失败 → 跳下个 |
| `backend_unavailable` / `timeout` / `rate_limited` / `not_authenticated` / `unknown` | 立刻跳下个 candidate |

## `postValidate` Hook(v2.25 引入)

**针对"语义半残"——LLM 返回合法 JSON 但业务必填字段空**(典型 case:`{analysis:{...完整...}, rewritten:""}`)。helper 在 driver 成功返回后调用 postValidate,返回非 null 错误字符串则**构造 invalid_json error**走标准重试流程。

rewrite-prompt callsite 示例:
```ts
await completeJsonWithFallover(opts, `rewrite r${round}`,
  data => data.rewritten?.trim() ? null : "empty 'rewritten' field"
);
```

post-review-edit **不需要** postValidate(`looks_like_target: bool` + `edit_instructions: string` 都是直接 schema 校验即可;edit_instructions 为空字符串本身就是 LLM 表态"不需要 edit"的合法状态)。

## 关键文件

| 文件 | 职责 |
|---|---|
| `apps/api/src/drivers/llm/with-fallover.ts` | helper 实现 + resolveCandidates |
| `apps/api/src/drivers/llm/index.ts` | getLlmDriver 单 backend 入口(底层) |
| `apps/api/src/drivers/llm/types.ts` | LlmDriverErrorCode 枚举 |

## 日志格式

```
[llm] <context> openai-compatible:<8 字符 id>… failed (<code>: <msg slice 160>) — falling over to next backend (N left)
[llm] <context> <backend> invalid_json on attempt 1 — retrying same backend once
[llm] <context> <backend> failed (...) — no more backends    ← N=0 时
```

journal 里 grep `[llm]` 就能看 fallover 路径。

## 使用方

- `apps/api/src/domain/rewrite-prompt/index.ts` — r1/r2/r3 全用
- `apps/api/src/domain/post-review-edit/index.ts` — review LLM 调用

## 关联条目

- [llm-driver-knobs](../decisions/llm-driver-knobs.md) — 单 backend 时的 timeout/warmup 配置
- [rewrite-chain](../domains/rewrite-chain.md) — 主要使用方
- [post-review-edit](../domains/post-review-edit.md) — 另一使用方
- [llm-half-refusal-empty-rewritten](../pitfalls/llm-half-refusal-empty-rewritten.md) — postValidate 修的是这个
- [claude-code-tail-bypassed-disabled](../pitfalls/claude-code-tail-bypassed-disabled.md) — v2.32 修:tail 受 DB disabled 控制
- [claude-code-not-logged-in-as-result](../pitfalls/claude-code-not-logged-in-as-result.md) — claude-code SDK 没登录时把提示当 result 返回
- [fallover-pool-db-order](../decisions/fallover-pool-db-order.md) — v2.37:env 不再重排 fallover 池序,完全以 DB priority 为准
