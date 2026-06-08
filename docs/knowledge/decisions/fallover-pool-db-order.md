# LLM fallover 池序以 DB priority 为准,env 不再重排

v2.37(commit 1661f49)起,`INKAST_DEFAULT_LLM_PROVIDER_ID` env 不再影响 `with-fallover.ts` 的 candidate 顺序;LLM fallover 池完全以 `listEnabledCapabilities("llm")` 的 DB priority 升序为准,即 Web UI 拖拽的所见即所得。

## 背景

之前 `resolveCandidates()` 的逻辑:读取 env `INKAST_DEFAULT_LLM_PROVIDER_ID`,若存在则把该 provider 置入 candidates 数组的位置 0。这意味着即使操作员在 Web UI 把其他 provider 拖到更高优先级,env 里的 provider 仍然最先被尝试,造成:

1. **拖拽 ≠ 实际顺序**:jdc 操作员在 Web UI 调整顺序后看不到预期效果,需要同时修改 env 才能让 fallover 顺序生效。
2. **静默覆盖**:没有任何日志或提示说"env override 了你的拖拽",排查时很难发现。

这个 env 的本意只是"当没有 plugin overlay 显式指定 llmBackend 时给 plugin 用哪个 LLM 后端"——功能定位是 plugin overlay 回落,而非 Web UI 拖拽的对立面。

## 方案对比

| 方案 | 描述 | 否决原因 |
|---|---|---|
| A(最终选择)| 完全按 DB priority;env 只保留在 `resolveLlmBackend()` 作 plugin overlay 回落 | — |
| B | env 保留 fallover 影响,但加日志警告说明 | 治标不治本;拖拽 ≠ 实际顺序仍存在 |
| C | env 废弃,靠 plugin overlay `llmBackend` 代替 | 大改 overlay schema;现有部署需迁移 |

## 最终选择

**A**:`resolveCandidates()` 删除 env 前序逻辑,只遍历 `listEnabledCapabilities("llm")` 按 DB priority 升序,跳过内置 claude-code id 后追加到列表末尾(受 DB disabled 控制,见 [claude-code-tail-bypassed-disabled](../pitfalls/claude-code-tail-bypassed-disabled.md))。

env `INKAST_DEFAULT_LLM_PROVIDER_ID` 现在只在 `apps/api/src/plugins/registry.ts` 的 `resolveLlmBackend()` 里生效:当 plugin overlay JSON 没有写 `llmBackend` 字段时,用 env 指定的 provider 作回落。这个用途保持不变。

修复了一个隐性 bug:**操作员拖拽顺序之前被 env 静默覆盖**,以前没有文档说明这一点。

## 关联条目

- [shared/llm-fallover](../shared/llm-fallover.md) — fallover helper 完整文档(已补充 v2.37 历史变更)
- [drag-to-top-default](drag-to-top-default.md) — "拖到顶 = 默认"的设计;v2.37 前 LLM 侧并未真正贯彻这个原则
- [pitfalls/claude-code-tail-bypassed-disabled](../pitfalls/claude-code-tail-bypassed-disabled.md) — tail 受 DB disabled 控制(v2.32 修)
