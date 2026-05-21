# `@hono/node-server` 默认监听 0.0.0.0(误以为只 loopback)

**What**: 部署 inkast 到 jdc,以为 `console.log('listening http://127.0.0.1:8787')` 表示只本机访问。但 `ss -tlnp` 显示 `LISTEN *:8787` —— **公网也能访问**(只要防火墙没挡)。

**Why**: `@hono/node-server` 的 `serve({ port })` 不传 `hostname` 时默认绑 `0.0.0.0`(对应 `*` listener,所有接口都监听)。`console.log` 里写的 "127.0.0.1" 只是 hardcoded 字符串,跟实际 binding 无关。

发现路径:用户问"为什么 plugin 通道公网入口要走 nginx 反代,inkast 不能直接对外?"我才仔细看了 `index.ts` 的 `serve()` 调用——确实没传 hostname。

**Action**: 加 `API_HOST` env,显式传给 `serve()`:

```ts
const hostname = process.env.API_HOST?.trim() || undefined;
serve({ fetch: app.fetch, port, ...(hostname ? { hostname } : {}) }, info => {
  console.log(`[inkast api] listening http://${hostname ?? info.address}:${info.port}`);
});
```

生产 systemd EnvironmentFile 设 `API_HOST=127.0.0.1`。本地 dev 不设(走默认 0.0.0.0,方便手机端访问)。

部署后用 `ss -tlnp | grep 8787` 验证显示 `LISTEN 127.0.0.1:8787` 而非 `*:8787`。

## 关联条目

- [hono](../integrations/hono.md)
- [plugin-channel](../domains/plugin-channel.md) — 这个 env 在 plugin 通道部署里是必设项
