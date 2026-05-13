import { serve } from "@hono/node-server";
import { createApp } from "./server/app.js";

const port = Number(process.env.API_PORT ?? 8787);
const app = createApp();

serve({ fetch: app.fetch, port }, info => {
  console.log(`[inkast api] listening http://127.0.0.1:${info.port}`);
});
