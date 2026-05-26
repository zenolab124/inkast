# Plugin error_code 是转译层,跟 inkast 内部 ImageGenError.code 不一一对应

## What

Plugin 通道的 `plugin_tasks.error_code` 字段(也是 callback body 里的 `error_code`)是经 `plugins/errors.ts` 转译过的"对外协议码",**跟 inkast 内部抛的 `ImageGenError.code` 不一致**。

排查 task 失败时**容易看错码瞎猜方向**:看到 `image_provider_unavailable` 会以为"是 image pool 问题",其实可能是 r1 LLM 失败被映射过来的;看到 `image_provider_rate_limited` 不一定是 rate_limit,可能是 round 0 attempts 里"含"rate_limit 错码就触发了。

## Why

[plugins/errors.ts](../../../apps/api/src/plugins/errors.ts) 把 inkast 内部错误映射到 OpenAI 风格的协议码:

| inkast 内部 ImageGenError.code | plugin error_code |
|---|---|
| `no_providers` | `image_provider_unavailable` |
| `all_providers_failed` | `image_provider_unavailable` 或 `image_provider_rate_limited`(看 attempts) |
| `all_providers_failed_after_rewrite` | `internal_error` |
| 其它 | `internal_error` |

而 `error_msg` 字段(v2.24 起)含真实失败原因 + 上一轮失败,**信息密度比 error_code 高**。

## Action

排查 fail 时**信 `error_msg` 多过 `error_code`**:

```
error_code = image_provider_unavailable
error_msg  = rewrite r1 LLM failed: HTTP 502 (no body) — and earlier rounds also failed (last: exhausted all 5 providers)
```

→ 真实根因是 **r1 LLM 上游 502**,不是"6 个 image provider 都不行"。

完整决策树见 [debugging-playbook](../../debugging-playbook.md#q1-error_code-是什么)。

**v2.24 之前**:catch 块用 `lastErr?.message` 覆盖 r1 真实失败原因,error_msg 看起来是 "exhausted all N providers" 完全掩盖 r1 LLM 错。已在 [with-rewrite.ts:159](../../../apps/api/src/domain/generate/with-rewrite.ts#L159) 修——现在 catch 拼真实失败 + 之前轮次失败。

## 另一个易踩点:`classifyError` 两路径同步

`apps/api/src/drivers/image/openai-compatible.ts` 的 `classifyError` 函数有**两条分支**:
- APIError 分支(images mode 走 SDK,SDK 抛 APIError 被分类)
- plain Error 分支(responses mode 走 raw fetch,catch 到 plain Error 重新分类)

**新增错误码识别(quota / blocked / guardrails / not_logged_in 等)必须两处都加**,否则 responses mode 路径漏判 → 错码归 `unknown` → 触发错误的 fallover 策略。

具体踩坑:v2.32 修 [quota-chinese-proxy-regex](quota-chinese-proxy-regex.md) 时一开始只加了 APIError 分支,plain Error 分支仍归 `auth`。

## 关联

- [llm-half-refusal-empty-rewritten](llm-half-refusal-empty-rewritten.md) — 一种典型的"error_code 误导"场景
- [quota-chinese-proxy-regex](quota-chinese-proxy-regex.md) — 同源 pitfall:两路径同步
- [rewrite-chain](../domains/rewrite-chain.md) — 错误流经路径
- [plugin-channel](../domains/plugin-channel.md) — error_code 写入 plugin_tasks 的位置
