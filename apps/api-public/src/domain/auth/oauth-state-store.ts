import { db } from "../../storage/db.js";

const STATE_TTL_MS = 10 * 60 * 1000;

/**
 * 寄存 authorize 重定向中产生的 CSRF state + PKCE code_verifier + 可选
 * post-login 重定向目标。callback 时 consume(state) 取回并删除——单次使用。
 */
export function storeState(
  state: string,
  codeVerifier: string,
  redirectTo: string | null,
): void {
  const now = Date.now();
  db().prepare(
    `INSERT INTO oauth_states (state, code_verifier, redirect_to, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(state, codeVerifier, redirectTo, now, now + STATE_TTL_MS);
}

export function consumeState(state: string): {
  codeVerifier: string;
  redirectTo: string | null;
} | null {
  const row = db().prepare(
    `SELECT code_verifier, redirect_to, expires_at FROM oauth_states WHERE state=?`,
  ).get(state) as
    | { code_verifier: string; redirect_to: string | null; expires_at: number }
    | undefined;

  // 不管命中与否都 DELETE,防同一 state 被重复试。
  db().prepare(`DELETE FROM oauth_states WHERE state=?`).run(state);

  if (!row || row.expires_at < Date.now()) return null;
  return { codeVerifier: row.code_verifier, redirectTo: row.redirect_to };
}

export function reapExpiredStates(): number {
  return db().prepare(`DELETE FROM oauth_states WHERE expires_at<?`).run(Date.now()).changes;
}
