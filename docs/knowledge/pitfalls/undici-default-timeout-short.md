# Node undici 默认 5 分钟超时太短,被代理 RST 杀

## What

Node 18+ 内置 fetch 走 undici。默认 dispatcher 的两个关键超时:

- `headersTimeout: 300_000` (5 分钟) — 从 socket 建立到收到响应头
- `bodyTimeout: 300_000` (5 分钟) — 流内空闲时长

跨大洲 CDN 代理(anyrouter / 类似 Akamai 加速通路)的接通时间经常超过 5 分钟,流式生图 + 多 tool call 场景的总时长也常常 > 5 分钟。**踩中 undici 默认值会被自家 fetch 主动 abort**,而**不是被代理掐线**——错误形如:

```
TypeError: fetch failed
cause: HeadersTimeoutError: Headers Timeout Error (code=UND_ERR_HEADERS_TIMEOUT)

或

cause: BodyTimeoutError: Body Timeout Error (code=UND_ERR_BODY_TIMEOUT)
```

跟代理主动 RST(`UND_ERR_SOCKET: other side closed`)不同 — 这是**客户端自己掐**了请求,代理没掐过我们。

## Why

undici 的默认值面向"互联网 P90 请求 < 5 分钟"的典型场景,不适合"跨大洲 CDN 排队 + 模型流式输出"的长尾。Node 升级版本时默认值可能调,但永远不会调到 10 分钟这个量级。

## Action

driver 在 server 入口注入全局 undici dispatcher,匹配 driver-level 总超时:

```ts
// apps/api/src/drivers/http-agent.ts (模块级副作用)
import { Agent, setGlobalDispatcher } from "undici";

setGlobalDispatcher(new Agent({
  connectTimeout: 30_000,        // TCP 建立必须快(Class-A 失败 30s 内必报)
  headersTimeout: 600_000,       // 10 分钟,匹配 driver budget
  bodyTimeout: 600_000,          // 同上
  keepAliveTimeout: 60_000,      // 连接复用 60s
}));
```

在 [apps/api/src/index.ts](../../../apps/api/src/index.ts) 顶部 `import "./drivers/http-agent.js";`(副作用 import,保证 dispatcher 在任何生图请求前就绪)。

**代价**:silent peer death(对端机器断电/网线拔了,且操作系统层来不及发 RST)的发现时间从 5 分钟拉到 10 分钟。对 inkast 这种场景可以接受 — 快速失败的 Class-A 错误(DNS / RST / refused)用 `connectTimeout: 30s` 覆盖,30s 内必报。

## 诊断

driver 的 `classifyError` 会展开 `err.cause`,所以失败日志能看到:

```
[image] ✗ any failed (network) in 301812ms
[image]   reason: fetch failed | cause: BodyTimeoutError: ... (code=UND_ERR_BODY_TIMEOUT)
```

`UND_ERR_BODY_TIMEOUT` / `UND_ERR_HEADERS_TIMEOUT` 字样 = 我们自己掐了。`UND_ERR_SOCKET` = 对端 RST。两个完全不同的归因。

## 关联条目

- [shared/http-agent](../shared/http-agent.md) — dispatcher 配置详情
- [pitfalls/anyrouter-via-cdn-queue](anyrouter-via-cdn-queue.md) — 为什么默认 5 分钟不够
- [pitfalls/anyrouter-body-size-cap](anyrouter-body-size-cap.md) — 代理主动 RST 的另一面
