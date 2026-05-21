# gpt-5.3-codex "假活流"是深度故障,retry 同 provider 无用

`cpa` / `any` / `🌿` 这类走 `gpt-5.3-codex` + responses mode 的 provider,会进入一种**流头 200 OK + 流体只有 keepalive 永不出图**的状态。属于**上游模型节点宕机**,不是瞬时抖动。

## What

journalctl 日志典型表现:
```
[image]   ← response headers in 6070ms (status=200 content-type=text/event-stream)
[image]   … response.output_item.added (+6072ms)
[image]   … response.image_generation_call.in_progress (+7788ms)
[image]   … response.image_generation_call.generating (+8200ms)
[image]   …still waiting on cpa (mode=responses, refs=0, 30s elapsed)
... (每 15s 一行 heartbeat,事件流只有 keepalive)
[image] ✗ cpa failed (unknown) in 600001ms     ← 10 分钟兜底超时
[image]   reason: stream ended without an image_generation_call result.
            Saw 22 events. Event types: {keepalive:12, in_progress:6, generating:3, ...}
            Items added: {image_generation_call:6} Items done: {}
```

`events=N` 全是 placeholder 事件,**`itemsDone={}` 永远为空**。流自然终止或跑满 600s 客户端超时。

## Why

代码注释里 `PROVIDER_RETRY_LIMIT` 之前的解释:

> empirically the anyrouter proxy goes through brief windows where the image_generation tool fires but never emits a partial — the stream ends with 0 done items. These are not deterministic failures; a retry 5-10s later typically lands in a different upstream queue slot and succeeds.

**这个经验对"轻量队列拥塞"成立,对"模型节点宕机"不成立**。实际生产中观察到的 99%"假活流",是上游 gpt-5.3-codex 模型 worker **死锁 / OOM / 网络瘫痪**——同一个 provider 同一个 endpoint 重试只会进同一个挂死的 worker pool。

5/21 晚上 4 个 Web UI 任务全部卡死 25+ 分钟,就是这条根因。

## Action

**1. PROVIDER_RETRY_LIMIT 默认值改 1**(2026-05-21 commit `72eb46f`,2 → 1)——把同 provider 兜底从 2 次 retry × 600s = 30 分钟砍到 20 分钟。
**2. per-capability retry**(2026-05-22 commit `e63141b`)允许给 cpa / any / 🌿 配 `retryLimit = 0`,**第一次失败就 fall over**,把"假活流被发现"的等待砍到一次 600s 内。
**3. 长期 driver 改进**(未做):理想是把"stream ends with 0 done items"归为 fast-fail 类(跟 moderation/auth 同级,不进 transient retry 路径),`classifyError` 加新错误码,driver pool 看见就直接 fall over。这是结构性改造,记为 TODO。
**4. 不要把同 model 的多个 provider 串联放 priority 1+2**——cpa 和 any 都用 gpt-5.3-codex,model 挂了两个一起死。建议混合 model(`gpt-5.3-codex` + `gpt-image-2`)交替。

## 关联

- [[per-capability-retry-budget]] — cpa/any 应配 retry=0 的根因
- [[pool-retry-graded]] — 整体 retry / fallover 分级
- [[anyrouter-channel-failed-not-network]] — 类似根因,不同表象(返 channel_failed error code)
- [[plugin-pool-too-narrow-by-model]] — pool 内 model 重复放大单点故障
