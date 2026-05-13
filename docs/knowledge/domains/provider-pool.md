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
| `apps/api/src/drivers/image/openai-compatible.ts` | 驱动 + pool walk + 错误分类 |
| `apps/api/src/drivers/image/types.ts` | `ImageGenError` + `AttemptErrorCode` + 池语义文档头注释 |
| `apps/api/src/storage/providers.ts` | `listProviderKeys()` 透明解密 + ORDER BY priority |
| `apps/api/src/server/routes/providers.ts` | provider CRUD(create / list / patch / delete) |
| `apps/web/src/features/config/ProviderConfigDialog.tsx` | 弹窗 UI |

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

## bypassModeration 开关

`generate-image` 路由接受 `bypassModeration: true`(目前前端没暴露 UI)。这个开关明确**不该轻易给用户**——防止把池子用成绕审工具。要做时需要弹个二次确认对话框。

## 关联条目

- [image-generation](./image-generation.md) — 生图端到端
- [openai-sdk-images](../integrations/openai-sdk-images.md) — 调用 SDK 细节
- [pool-moderation-no-fallover](../pitfalls/pool-moderation-no-fallover.md) — 故意不切的设计意图
- [add-new-provider](../workflows/add-new-provider.md) — 新增 provider 的步骤
- [openai-sdk-over-fetch](../decisions/openai-sdk-over-fetch.md) — 为什么用 SDK 不手搓 fetch
- [crypto-utils](../shared/crypto-utils.md) — 凭据加密细节
