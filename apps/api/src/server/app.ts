import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "@hono/node-server/serve-static";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { promptRoutes } from "./routes/prompt.js";
import { providerRoutes } from "./routes/providers.js";
import { generateRoutes } from "./routes/generate.js";
import { jobsRoutes } from "./routes/jobs.js";
import { pluginRoutes } from "./routes/plugins.js";
import { adminRoutes } from "./routes/admin.js";
import { db } from "../storage/db.js";
import { reaperAbandonedJobs } from "../storage/jobs.js";
import { getLlmDriver } from "../drivers/llm/index.js";
import { initPluginAsync } from "../domain/plugin-async/index.js";

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

  // Plugin 通道 v2 异步:同样的恢复语义(interrupted task 立即 callback)+
  // 启动 24h GC loop。
  initPluginAsync();

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

  // Plugin 通道(对外接入方,如 snap-ub)。token-bearer 鉴权,与 Web UI 完全隔离。
  app.route("/plugins", pluginRoutes);

  // 管理端(loopback only)。公网 nginx /inkast/ 反代不暴露 /admin/*,
  // 仅通过 ssh -L 8787:127.0.0.1:8787 jdc 端口转发后本机浏览器可达。
  app.route("/admin", adminRoutes);

  // 可选 Web UI 静态托管。仅在 INKAST_WEB_DIST 指向有效产物目录时启用 —— 本地
  // dev 模式 web 走 Vite 5173(自带 /api proxy),无需此中间件。生产/部署模式
  // 设置 INKAST_WEB_DIST 让 api 进程同机 serve 静态资源,省去额外 nginx 反代。
  const webDistEnv = process.env.INKAST_WEB_DIST?.trim();
  if (webDistEnv) {
    const webDist = resolve(webDistEnv);
    const indexPath = join(webDist, "index.html");
    if (existsSync(indexPath)) {
      const indexHtml = readFileSync(indexPath, "utf-8");
      app.use("/*", serveStatic({ root: webDist }));
      app.notFound(c => {
        const path = c.req.path;
        if (path.startsWith("/api/") || path.startsWith("/plugins/")) {
          return c.json({ error: "not_found", path }, 404);
        }
        return c.html(indexHtml);
      });
      console.log(`[startup] serving Web UI from ${webDist}`);
    } else {
      console.warn(
        `[startup] INKAST_WEB_DIST=${webDist} set but index.html not found; static serving disabled`,
      );
    }
  }

  return app;
}
