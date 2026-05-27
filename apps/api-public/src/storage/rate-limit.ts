import { db } from "./db.js";

/**
 * 限流计数。scope 自包含 window-tag(如 'ip:1.2.3.4:min:202605271730'),
 * 同一 scope 同一窗口共享一行。limit 由调用方根据 scope 类型决定。
 *
 * 实现:UPSERT 计数,返回累加后的值。调用方比较 limit 决定是否拒绝。
 * 过期窗口(window_start < now - retention)由后台 reaper 定期清理,
 * 这里不做同步清理。
 *
 * Phase 1 简单方案,够用;高并发再改 Redis。
 */
export function incrementAndGet(scope: string): number {
  const now = Date.now();
  const conn = db();
  const result = conn.prepare(
    `INSERT INTO rate_limit (scope, count, window_start) VALUES (?, 1, ?)
     ON CONFLICT(scope) DO UPDATE SET count = count + 1
     RETURNING count`,
  ).get(scope, now) as { count: number };
  return result.count;
}

/**
 * 删除过期窗口(window_start < cutoff)。startup 时和定时 reaper 用。
 * 返回删除行数。
 */
export function reapExpired(cutoffMs: number): number {
  const result = db().prepare(`DELETE FROM rate_limit WHERE window_start < ?`).run(cutoffMs);
  return result.changes;
}
