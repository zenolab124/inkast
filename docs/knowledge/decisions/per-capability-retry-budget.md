# Per-Capability Retry Budget

每个 image provider 的 retry 次数独立配,不是全局常量。Web UI 弹窗 0-5 整数 + "留空跟全局默认"。

## 背景

`PROVIDER_RETRY_LIMIT` 之前是写死的全局常量(从 2 改到 1)。但 pool 里 provider 的故障性质差异很大:

- **cpa / any**(gpt-5.3-codex,假活流深度故障)→ retry 同 provider 没用,只把切换到健康 provider 的等待时间放大数倍
- **ciallo**(eo.ioll.pp.ua 偶发抖动)→ retry 一次有意义
- **duck / duck2**(漫威概率拒图)→ retry 多次可能"抽中"漏审通过(实测 5 次 1 次过)

全局值一刀切,不论调成多少都对某类 provider 不公平。

## 方案对比

| | A · 全局常量(原方案) | **B · per-capability + 全局默认** |
|---|---|---|
| 配置位置 | const | `capability.extras.retryLimit` |
| 修改影响 | 改一处影响所有 provider | 只影响一个 capability |
| UI 暴露 | 无 | provider 编辑弹窗加 number input(0-5) |
| 留空语义 | n/a | 跟全局默认走(当前 1) |
| schema 变更 | 无 | 零(extras 已是 JSON 字段) |

## 最终选择

**B**。`drivers/image/openai-compatible.ts` 加 `resolveRetryLimit(capability)` 替代常量,clamp 到 0-5,无设置(`undefined / null / 越界`)走全局默认 `PROVIDER_RETRY_LIMIT_DEFAULT = 1`。

前端 `ImageRetryRow` 跟 `ImageModeRow` 同行风格,在 model + mode 之后追加。i18n 加 `imageRetry.{label,hint,placeholder}`。

## 副作用

- 推荐配置:cpa=0 / any=0 / ciallo=1 / duck=3
- **没 retry timeout 同步配置**(用户明确说 timeout 不动)。timeout 仍是全局常量 `DEFAULT_TIMEOUT_MS=600000`,如果以后要加,同样的 extras 改造可一次性做
- 留空"跟全局默认"语义对老 capability 友好(extras = null 或不含 retryLimit 都走默认),**已有 provider 不需要迁移**

## 关联

- [[pool-retry-graded]] — 整体 retry / fallover 分级语义
- [[anyrouter-pseudo-stream-deep-failure]] — cpa/any 假活流应该配 retry=0 的根因
- [[duck-moderation-probabilistic]] — duck 应该配 retry=3 的根因
- [[provider-capability-table-split]] — extras 字段所在表
