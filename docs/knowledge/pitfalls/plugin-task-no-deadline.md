# Plugin 任务没有任务级 deadline(总耗时可远超调用方 timeout)

**What**: 一个 plugin 任务实测耗时 **533s(8 分 53 秒)**:cpa 3 次 attempt 失败 5 分钟 + fall over 到 any 后 3.5 分钟生成。inkast 最终成功 + callback POST 也 200 ack。但 snap-ub worker 配的 `GENERATOR_TIMEOUT_MS=180000`,**任务在 180s 时已经 mark 为 timeout 失败**。callback 来的时候 snap-ub 走 v2 §4 幂等性"已 mark 直接 return 200,不重复处理"——两侧最终状态不一致。

**Why**: inkast `plugin-async` 里:

- image driver 单 attempt 超时 = `DEFAULT_TIMEOUT_MS = 600_000`(10 分钟)
- 池子里多个 provider 可 fall over,理论上总耗时上界 = `N providers × 10 min`
- **task 自身没有 deadline**,跑多久都算"成功"
- 单 attempt 跨 provider fall over 累计可轻松 > 6 分钟,远超 v2 协议 §6 "≤6 分钟"约束

发现路径: snap-ub 报告"调用方显示生图超时但 inkast 显示成功",查日志才看到 533s 这个数字。

**Action**(当前接受现状,留 TODO):

可加的硬约束(plugin-async 加 task 级 AbortController):

```ts
const TASK_TIMEOUT_MS = 6 * 60 * 1000; // 6 min, 跟 v2 §6 对齐
const ac = new AbortController();
const timeoutHandle = setTimeout(() => ac.abort(), TASK_TIMEOUT_MS);
try {
  const imageOutcome = await generateImage({ ..., signal: ac.signal });
  ...
} finally {
  clearTimeout(timeoutHandle);
}
// abort 时 driver 抛 ImageGenError("aborted") → mapper 转 504 timeout → callback
```

**为什么没立刻做**: 用户判断"短期接受,先看真实业务调用模式再定阈值"。如果 snap-ub 改成 300s timeout,问题自然消失;如果保持 180s,inkast 端加 task deadline 是正解。

## 关联条目

- [v2-async-callback-protocol](../decisions/v2-async-callback-protocol.md) — 协议 §6 "≤6 分钟"约束
- [pool-retry-graded](../decisions/pool-retry-graded.md) — provider 内部 retry 策略(累加导致总耗时长)
- [image-driver-timeout-chain](image-driver-timeout-chain.md) — driver/proxy/SDK 多层超时协调
