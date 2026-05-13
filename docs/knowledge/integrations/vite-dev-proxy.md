# Vite Dev Proxy

Vite 开发服务器把 `/api/*` 代理到本机 API。对生图这种 3-10 分钟的慢链路,**proxy 超时也要单独配置**,默认值会先于 API 报 502。

## 配置位置

`apps/web/vite.config.ts`:

```ts
server: {
  port: 5173,
  proxy: {
    "/api": {
      target: "http://127.0.0.1:8787",
      changeOrigin: true,
      timeout: 600_000,        // socket 不活跃超时
      proxyTimeout: 600_000,   // 上游响应总超时
    },
  },
},
```

`timeout` 和 `proxyTimeout` 都设到 10 分钟,跟 image driver 的 `timeout: 600_000` 对齐——三层超时链("驱动 SDK / proxy / 客户端 fetch")必须协调,见 [image-driver-timeout-chain](../pitfalls/image-driver-timeout-chain.md)。

## changeOrigin

`changeOrigin: true` 让代理把 Host header 改成 target host。生产部署不用 vite proxy,改用 nginx 之类,此配置仅 dev。

## 端口约定

- Web dev: `5173` (Vite 默认)
- API dev: `8787` (Hono 默认)
- 冲突时 vite 自动找下一个空端口(5174 等),但代理 target 是写死的 `127.0.0.1:8787`

如果 API 死了(没 listen),浏览器 fetch `/api/*` 会瞬间 502(ECONNREFUSED 不超时)。dev 故障要看 API 进程是否健康——查 `lsof -nP -iTCP:8787 -sTCP:LISTEN` 或日志 `[inkast api] listening`。

## 关联条目

- [image-driver-timeout-chain](../pitfalls/image-driver-timeout-chain.md) — 超时设计
- [image-generation](../domains/image-generation.md) — 慢链路源头
- [dev-server-port-collision](../pitfalls/dev-server-port-collision.md) — 多进程占同一端口的坑
