import type { Hono } from "hono";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { applyExtraSchema } from "../../storage/db.js";
import { inviteCodeRoutes } from "./routes.js";

/**
 * 注册 invite-code 充值通道:
 *   1. apply 自己的 schema(invite_codes 表)
 *   2. 挂自己的 routes 到 /api 下
 *
 * 核心 createApp 只需要 import 这一个函数并调用,完全不关心 invite-code
 * 的内部表/逻辑。这就是"充值外挂"——新通道只在 createApp 多挂一行。
 */
export function registerInviteCodeTopup(app: Hono): void {
  const schemaPath = join(dirname(fileURLToPath(import.meta.url)), "schema.sql");
  applyExtraSchema(schemaPath);
  app.route("/api", inviteCodeRoutes);
}
