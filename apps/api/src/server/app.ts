import { Hono } from "hono";
import { cors } from "hono/cors";
import { promptRoutes } from "./routes/prompt.js";
import { providerRoutes } from "./routes/providers.js";
import { generateRoutes } from "./routes/generate.js";
import { jobsRoutes } from "./routes/jobs.js";
import { db } from "../storage/db.js";
import { reaperAbandonedJobs } from "../storage/jobs.js";
import { getLlmDriver } from "../drivers/llm/index.js";

export function createApp() {
  // Touch the DB to apply schema before serving any request.
  db();

  // Any pending/running jobs were owned by the previous process — their
  // in-memory promises are gone, so mark them failed so the frontend doesn't
  // show forever-spinning cards.
  const reaped = reaperAbandonedJobs();
  if (reaped > 0) {
    console.log(`[startup] reaped ${reaped} abandoned job(s) from previous run`);
  }

  // Pre-pay LLM cold-start in the background so the user's first real prompt
  // doesn't eat the subprocess spawn + OAuth decrypt + TLS handshake.
  void getLlmDriver()
    .warmup()
    .then(r => console.log(`[startup] llm warmup: ${r.durationMs}ms (cached=${r.cached})`))
    .catch(err => console.warn(`[startup] llm warmup failed (non-fatal):`, err?.message ?? err));

  const app = new Hono();

  app.use("*", cors());

  app.get("/api/health", c =>
    c.json({ status: "ok", service: "inkast-api", version: "0.0.1" }),
  );

  app.route("/api", promptRoutes);
  app.route("/api", providerRoutes);
  app.route("/api", generateRoutes);
  app.route("/api", jobsRoutes);

  return app;
}
