# `with-fallover.ts resolveCandidates` 无条件追加 claude-code tail,绕过 DB capability disabled

**What**: 操作员在 DB 把 `__builtin_claude_code__` 的 LLM capability 显式标 `disabled=1`(意图:不用本机 claude-code 了,所有 LLM 调用走远程 provider),但实际 task 仍然偶发性走到 claude-code SDK——浪费一次 attempt + 触发 [claude-code-not-logged-in-as-result](claude-code-not-logged-in-as-result.md)。

**Why**: `apps/api/src/drivers/llm/with-fallover.ts:50` 的 `resolveCandidates()` 早期实现是"本地兜底永远在",**无条件**把 `BUILTIN_CLAUDE_CODE_ID` 作为 tail 拼到候选列表末尾,**没读 DB capability 的 disabled 状态**。设计本意:即使所有远程 provider 都挂,本机仍能兜底——但部署在 jdc 时本地 OAuth 不可用,这条 tail 反而成了噪音。

**Action**:
- v2.32 已修:`resolveCandidates()` 改成只在 `listEnabledCapabilities("llm")` **包含** `BUILTIN_CLAUDE_CODE_ID` 时才追加 claude-code tail——jdc 操作员显式 disable 它后,所有远程 LLM 都挂时直接干净 fail,`error_msg` 反映真实根因(全部远程 LLM 都 timed out / quota'd),而不是被 "Not logged in" 污染。
- 配套见 [claude-code-not-logged-in-as-result](claude-code-not-logged-in-as-result.md):即使 tail 仍然被触发(本机部署 + claude-code 实际未登录),`completeJson` 也会 sniff 系统消息走 `not_authenticated`。
- 自检:操作员在 web UI 把 claude-code 标 disabled 后,grep journal `[llm]` 行确认 fallover 列表里没有 `claude-code`——有的话说明此修复 regression 了。

## 关联条目

- [claude-code-not-logged-in-as-result](claude-code-not-logged-in-as-result.md) — 配套 pitfall:tail 即使被触发也要 sniff 系统消息
- [llm-fallover](../shared/llm-fallover.md) — `with-fallover.ts` 所在域
- [claude-code-builtin-provider](../decisions/claude-code-builtin-provider.md) — 本机 claude-code 作为 builtin provider 的决策
- [provider-capability-table-split](../decisions/provider-capability-table-split.md) — `provider_capabilities` 表 disabled 列的载体
