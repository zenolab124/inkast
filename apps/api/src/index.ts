import { serve } from "@hono/node-server";
// Side-effect import: configures global undici dispatcher timings before any
// generation job can run. See drivers/http-agent.ts for the rationale.
import "./drivers/http-agent.js";
import { createApp } from "./server/app.js";

const port = Number(process.env.API_PORT ?? 8787);
// API_HOST 控制绑定接口。生产部署应显式设 127.0.0.1 防止公网误暴露;
// 本地 dev 默认不传,沿用 @hono/node-server 默认行为(0.0.0.0)。
const hostname = process.env.API_HOST?.trim() || undefined;
const app = createApp();

serve({ fetch: app.fetch, port, ...(hostname ? { hostname } : {}) }, info => {
  console.log(
    `[inkast api] listening http://${hostname ?? info.address}:${info.port}`,
  );
});
