# 全局 undici dispatcher (apps/api/src/drivers/http-agent.ts)

一句话:全局副作用模块,在 Node 启动时 `setGlobalDispatcher(new Agent(...))`,把所有 `fetch` 的 undici 超时拉到 10 分钟,适配跨大洲 CDN 代理的长尾排队。

## 核心配置

```ts
import { Agent, setGlobalDispatcher } from "undici";

setGlobalDispatcher(new Agent({
  connectTimeout: 30_000,        // TCP 建立(Class-A 失败 30s 必报)
  headersTimeout: 600_000,       // 10 分钟,匹配 driver budget
  bodyTimeout: 600_000,          // 10 分钟,流内空闲
  keepAliveTimeout: 60_000,      // 连接复用窗口
}));
```

## 加载方式

[apps/api/src/index.ts](../../../apps/api/src/index.ts) 顶部副作用 import:

```ts
import "./drivers/http-agent.js";  // 必须早于任何 fetch 调用
import { createApp } from "./server/app.js";
```

模块加载即生效,**整个 Node 进程的 fetch(包括 OpenAI SDK 内部、driver 裸 fetch、其它任意调用)都用这套时序**。

## 使用方

- [apps/api/src/drivers/image/openai-responses.ts](../../../apps/api/src/drivers/image/openai-responses.ts) — 裸 fetch 走 `/v1/responses` 流,依赖大 bodyTimeout 容忍长流
- [apps/api/src/drivers/image/openai-compatible.ts](../../../apps/api/src/drivers/image/openai-compatible.ts) — OpenAI SDK 走 `/v1/images/*`,SDK 内部也用 undici,继承同样超时
- 未来任何 fetch 调用(URL 图下载、外部 webhook 等)

## 设计权衡

- 选**全局 dispatcher**而非每个 fetch 显式传 — 单点配置,所有调用对齐,OpenAI SDK 内部 fetch 也自动受益(不用包装它的 `fetch` 选项)
- `connectTimeout: 30s` 故意短 — Class-A 网络错误(DNS / RST / TLS 失败)必须秒级返回,这跟 headers/body 长超时不冲突
- 10 分钟跟 driver `DEFAULT_TIMEOUT_MS = 600_000` 对齐 — undici 不再早于 driver 自己的 AbortController 掐线;driver 才是最终超时仲裁者
- **副作用 import 的隐患**:tsx watch 重启 / 测试时 process restart 会重新加载,无累积副作用(`setGlobalDispatcher` 是幂等覆盖)

## 关联条目

- [pitfalls/undici-default-timeout-short](../pitfalls/undici-default-timeout-short.md) — 为什么需要这个模块
- [pitfalls/anyrouter-via-cdn-queue](../pitfalls/anyrouter-via-cdn-queue.md) — 长超时容忍的具体场景
- [domains/image-generation](../domains/image-generation.md) — 整体生图链路
- [decisions/pool-retry-graded](../decisions/pool-retry-graded.md) — 总超时上限和 retry 协同
