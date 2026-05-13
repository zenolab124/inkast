# LLM 通道:Agent SDK 而非 spawn `claude` CLI

## 背景

inkast 默认 LLM 走"本机已登录的 ClaudeCode"。技术上有两条接入路径:

- **A**:在后端 spawn `claude` CLI 子进程,通过 stdin/stdout 通信
- **B**:用 `@anthropic-ai/claude-agent-sdk` 这个 npm 库 embed

## 方案对比

|  | A: spawn CLI | B: Agent SDK |
| --- | --- | --- |
| 依赖 | 用户 PATH 上的 `claude` 二进制 | npm 包 |
| 输入输出 | 文本流,需自己解析 | 结构化 message stream |
| 流式 | 自己实现 | SDK 自带 |
| 错误分类 | 解析 stderr | `APIError` / `AbortError` 等具名类型 |
| 结构化输出 | 靠 prompt 约束 | `outputFormat: json_schema` 强制 |
| 凭据 | 复用 CLI 的 Keychain OAuth | 同样自动用 Keychain OAuth |
| 跨平台 | 三平台都行,但要装 CLI | 三平台都行 |

## 最终选择

**B (Agent SDK)**,在 CLAUDE.md 明文锁定"不要 spawn `claude` CLI"。理由:

1. **结构化输出能力**:SDK 支持 `outputFormat: { type: "json_schema", schema }`,模型按 schema 强制输出。CLI 没这个能力,只能靠 prompt 约束 → 测试 5/20 失败率(字符串内引号未转义)。
2. **更稳定的错误处理**:`APIError` 自带 status/code/type 字段,errorMessage 是 string;CLI 要解析 stderr 文本,脆。
3. **维护更新跟得上**:SDK 本身就是 Claude Code 的"内核暴露",和 CLI 一脉相承——只是入口不同。

## 副作用

SDK 内部实际是 spawn `cli.js` 子进程(SDK 自带的迷你 Claude Code)——见 [claude-agent-sdk](../integrations/claude-agent-sdk.md) "实际工作机制"。所以"避免 spawn"严格说不是"avoid subprocess",而是"avoid PATH 依赖 + 自己写 JSON-RPC"。

调用产生的 session 会落到 `~/.claude/projects/<sanitized-cwd>/<sessionId>.jsonl`,和用户在终端跑 `claude` 完全同一份格式。

## 关联条目

- [claude-agent-sdk](../integrations/claude-agent-sdk.md) — SDK 集成实操
- [structured-output-json-schema](./structured-output-json-schema.md) — 选项 B 才能用 schema 强制
- [prompt-engine](../domains/prompt-engine.md) — 这条路径的服务层
