# `@anthropic-ai/claude-agent-sdk`

Anthropic 官方 TS SDK,把 Claude Code 内核暴露为 npm 包。inkast 用它实现 LLM 默认通道(本机 OAuth + 结构化输出)。

## 选型原因

见 [claude-code-sdk-over-cli](../decisions/claude-code-sdk-over-cli.md)。一句话:SDK 提供 `outputFormat: json_schema` 强制 JSON,CLI 没这个能力。

## 使用方式

`apps/api/src/drivers/llm/claude-code.ts`:

```ts
import { query, AbortError } from "@anthropic-ai/claude-agent-sdk";

const q = query({
  prompt: opts.userPrompt,
  options: {
    systemPrompt: opts.systemPrompt,
    tools: [],                          // 禁用所有内置工具
    maxTurns: 5,                        // 给 schema 校验留重试预算
    outputFormat: { type: "json_schema", schema: PROMPT_DRAFT_SCHEMA },
    abortController,
    env: { ...process.env, ANTHROPIC_API_KEY: "" },  // 强制走 OAuth
  },
});

for await (const msg of q) {
  if (msg.type === "result" && msg.subtype === "success") {
    return msg.structured_output;  // 已经是解析好的对象
  }
}
```

## 实际工作机制(SDK 内部)

SDK 不是 in-process 调 API,**是 spawn 一个 cli.js 子进程**(SDK 自带的迷你 Claude Code),通过 JSON-RPC 通信。

- 凭据来源:同本机 `claude` CLI(macOS Keychain `"Claude Code-credentials"`)
- 计费/限速:算到同一个 Pro/Max 订阅
- 落痕位置:`~/.claude/projects/<sanitized-cwd>/<sessionId>.jsonl`(同 `claude` CLI 格式)
- 用户在终端跑 `claude /resume` 能续聊这些 session

## 关键配置

| Option | 我们的值 | 备注 |
| --- | --- | --- |
| `systemPrompt` | imagegen 方法论精华(~120 行) | 完全覆盖,不走 claude_code preset |
| `tools` | `[]` | 禁用 Bash/Read/Edit/WebFetch 等所有内置工具,纯文本 |
| `maxTurns` | `5` | 给 SDK 的结构化输出重试留预算 |
| `outputFormat` | `{ type: "json_schema", schema }` | 强制 JSON 输出 |
| `env.ANTHROPIC_API_KEY` | `""` | 显式清掉,确保走 OAuth 不走 API key |
| `abortController` | 自己创建 | 集成 timeout + 调用方 signal |

## 错误处理

```ts
catch (err) {
  if (err instanceof AbortError) { ... }
  // 通过 message 关键字 classify:authentication/oauth → not_authenticated
  //                              rate/quota/billing → rate_limited
  //                              其他 → backend_unavailable
}
```

Result 消息也可能是失败子类型:`error_during_execution` / `error_max_turns` / `error_max_budget_usd` / `error_max_structured_output_retries`。

## 合规边界

- ✅ 用户本机跑 inkast 调自己 OAuth — 合规(类比 Aider/Cline/Continue.dev)
- 🔴 公网部署用部署者 OAuth 共享 — **绝对违规**
- 🟡 公网用户在站点 OAuth 登录绑自己订阅 — 需联系 Anthropic 确认

详见 CLAUDE.md 没单独写,但 `decisions/claude-code-sdk-over-cli` 提到。

## 已知版本

`^0.2.140`(2026-05 时的最新)。**peer dep 警告**:SDK 要 `zod@^4.0.0`,我们装 `zod@^3.25.0` 满足 `openai` 包要求 — warn 但不影响运行。

## 冷启动 + driver knobs

每次 `query()` SDK 会 spawn 一个 worker child process,首次约 7s。inkast 用 API 启动后 7s 跑一次 warmup 请求避开首次卡顿,详见 [llm-sdk-cold-start](../pitfalls/llm-sdk-cold-start.md)。

5 个调用旋钮通过 `provider_capabilities.extras` 暴露给用户:`model / effort / thinking / fallbackModel / maxTurns`。默认值改为 `sonnet + medium + thinking:disabled`,对散文→JSON 任务质量足够、速度快得多。详见 [llm-driver-knobs](../decisions/llm-driver-knobs.md)。

## 关联条目

- [claude-code-sdk-over-cli](../decisions/claude-code-sdk-over-cli.md)
- [structured-output-json-schema](../decisions/structured-output-json-schema.md)
- [prompt-engine](../domains/prompt-engine.md)
- [claude-code-builtin-provider](../decisions/claude-code-builtin-provider.md) — 注册为内置 provider 行
- [llm-driver-knobs](../decisions/llm-driver-knobs.md) — 5 个调用旋钮
- [llm-sdk-cold-start](../pitfalls/llm-sdk-cold-start.md) — 冷启动 + warmup
- [llm-as-accelerator-not-requirement](../decisions/llm-as-accelerator-not-requirement.md)
