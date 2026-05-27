import { serve } from "@hono/node-server";
import { createApp } from "./server/app.js";

const port = Number(process.env.PUBLIC_API_PORT ?? 8788);
const hostname = process.env.PUBLIC_API_HOST?.trim() || undefined;
const app = createApp();

serve({ fetch: app.fetch, port, ...(hostname ? { hostname } : {}) }, info => {
  console.log(
    `[inkast api-public] listening http://${hostname ?? info.address}:${info.port}`,
  );
});
