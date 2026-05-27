import type { Context, Next } from "hono";
import { findUserById, type UserRow } from "../../storage/users.js";

/**
 * 请求级 user context。OAuth 接好之后,这里换成从 cookie session token 解析,
 * 但 ctx.get('user') 接口形状不变,routes 不用动。
 *
 * 当前实现:仅在 env PUBLIC_API_DEV_AUTH=1 下读取 X-Dev-User-Id header。
 * 生产部署绝对不要打开这个 env——会让任何人冒充任意 user_id。
 */

declare module "hono" {
  interface ContextVariableMap {
    user: UserRow;
  }
}

const DEV_AUTH_ENABLED = process.env.PUBLIC_API_DEV_AUTH === "1";

export async function requireAuth(c: Context, next: Next): Promise<Response | void> {
  if (DEV_AUTH_ENABLED) {
    const header = c.req.header("x-dev-user-id");
    if (header) {
      const id = Number(header);
      if (!Number.isInteger(id) || id <= 0) {
        return c.json({ error: "invalid X-Dev-User-Id" }, 400);
      }
      const user = findUserById(id);
      if (!user) return c.json({ error: "user not found", id }, 401);
      c.set("user", user);
      return next();
    }
  }

  // OAuth session middleware 落地前,非 dev 路径一律 401。
  return c.json({ error: "unauthenticated" }, 401);
}
