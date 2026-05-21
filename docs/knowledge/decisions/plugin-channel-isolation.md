# Plugin 通道与 Web UI 通道完全分离

inkast plugin 通道的代码路径(`plugin-async`)与 Web UI 通道(`domain/generate`)完全隔离 —— 仅共享 LLM driver + image provider 池入口。

## 背景

实现 plugin 通道时存在两条思路:
- A. **复用 Web UI 的 `generate()`**——添加 plugin 模式分支,所有路径走同一套代码
- B. **写独立 `plugin-async`**——plugin 通道自己一套 worker / 表 / 流程

## 方案对比

| | A: 复用 generate() | B: 独立 plugin-async |
|---|---|---|
| 代码复用 | 多 | 少(LLM + image driver 入口共享) |
| 改动 generate() 风险 | 高(Web UI 跟着受影响) | 0(Web UI 不动) |
| plugin 独有逻辑(callback / 24h GC / per-plugin enforce 字段)在 generate() 里 | 大量 if-else | 干净在 plugin-async 内 |
| 字段集差异(plugin 不落盘 b64 vs Web UI 落盘文件) | jobs 表加更多字段或者 plugin 字段共表 | 独立 `plugin_tasks` 表,字段集贴需求 |
| 调试时 trace 一条 plugin 任务 | 要在共用代码里区分模式 | 看 `[plugin-async]` 前缀 log 就够 |

## 最终选择

**B: 独立 plugin-async**。理由:

1. **不污染 Web UI 通道**——任何 plugin 改动 0 风险影响 Web UI
2. **字段集和生命周期不同**——Web UI 任务持久落盘 / 不限时;plugin 任务 24h GC / 不落盘 b64。共表反而要 nullable 一堆字段 + 行为分支
3. **可观测性更好**——log 前缀 `[plugin-async]` 一眼分清通道
4. **未来插件机制扩展**——比如加新 plugin hook,只动 plugin-async,不动 Web UI

## 实现要点(共享 vs 独立的边界)

**共享**(都走的入口):
- `domain/prompt-engine/draftPrompt()` —— 散文 → JSON
- `drivers/image/openai-compatible.generateImage()` —— image driver 池
- `drivers/llm/getLlmDriver()` —— LLM driver 工厂
- `sharp` transcode 工具

**独立**(plugin 专属):
- `domain/plugin-async/index.ts` —— worker + queue + callback + transcode 流程
- `storage/plugin-tasks.ts` —— `plugin_tasks` 表 CRUD
- `storage/plugin-stats.ts` —— admin dashboard aggregate
- `server/routes/plugins.ts` —— submit + status routes
- `server/middleware/plugin-auth.ts` —— Bearer Token 中间件
- `plugins/{types,registry,loader,errors}.ts` —— plugin overlay 加载 + 错误 mapper

## 副作用

- **代码量增加**——plugin 通道 ~1500+ 行新代码,跟 generate() 有少量重复(JSON.stringify + provider 池调用模式)
- 主流程 trade off 是值得的——可读性 / 可维护性 / 隔离性 > 代码行数

## 关联条目

- [plugin-channel](../domains/plugin-channel.md) — 实现位置
- [v2-async-callback-protocol](v2-async-callback-protocol.md) — 协议层决策
