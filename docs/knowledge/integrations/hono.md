# Hono — API 框架

轻量 Node/Edge 友好的 HTTP 框架,Vite 风格 API。inkast API 用它路由。

## 使用方式

`apps/api/src/server/app.ts`:

```ts
import { Hono } from "hono";
import { cors } from "hono/cors";

const app = new Hono();
app.use("*", cors());
app.get("/api/health", c => c.json({ status: "ok", ... }));
app.route("/api", promptRoutes);
app.route("/api", providerRoutes);
app.route("/api", generateRoutes);
```

`@hono/node-server` 提供 `serve({ fetch: app.fetch, port })`,Node 18+ 内置 fetch 风格。

## 路由组织模式

每个 feature 一个 `Hono` 子实例:

```ts
export const generateRoutes = new Hono();
generateRoutes.post("/generate-image", async c => { ... });
generateRoutes.get("/generations", c => { ... });
```

主 app 用 `app.route("/api", subRoutes)` 挂载——sub 里的 `/generate-image` 实际暴露为 `/api/generate-image`。

## 错误处理

用 `HTTPException`(`hono/http-exception`):

```ts
import { HTTPException } from "hono/http-exception";

throw new HTTPException(400, { message: "..." });
```

Hono 默认 errorHandler 把 HTTPException 转成对应 status + JSON body。

**异常**:我们的 generate route 不抛 HTTPException,而是 `return c.json({ error, message, attempts }, status)` ——因为响应里要带 attempts 数组(标准 HTTPException 只有 message 字段)。

## CORS

`app.use("*", cors())` 启用全开 CORS,因为:

1. Vite dev 用 proxy(`/api/*` → `127.0.0.1:8787`),理论上同源
2. 未来若做 Localhost Helper 模式(公网 web 调本机 API),需要 origin allowlist

Phase 2+ 把 CORS 收紧成 allowlist:

```ts
cors({ origin: ["https://inkast.com", "http://localhost:5173"] })
```

## 读 JSON body

```ts
async function readJson<T>(c: Context): Promise<T> {
  try { return (await c.req.json()) as T; }
  catch { throw new HTTPException(400, { message: "invalid JSON body" }); }
}
```

`providers.ts` 内部小工具,各路由复用。

## 关联条目

- [shared-contracts](../shared/shared-contracts.md) — 请求/响应类型
- [image-generation](../domains/image-generation.md) — generate route
- [provider-pool](../domains/provider-pool.md) — providers route
- [prompt-engine](../domains/prompt-engine.md) — prompt route
