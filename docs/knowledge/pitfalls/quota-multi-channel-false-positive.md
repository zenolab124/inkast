# 多渠道聚合 provider 的 quota 虚警

聚合代理 provider(如 `gpt`,base `chatgpt2api.124213.xyz`)单子渠道额度耗尽触发 quota_exhausted,被 inkast 一刀切熔断整条聚合渠道到次日 06:00 北京时间——但其他子渠道仍有配额,任务本可成功。

## What

`gpt` provider 出现以下日志序列:

```
[image] ✗ gpt failed (quota_exhausted) in 2100ms
[image]   reason: HTTP 429: 余额不足...
```

紧接着 `markCapabilityAutoDisabledUntilNext6am("gpt-provider-id", "image")` 被调用,provider 被标记为 auto-disabled,后续所有任务跳过该 provider 直到次日。

但查看当天晚些时候的日志,可以看到**该 endpoint 后续确实出图成功**(手动在 Web UI 重启 provider 后,同 endpoint 返回了结果)——这证明并非所有子渠道都满,只是某一个子渠道当时满了。

## Why

inkast 的 quota 熔断逻辑对**单一渠道** provider 是正确的:额度真没了,再试浪费时间和网络。

但聚合代理(一个 endpoint 背后有多个上游子渠道,请求按负载均衡分发)时,单个子渠道的 quota 信号**不代表整条 endpoint 的 quota 耗尽**。inkast 无法感知上游路由,只能看到 `429 + 余额不足`。

`markCapabilityAutoDisabledUntilNext6am` 会一直影响到次日 06:00——如果 `gpt` 是 priority 最低(首选)的 provider,这段时间所有任务都会直接跳到次优 provider,增加 latency 或失败率。

## Action

1. **给聚合 provider 设 `capability.extras.exemptAutoDisable = true`**:quota 信号出现时不调 `markCapabilityAutoDisabledUntilNext6am`,也不 `break`,而是 fall through 到 transient retry 路径。
2. **配合设 `retryLimit`**(如 `gpt` 设 1):quota fall through 后 5s 退避重试一次同 endpoint,有机会路由到未满的子渠道;仍失败才 fallover 到下一个 provider。
3. **手工 patch DB**(暂无 Web UI 入口):
   ```sql
   UPDATE provider_capabilities
   SET extras = json_patch(extras, '{"exemptAutoDisable": true}')
   WHERE provider_id = '<gpt-provider-id>' AND kind = 'image';
   ```

代码位置:`apps/api/src/drivers/image/openai-compatible.ts`,`quota_exhausted` 分支的 `if (!capability.extras?.exemptAutoDisable)` 判断。

## 关联条目

- [decisions/multi-channel-quota-exemption](../decisions/multi-channel-quota-exemption.md) — 豁免机制的设计决策
- [decisions/per-capability-retry-budget](../decisions/per-capability-retry-budget.md) — retryLimit 控制 fall through 后重试次数
- [domains/provider-pool](../domains/provider-pool.md) — quota_exhausted 在完整池语义里的位置
- [pitfalls/anyrouter-pseudo-stream-deep-failure](anyrouter-pseudo-stream-deep-failure.md) — 对比:假活流的根因和应对(retry=0,而不是豁免 auto-disable)
