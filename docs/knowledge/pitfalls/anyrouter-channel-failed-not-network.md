# anyrouter `get_channel_failed` 是模型负载满,不是网络问题

**What**: plugin 调用拿到 503,日志显示 image driver 收 HTTP 500 错误。前两次 attempt 都是 60s 后 SSE error 关闭(看起来像网络问题/超时),第三次终于拿到了清晰 body:

```
HTTP 500: {"error":{
  "message":"当前模型 gpt-5.3-codex 负载已经达到上限,请稍后重试",
  "type":"new_api_error",
  "code":"get_channel_failed"
}}
```

**Why**: anyrouter 是 aggregator,把请求按账号分发到后端 channel pool。`gpt-5.3-codex`(实际是某图模别名)在该时段的 channel pool 满了——所有 channel 都在用 → 拒绝新请求。

但前两次 attempt 没看到这个明确 message,因为 anyrouter 先 emit 几个 progress 事件(`response.image_generation_call.in_progress` / `generating`)然后用 `error` event 关 stream,inkast 看到的是"60s 后 SSE 突然结束没拿到 result"——容易误判为网络问题/超时。

**Action**:

1. **认真读 error body**:HTTP 500 + JSON body 里 `code` 字段是 anyrouter 的诊断真相。不要只看 status code 或 "stream ended" 就归因网络
2. 看到 `get_channel_failed` → **不是网络问题**,等高峰过 / 换模型 / 换 provider
3. inkast image driver 对此做了 retry × 2(15-30s 间隔),但 channel 满通常持续几分钟到几十分钟,retry 都失败正常,fall over 到下一个 provider 是正解
4. dashboard `/admin/plugin-stats` 错误码 Top 10 里如果 `image_provider_unavailable` 很高 + 时间集中在某些小时,大概率是上游 channel 满

## 关联条目

- [cpa-internal-routes-to-anyrouter](cpa-internal-routes-to-anyrouter.md) — 同一故障的另一面(以为换 provider 能解决)
- [anyrouter-complex-prompt-ceiling](anyrouter-complex-prompt-ceiling.md) — anyrouter 上的另一类失败(prompt 复杂度)
- [provider-pool](../domains/provider-pool.md)
