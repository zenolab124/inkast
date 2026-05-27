import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import { findValidSession } from "../../storage/sessions.js";
import { findUserById, type UserRow } from "../../storage/users.js";
import { SESSION_COOKIE } from "../routes/auth.js";

/**
 * 鉴权 middleware:优先读 session cookie(OAuth 登录),fallback 到
 * X-Dev-User-Id header(仅 PUBLIC_API_DEV_AUTH=1 时,生产严禁打开)。
 *
 * routes 通过 c.get('user') 拿当前用户。
 */

declare module "hono" {
  interface ContextVariableMap {
    user: UserRow;
  }
}

const DEV_AUTH_ENABLED = process.env.PUBLIC_API_DEV_AUTH === "1";

export async function requireAuth(c: Context, next: Next): Promise<Response | void> {
  // 1. 正常路径:session cookie
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    const sess = findValidSession(token);
    if (sess) {
      const user = findUserById(sess.userId);
      if (user) {
        c.set("user", user);
        return next();
      }
    }
  }

  // 2. dev 后门(仅本地启用)
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

  return c.json({ error: "unauthenticated" }, 401);
}
