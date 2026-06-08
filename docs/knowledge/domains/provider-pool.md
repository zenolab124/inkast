# Provider 池 + 故障切换

OpenAI 兼容图像 provider 列表,按 priority 升序尝试,**transient 错误自动切下家**,**moderation 拒绝故意不切**(防把池子当绕审工具)。语义对齐 imagegen `scripts/generate.py`,跨平台用 SQLite 加密代替 macOS Keychain。

## 架构

```
GET providers (SQL: ORDER BY priority ASC, created_at ASC)
    │
    ▼
驱动遍历 pool
    │
    ├─ provider[0] (priority=1)
    │    ├─ ok → return ✓
    │    └─ fail → classifyError()
    │         ├─ moderation → 立即 throw ImageGenError("moderation_rejected")
    │         ├─ aborted → 立即 throw ImageGenError("aborted")
    │         └─ 其他(auth/rate/server/network/unknown) → continue
    │
    ├─ provider[1] (priority=10)
    │    └─ ...
    │
    └─ 全部失败 → throw ImageGenError("all_providers_failed")
```

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `apps/api/src/drivers/image/openai-compatible.ts` | 驱动 + pool walk + 错误分类 + mode dispatch |
| `apps/api/src/drivers/image/openai-responses.ts` | responses mode driver(raw fetch + SSE) |
| `apps/api/src/drivers/image/types.ts` | `ImageGenError` + `AttemptErrorCode` + 池语义文档头注释 |
| `apps/api/src/storage/providers.ts` | `listEnabledCapabilities(kind)` 透明解密 + ORDER BY priority |
| `apps/api/src/server/routes/providers.ts` | provider + capability CRUD + reorder + probe-models |
| `apps/web/src/features/config/ProviderConfigDialog.tsx` | 弹窗 UI(dnd-kit 拖拽 + mode toggle) |

## 错误分类与是否 fallover

| 上游状态 | classified | 是否切下家 |
| --- | --- | --- |
| `content_policy_violation` / 含 moderation/safety 关键字 | `moderation` | ❌ 故意停在这里 |
| 401 / 403 | `auth` | ✅ |
| 429 | `rate_limit` | ✅ |
| 5xx | `server` | ✅ |
| AbortError | `aborted` | ❌ 立即抛 |
| `ENOTFOUND` / `ECONNREFUSED` / `ETIMEDOUT` / `fetch failed` | `network` | ✅ |
| 其他 | `unknown` | ✅ |

## 可观测性

每次 attempt 在 stdout 打日志(`tail -f` dev 进程能看):

```
[image] attempt 1/2: duck2 (priority=1) → https://www.duckcoding.ai/v1
[image] ✓ duck2 succeeded in 38200ms
```

attempts 数组也回传到前端 `GenerateImageResponse.driver.attempts`,UI 在 flash 里显示 fallback 链。

## Quota 豁免(多渠道聚合)

**2026-06 新增**。某些 provider capability 是多个上游子渠道的聚合代理(例如同一 API key 背后路由到多个计费账号)。

### 常规行为 vs 豁免行为

| | 常规单渠道 | 多渠道聚合(`exemptAutoDisable=true`) |
|---|---|---|
| 触发条件 | `quota_exhausted` | `quota_exhausted` |
| auto-disable | 是,直到次日 06:00 北京时间 | **否**,不 auto-disable |
| fallover | 立即 break → 切下家 | **不 break**,fall through 到 backoff retry 路径 |
| 语义 | 当前 provider 今日额度耗尽 | 某一子渠道满,下次 retry 可能命中未满子渠道 |
| 失败条件 | 即时 fallover | retry 预算耗尽(`retryLimit`)才 fallover |

### 配置

在 provider capability 的 `extras` 字段设 `exemptAutoDisable: true`。通过 Web UI provider 配置弹窗的 extras JSON 编辑器写入。

### 代码位置

`apps/api/src/drivers/image/openai-compatible.ts` `quota_exhausted` 分支:

```
if (classified.code === "quota_exhausted") {
  if (!capability.extras?.exemptAutoDisable) {
    markCapabilityAutoDisabledUntilNext6am(...)
    break;   // 常规:立即 fallover
  }
  // 豁免:打日志,fall through → backoff + retry 同一 provider
}
```

### 注意

`quota_exhausted` 豁免不影响 `moderation` / `auth` / `aborted` 的硬停逻辑——那些错误永远不重试同一 provider。

## bypassModeration 开关

`generate-image` 路由接受 `bypassModeration: true`(目前前端没暴露 UI)。这个开关明确**不该轻易给用户**——防止把池子用成绕审工具。要做时需要弹个二次确认对话框。

## Schema:`providers` + `provider_capabilities` 拆表

旧模型一行 provider 只能挂一个 kind(image 或 llm)。当前模型 provider **共享凭据**,挂多个 capability 行,每个 capability 有自己的 priority / disabled / model / extras。详见 [provider-capability-table-split](../decisions/provider-capability-table-split.md)。

`extras` JSON 字段语义按 kind 分:
- `image.extras.mode`: `"images"` / `"responses"` —— driver 调度(详见 [image-mode-coexistence](../decisions/image-mode-coexistence.md))
- `llm.extras`: `{ model, effort, thinking, fallbackModel, maxTurns }` —— Claude Agent SDK 旋钮(详见 [llm-driver-knobs](../decisions/llm-driver-knobs.md))

`__builtin_claude_code__` 是保留 provider id,启动种入,代表本机 ClaudeCode driver,详见 [claude-code-builtin-provider](../decisions/claude-code-builtin-provider.md)。

## 排序 = 默认

provider 池的优先级**就是顺序** —— UI 拖动到顶 = 该 kind 的默认 provider,没有独立的"set default"按钮。`useEffectiveLlmBackend` hook 派生 effective LLM provider id(详见 [drag-to-top-default](../decisions/drag-to-top-default.md))。

## 关联条目

- [image-generation](./image-generation.md) — 生图端到端
- [openai-sdk-images](../integrations/openai-sdk-images.md) — 调用 SDK 细节
- [pool-moderation-no-fallover](../pitfalls/pool-moderation-no-fallover.md) — 故意不切的设计意图
- [add-new-provider](../workflows/add-new-provider.md) — 新增 provider 的步骤
- [openai-sdk-over-fetch](../decisions/openai-sdk-over-fetch.md) — images 端点为何用 SDK
- [responses-mode-raw-fetch-sse](../decisions/responses-mode-raw-fetch-sse.md) — responses 端点为何不用 SDK
- [provider-capability-table-split](../decisions/provider-capability-table-split.md) — schema 拆表
- [claude-code-builtin-provider](../decisions/claude-code-builtin-provider.md) — 内置 provider 行
- [drag-to-top-default](../decisions/drag-to-top-default.md) — 排序语义
- [llm-driver-knobs](../decisions/llm-driver-knobs.md) — LLM extras 字段
- [image-mode-coexistence](../decisions/image-mode-coexistence.md) — image extras.mode 字段
- [probe-models-endpoint](../decisions/probe-models-endpoint.md) — 模型探测
- [crypto-utils](../shared/crypto-utils.md) — 凭据加密细节
- [multi-channel-quota-exemption](../decisions/multi-channel-quota-exemption.md) — 豁免设计决策
- [quota-multi-channel-false-positive](../pitfalls/quota-multi-channel-false-positive.md) — 聚合代理 quota 信号的误判风险
- [per-capability-retry-budget](../decisions/per-capability-retry-budget.md) — provider retry 可在 Web UI 单独配
