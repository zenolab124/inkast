import { Hono } from "hono";
import { cors } from "hono/cors";

export function createApp() {
  const app = new Hono();

  app.use("*", cors());

  app.get("/api/health", c =>
    c.json({ ok: true, service: "inkast-api-public", ts: Date.now() }),
  );

  return app;
}
