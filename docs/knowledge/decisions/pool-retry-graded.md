# Pool walker 分级 retry 策略(PROVIDER_RETRY_LIMIT × 2 + 5s backoff)

一句话:在 provider pool 外层失败转移之上,每个 provider 内部按错误类型分级 retry——transient 自动 retry × 2,deterministic 立即放弃。

## 背景

`image_generation` 渠道(anyrouter)有明显的**瞬时抖动**特征:同一请求同一时刻,有时接通成功,有时被代理 RST。retry 几秒后大概率落到不同的代理节点 / 不同的上游队列槽,能拿到完全不同的结果。

但**不是所有错误都该 retry**——moderation 拒绝是确定性的,retry 浪费时间且可能违反"防止把池子当绕审工具"的设计。

## 方案对比

| 方案 | 描述 | 评价 |
| --- | --- | --- |
| **A. 完全不 retry,直接 fallover** | 单 provider 失败 → 立即下一个 | 抗瞬时抖动差,首发失败率高 |
| B. 全部错误一律 retry × N | 简单 | moderation 也 retry = 浪费 + 违反设计;auth 错也 retry = 显然没意义 |
| **C. 按 `classified.code` 分级**(选中) | transient retry × 2,deterministic 立即放弃或 fallover | 复杂度可接受,行为正确 |
| D. SDK 内部 retry | 走 OpenAI SDK 的 maxRetries | 不可见(SDK 默认 maxRetries=2 是隐式的),debug 困难;**改用 maxRetries=0 让失败显式** |

选 C。

## 最终选择

实现在 [apps/api/src/drivers/image/openai-compatible.ts](../../../apps/api/src/drivers/image/openai-compatible.ts):

```
const PROVIDER_RETRY_LIMIT = 2;
const PROVIDER_RETRY_BACKOFF_MS = 5_000;

外层 for (provider in pool by priority):
  内层 for (retry = 0..PROVIDER_RETRY_LIMIT):
    try { call; return }
    catch {
      classify(err):
        moderation + !bypass → 立即 throw ImageGenError("moderation_rejected"),不 retry 不 fallover
        aborted              → 立即 throw("aborted")(用户取消)
        auth (401/403)       → break 内层(跳过 retry,但 fallover 到下个 provider)
        其它(network/server/rate_limit/unknown) → backoff 5s, 继续 retry
    }
  // 内层用完 → continue 外层(fallover)
// 外层用完 → throw "all_providers_failed"
```

总尝试次数 = (RETRY_LIMIT + 1) × pool.size = **3 × N** in transient 路径;auth 错最多 N 次;moderation/aborted 1 次。

## 副作用

- **单 job 最坏耗时**:单 provider 3 次 × 各最长 10 min + 2 × 5s backoff ≈ **30 分钟**。多 provider 池满更长。
- **同样 input retry 救不了 deterministic 失败**:如果 prompt 内容触发渠道卡死(见 [pitfalls/anyrouter-complex-prompt-ceiling](../pitfalls/anyrouter-complex-prompt-ceiling.md)),retry 用同样 input 一定继续死。retry 只对瞬时抖动有效。
- **OpenAI SDK 设 `maxRetries: 0`**——禁用 SDK 内部隐式 retry(默认 2 次),让失败立即 surface,可观测性高。

## 调参说明

- `PROVIDER_RETRY_LIMIT = 2` 是产品默认。调研期间为了快速迭代实验把它临时设成 `0`(单次 attempt 出结果即可),正式使用复原 `2`。
- `5s backoff` 是经验值——多次实测 anyrouter 短抖动通常 < 5s 就恢复,长抖动 retry 也救不回。

## 关联条目

- [domains/provider-pool](../domains/provider-pool.md) — pool walker 整体语义
- [pitfalls/pool-moderation-no-fallover](../pitfalls/pool-moderation-no-fallover.md) — moderation 不 retry 不 fallover 的设计原因
- [decisions/openai-sdk-over-fetch](openai-sdk-over-fetch.md) — 为什么 images 端点用 SDK(retry 配置依赖于此)
