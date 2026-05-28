import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import { incrementAndGet } from "../../storage/rate-limit.js";
import { findValidSession } from "../../storage/sessions.js";
import { SESSION_COOKIE } from "../routes/auth.js";

/**
 * 限流 middleware。固定窗口(minute / hour / day),scope 形如:
 *   <tag>:ip:<ip>:<window-tag>
 *   <tag>:user:<userId>:<window-tag>
 *
 * 用 rate_limit 表 UPSERT 计数(better-sqlite3 单写者,原子)。超过 limit
 * 返 429 + { error, scope, limit, window }。
 *
 * IP 解析:优先 X-Forwarded-For(nginx 前置),回落 X-Real-IP,再回落 'unknown'。
 * unknown bucket 全部一起限——故意的,防止 header 缺失绕过(但 jdc nginx
 * 应该总是塞 X-Forwarded-For)。
 *
 * 用法:挂在需要限流的 endpoint 前。需要 user 限时,要放在 requireAuth 后,
 * 这样 c.get('user') 才有值。无 user 时 userLimit 跳过(允许匿名走)。
 */
export type RateWindow = "minute" | "hour" | "day";

export interface RateLimitOptions {
  /** scope 前缀(标识 endpoint),如 'gen' / 'prompt' / 'redeem' */
  tag: string;
  window: RateWindow;
  /** IP 维度限额。undefined = 不限 IP。 */
  ipLimit?: number;
  /** user 维度限额。undefined 或无 user context 时跳过。 */
  userLimit?: number;
}

export function rateLimit(opts: RateLimitOptions) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const windowTag = formatWindowTag(opts.window);

    if (opts.ipLimit !== undefined) {
      const ip = getClientIp(c);
      const scope = `${opts.tag}:ip:${ip}:${windowTag}`;
      const count = incrementAndGet(scope);
      if (count > opts.ipLimit) {
        return c.json(
          {
            error: "rate_limited",
            scope: "ip",
            limit: opts.ipLimit,
            window: opts.window,
            tag: opts.tag,
          },
          429,
        );
      }
    }

    if (opts.userLimit !== undefined) {
      // 优先 c.get('user')(上游 requireAuth 已 populate),无则自己解 cookie
      // —— 允许挂在不强制 auth 的 endpoint 上(如 /prompt/draft 透明代理路径)
      let userId: number | null = c.get("user")?.id ?? null;
      if (userId === null) {
        const token = getCookie(c, SESSION_COOKIE);
        if (token) {
          const sess = findValidSession(token);
          if (sess) userId = sess.userId;
        }
      }
      if (userId !== null) {
        const scope = `${opts.tag}:user:${userId}:${windowTag}`;
        const count = incrementAndGet(scope);
        if (count > opts.userLimit) {
          return c.json(
            {
              error: "rate_limited",
              scope: "user",
              limit: opts.userLimit,
              window: opts.window,
              tag: opts.tag,
            },
            429,
          );
        }
      }
    }

    return next();
  };
}

function getClientIp(c: Context): string {
  const xff = c.req.header("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return c.req.header("x-real-ip")?.trim() || "unknown";
}

function formatWindowTag(window: RateWindow): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  if (window === "day") return `day:${y}${m}${d}`;
  const h = String(now.getUTCHours()).padStart(2, "0");
  if (window === "hour") return `hour:${y}${m}${d}${h}`;
  const min = String(now.getUTCMinutes()).padStart(2, "0");
  return `minute:${y}${m}${d}${h}${min}`;
}
