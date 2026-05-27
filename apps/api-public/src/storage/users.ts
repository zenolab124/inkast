import { db } from "./db.js";

export interface UserRow {
  id: number;
  linux_do_id: string;
  username: string;
  avatar_url: string | null;
  trust_level: number | null;
  status: "active" | "banned";
  created_at: number;
  updated_at: number;
}

export interface UpsertUserInput {
  linuxDoId: string;
  username: string;
  avatarUrl?: string | null;
  trustLevel?: number | null;
}

/**
 * 按 linux_do_id upsert。新用户首次登录创建行;老用户更新 username / avatar /
 * trust_level(论坛侧可能变),返回最终行。
 * 不动 status——封禁是带外操作,登录链路无权限把 banned 改回 active。
 */
export function upsertUser(input: UpsertUserInput): UserRow {
  const now = Date.now();
  const conn = db();
  const existing = conn
    .prepare(`SELECT * FROM users WHERE linux_do_id = ?`)
    .get(input.linuxDoId) as UserRow | undefined;

  if (existing) {
    conn.prepare(
      `UPDATE users SET username=?, avatar_url=?, trust_level=?, updated_at=? WHERE id=?`,
    ).run(
      input.username,
      input.avatarUrl ?? null,
      input.trustLevel ?? null,
      now,
      existing.id,
    );
    return conn.prepare(`SELECT * FROM users WHERE id=?`).get(existing.id) as UserRow;
  }

  const result = conn.prepare(
    `INSERT INTO users (linux_do_id, username, avatar_url, trust_level, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?)`,
  ).run(
    input.linuxDoId,
    input.username,
    input.avatarUrl ?? null,
    input.trustLevel ?? null,
    now,
    now,
  );

  return conn
    .prepare(`SELECT * FROM users WHERE id=?`)
    .get(result.lastInsertRowid) as UserRow;
}

export function findUserById(id: number): UserRow | null {
  const row = db().prepare(`SELECT * FROM users WHERE id=?`).get(id) as UserRow | undefined;
  return row ?? null;
}
