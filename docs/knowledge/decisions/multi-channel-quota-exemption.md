# 多渠道聚合 provider 的 quota 豁免

对聚合多个上游子渠道的 image provider(如 `gpt`),单子渠道 quota 信号**不触发整条渠道的 auto-disable**,而是 fall through 到 transient retry 路径,由 per-capability retryLimit 控制重试次数,有机会命中未满的兄弟子渠道。

## 背景

`gpt`(base `chatgpt2api.124213.xyz`,priority=1)实为多个上游子渠道的聚合代理。某个子渠道当日额度用尽会返 quota_exhausted/429,但同一个 endpoint 的其他子渠道仍有配额,任务本可成功。

原逻辑:一旦 `classifyError()` 得出 `quota_exhausted`,立即调 `markCapabilityAutoDisabledUntilNext6am(provider.id, "image")`,把整条聚合渠道熔断到次日 06:00 北京时间,然后 `break` 跳 fallover。

对**单一渠道** provider 这是正确的——额度真的没了,继续试只浪费 latency。但对聚合代理是过激——相当于因为一家分店打烊就关了整个连锁。

## 方案对比

| 方案 | 描述 | 否决原因 |
|---|---|---|
| A(最终选择)| `extras.exemptAutoDisable=true` + fall through 到 transient retry | — |
| B | 短冷却替代长熔断(如 5min 而非到次日 6am) | 无法区分单渠道"真没额度"与聚合"假没额度" |
| C | 固定 N 次全局 retry 不区分 provider | 无 UI 可调,且不同聚合程度的 provider 需求不同 |

## 最终选择

**A**:`capability.extras.exemptAutoDisable = true` 作为豁免 flag。

代码路径(`apps/api/src/drivers/image/openai-compatible.ts`,`quota_exhausted` 分支):

```ts
if (!capability.extras?.exemptAutoDisable) {
  markCapabilityAutoDisabledUntilNext6am(provider.id, capability.kind);
  break;
}
// 豁免:不熔断,fall through 到 transient retry 路径
console.log(`... quota signal but exempt (multi-channel) — retrying on same provider instead of auto-disable`);
```

fall through 之后进入和普通 transient 相同的退避重试逻辑,受 `capability.extras.retryLimit` 控制上限。`gpt` 设 `retryLimit=1`:quota 信号出现后 5 秒再试一次同 endpoint,有机会落到另一个子渠道;仍失败才 fallover。

## 副作用与已知债务

- **代价**:全部子渠道都满时,多浪费 `retryLimit` 次 × 5s 退避 + 每次的实际请求时间,再 fallover 到下家。对 retryLimit=1 大约额外 10-20 秒。
- **UI 未暴露**:`exemptAutoDisable` 暂无 Web UI 入口。从 ProviderConfigDialog 保存会用 `{ ...capability.extras, ...formValues }` 合并,**不会主动删除** `exemptAutoDisable`——但若操作员保存时弹窗里没有这个字段,旧值会被覆盖归零(取决于合并实现)。目前需**手工 patch DB**:
  ```sql
  UPDATE provider_capabilities
  SET extras = json_patch(extras, '{"exemptAutoDisable": true}')
  WHERE provider_id = '<gpt-provider-id>' AND kind = 'image';
  ```
- **已有 auto-disable 标记的手工清除**:只需在 Web UI 把该 provider 的 image capability toggle 关再开,或手工 patch `auto_disabled_until = NULL`。

## 关联条目

- [per-capability-retry-budget](per-capability-retry-budget.md) — retryLimit 决定 fall through 后最多重试几次
- [domains/provider-pool](../domains/provider-pool.md) — quota_exhausted 在池语义里的完整位置
- [pitfalls/quota-multi-channel-false-positive](../pitfalls/quota-multi-channel-false-positive.md) — 这个决策解决的具体问题
- [pitfalls/anyrouter-pseudo-stream-deep-failure](../pitfalls/anyrouter-pseudo-stream-deep-failure.md) — 对比:假活流应该 retry=0 而非豁免 auto-disable
