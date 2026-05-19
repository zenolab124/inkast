# anyrouter 跨大洲 Akamai 多跳排队 (170-300s 接通时长)

## What

anyrouter 在响应头里暴露了完整 CDN 路由(`via` 头):

```
via: 1.1 Caddy,
     ens-cache21.l2hk12[238771,0,DP],
     ens-cache36.l2jp3[238820,0,DP],
     ens-cache29.l2us3[238988,0,DP],
     ens-cache8.us37[238988,0,DP],
     ens-cache8.us37[238989,0]
server: ESA
```

请求经过 **5 跳跨大洲缓存链** — `Caddy → HK → JP → US × 2`(`server: ESA` = Akamai Edge Services Architecture)。

方括号内的数字是该节点累计驻留毫秒数。实测**第一跳 `l2hk12` 排队 170-300s**(本质是 anyrouter 的接受队列),后续几跳几乎瞬时穿透(数字接近)。

## Why

anyrouter 不是直连 OpenAI 的代理,是个**多跳 CDN 加速通路**。第一跳 `l2hk12`(香港)在高负载下排队严重,排到队头后才往日本/美国转发到 OpenAI。

后果:
- 单次接通响应头要 170-300s(简单 prompt 也要 50-100s)
- 整体生图链路 ≥ 排队时长 + 模型处理时长(60-150s)≥ 总流时长经常 > 5 分钟

## Action

driver 在多层超时设置上**必须容忍这个排队特性**:

| 层 | 必须 ≥ | 实际配置 |
| --- | --- | --- |
| undici `headersTimeout` | 5 分钟(对应单次排队) | **600s** ✅ |
| undici `bodyTimeout` | 5 分钟(对应流内长空闲) | **600s** ✅ |
| undici `connectTimeout` | 30s(TCP 不该超过) | 30s ✅ |
| driver `DEFAULT_TIMEOUT_MS`(总超时) | 8-10 分钟 | **600s** ✅ |

配置在 [apps/api/src/drivers/http-agent.ts](../../../apps/api/src/drivers/http-agent.ts),通过 `setGlobalDispatcher(new Agent(...))` 全局生效。

诊断:driver 失败日志会打印响应头快照,包含 `via` 和 `server` —— **看到 `via: 1.1 Caddy, ens-cache*[XXX,0,DP]` 就知道踩中 CDN 排队**,可定位是 anyrouter 排队过长导致的接通慢。

## 关联条目

- [shared/http-agent](../shared/http-agent.md) — 全局 undici dispatcher 配置
- [pitfalls/undici-default-timeout-short](undici-default-timeout-short.md) — undici 默认 5 分钟被这个排队杀
- [pitfalls/anyrouter-body-size-cap](anyrouter-body-size-cap.md) — 排队链路的另一个瓶颈
