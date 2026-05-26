# claude-code SDK 无 OAuth 时返 "Not logged in" 作 result 字符串,被当 invalid_json,error_msg 误导

**What**: 排查某 task,看 `error_msg` 是 `invalid_json: unexpected character 'N'`,以为是 LLM 输出格式 bug。深挖发现该 task 走到 claude-code SDK 兜底,**SDK 没抛 error 反而返回了 "Not logged in · Please run /login" 这段提示文本作为 `result.result`**,下游 `parseTolerantJson` 当 raw JSON 处理首字符 'N' 不是 `{`/`[` → 抛 invalid_json。

**Why**: `@anthropic-ai/claude-agent-sdk` 在本机 OAuth 凭据不可用时,**不抛 SDK error**——它把 Agent 系统消息("Not logged in"、"Please run /login"、"session expired" 等)当作 model 的常规 result 文本回吐。`completeJson` 拿到这段字符串当 JSON 解析,错误码 `invalid_json` 跟"LLM 输出非 JSON"难以区分。

部署到 jdc 时该问题尤其突出:本机有 OAuth → 测试通过 → 部署到 jdc 时本机 OAuth 不可用 → 每次 task 兜底到 claude-code 都把 SDK 提示当 LLM 输出处理。

**Action**:
- v2.32 已修:`claude-code.ts` 的 `completeJson` 在 `parseTolerantJson` 之前先用 `SDK_SYSTEM_MESSAGE_PATTERN` regex(`not logged in / please run login / session expired / authentication failed / invalid api key / unauthorized`)sniff `result.result`——命中就转抛 `classifySdkError(result.result)`,走标准 `not_authenticated` 路径,fallover wrapper 清晰跳过 claude-code,error_msg 反映真实根因。
- 配套修复:[claude-code-tail-bypassed-disabled](claude-code-tail-bypassed-disabled.md) 让 with-fallover 根本不再无条件追加 claude-code tail,从源头降低这条路径被触发的概率。
- 排查后续 invalid_json 报错时:**先 grep journal `[llm]` 行看是不是走到 claude-code SDK**;是的话再看 `error_msg` 是否含 "Not logged in" 字眼——v2.32 后这种 case 应该直接归到 `not_authenticated`,如果仍看到 invalid_json 就是 sniff regex 没覆盖新的 SDK 消息变体。

## 关联条目

- [claude-code-tail-bypassed-disabled](claude-code-tail-bypassed-disabled.md) — 配套修复:从源头不再无条件追加 claude-code
- [claude-code-sdk-over-cli](../decisions/claude-code-sdk-over-cli.md) — 用 SDK 而非 CLI 的决策(SDK 行为差异是本 pitfall 的根因)
- [llm-fallover](../shared/llm-fallover.md) — fallover wrapper 在错误分类后跳过 claude-code 的链路
