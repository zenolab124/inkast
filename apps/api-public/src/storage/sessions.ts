import { randomBytes } from "node:crypto";
import { db } from "./db.js";

const SESSION_BYTES = 32;
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface SessionInfo {
  userId: number;
  expiresAt: number;
}

export function createSession(userId: number, ttlMs = DEFAULT_TTL_MS): {
  token: string;
  expiresAt: number;
} {
  const token = randomBytes(SESSION_BYTES).toString("hex");
  const now = Date.now();
  const expiresAt = now + ttlMs;
  db().prepare(
    `INSERT INTO sessions (token, user_id, created_at, expires_at, last_seen)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(token, userId, now, expiresAt, now);
  return { token, expiresAt };
}

export function findValidSession(token: string): SessionInfo | null {
  const now = Date.now();
  const row = db().prepare(
    `SELECT user_id, expires_at FROM sessions WHERE token=? AND expires_at>?`,
  ).get(token, now) as { user_id: number; expires_at: number } | undefined;
  if (!row) return null;
  db().prepare(`UPDATE sessions SET last_seen=? WHERE token=?`).run(now, token);
  return { userId: row.user_id, expiresAt: row.expires_at };
}

export function deleteSession(token: string): void {
  db().prepare(`DELETE FROM sessions WHERE token=?`).run(token);
}

export function reapExpiredSessions(): number {
  return db().prepare(`DELETE FROM sessions WHERE expires_at<?`).run(Date.now()).changes;
}
