# Per-Provider Rate-Limit Throttle

进程内 per-`providerId` 的最小间隔节流模块,匀速 minInterval 算法。Image driver pool walker 在每次 `attempt` 之前 await `acquireProviderSlot(providerId, ms)`,超时排队不 reject——plugin-async task 本来就是异步轮询,几百 ms 排队不影响成功率。

**为什么不用令牌桶**:plugin-async MAX_CONCURRENT=25,不需要 burst 能力;minimum interval 30 行实现,匀速干净。

## 核心契约

```ts
acquireProviderSlot(providerId: string, minIntervalMs: number): Promise<void>
```

- `minIntervalMs <= 0` → no-op(`Number.isFinite` 校验)
- 否则等到自己 slot:**前一个 acquirer 释放** + **距上次 dispatch ≥ minIntervalMs**

## 实现模式

```
Map<providerId, Promise<void>> acquisitionChain  ← 每个 provider 的 tail Promise
Map<providerId, number>        lastDispatchAt    ← 上次 dispatch 的 wall-clock ms

acquire(id, minMs):
  previous = chain.get(id) ?? Promise.resolve()
  myTurn = previous.then(async () => {
    waitMs = lastDispatchAt.get(id) + minMs - Date.now()
    if (waitMs > 0) await sleep(waitMs)
    lastDispatchAt.set(id, Date.now())
  })
  chain.set(id, myTurn)
  await myTurn
```

链节点完成后 V8 内部回收,**Map 只保留最后一个 tail reference**。

## 配置解析(`resolveProviderMinIntervalMs`)

`apps/api/src/drivers/image/openai-compatible.ts` 内,优先级:

1. `capability.extras.min_interval_ms`(per-provider override)— 当前 jdc 上:e=6000ms(10 RPM)、冰=2000ms(30 RPM)
2. env `INKAST_PROVIDER_MIN_INTERVAL_MS_DEFAULT`(process-wide default)— jdc 设 1000ms(60 RPM)
3. `0`(不限流)

**改配置不需要重启服务**——walker 每次重读 capability,DB 改了下个 task 就生效。SQL 模板见 [debugging-playbook](../../debugging-playbook.md#q6-是不是-throttle--rate_limit-配错了).

## 集成点

```ts
// apps/api/src/drivers/image/openai-compatible.ts pool walker
for (let retry = 0; retry <= retryLimit; retry++) {
  if (input.signal?.aborted) throw ...
  await acquireProviderSlot(provider.id, resolveProviderMinIntervalMs(capability));
  if (input.signal?.aborted) throw ...
  const started = Date.now();
  // ... real request
}
```

放在 `started = Date.now()` 之前,attempt duration 包含 throttle 等待——反映真实端到端耗时。

## 日志格式

```
[throttle] <providerId> waiting <waitMs>ms (min_interval=<minIntervalMs>ms)
```

只在实际等了 > 0ms 时打——0 等待时不打,避免日志噪声。

## 关键文件

| 文件 | 职责 |
|---|---|
| `apps/api/src/lib/throttle.ts` | acquireProviderSlot 实现 |
| `apps/api/src/drivers/image/openai-compatible.ts` | resolveProviderMinIntervalMs + 集成点 |

## 注意

- **进程内**(`inkast-api` 是单进程),跨进程协调用不到
- **per-providerId**,不同 provider 不互相影响,跨 mode 同 providerId(罕见)共享 slot
- `signal?.aborted` 在 throttle 等待中**不会自动取消**——但 minMs 通常 ≤ 6s,影响小

## 关联条目

- [pool-retry-graded](../decisions/pool-retry-graded.md) — pool walker 的整体 retry/fallover 语义
- [per-capability-retry-budget](../decisions/per-capability-retry-budget.md) — 同位置(`capability.extras`)的 retry 配置
- [provider-pool](../domains/provider-pool.md) — 上层 pool walker
