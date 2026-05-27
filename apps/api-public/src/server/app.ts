import { Hono } from "hono";
import { cors } from "hono/cors";
import { db } from "../storage/db.js";
import { reapExpiredSessions } from "../storage/sessions.js";
import { reapExpiredStates } from "../domain/auth/oauth-state-store.js";
import { registerInviteCodeTopup } from "../topups/invite-code/index.js";
import { authRoutes } from "./routes/auth.js";

export function createApp() {
  // Touch DB:apply 核心 schema(invite-code register 也会用同一连接 apply 自己的)
  db();

  // Startup reaper:清掉过期 sessions / oauth_states,免得无限增长
  const reapedSessions = reapExpiredSessions();
  const reapedStates = reapExpiredStates();
  if (reapedSessions + reapedStates > 0) {
    console.log(
      `[startup] reaped ${reapedSessions} expired session(s) + ${reapedStates} oauth_state(s)`,
    );
  }

  const app = new Hono();
  app.use("*", cors());

  app.get("/api/health", c =>
    c.json({ ok: true, service: "inkast-api-public", ts: Date.now() }),
  );

  // ── 身份认证(Linux.do OAuth)─────────────────────
  app.route("/api", authRoutes);

  // ── 充值通道(外挂)──────────────────────────────
  // 核心业务跟通道完全解耦,每个通道自己管 schema + routes,这里只挂载。
  // Phase 2 新增 LDC 时,在下方追加 registerLdcTopup(app),createApp 其它代码不变。
  registerInviteCodeTopup(app);

  return app;
}
