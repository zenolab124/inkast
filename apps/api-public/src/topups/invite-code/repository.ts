import { db } from "../../storage/db.js";

export interface InviteCodeRow {
  code: string;
  amount: number;
  used_by: number | null;
  used_at: number | null;
  expires_at: number | null;
  created_at: number;
  created_by: string | null;
}

export function findByCode(code: string): InviteCodeRow | null {
  const row = db().prepare(`SELECT * FROM invite_codes WHERE code=?`).get(code) as
    | InviteCodeRow
    | undefined;
  return row ?? null;
}

export interface CreateInviteCodeInput {
  code: string;
  amount: number;
  expiresAt?: number | null;
  createdBy?: string;
}

export function createInviteCode(input: CreateInviteCodeInput): void {
  db().prepare(
    `INSERT INTO invite_codes (code, amount, expires_at, created_at, created_by)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    input.code,
    input.amount,
    input.expiresAt ?? null,
    Date.now(),
    input.createdBy ?? null,
  );
}

/**
 * 原子标记 code 已被 userId 使用。只有 used_at IS NULL 才会更新——通过
 * affected rows 是否为 1 判断是否抢占成功(防止并发兑换同一码)。
 */
export function tryClaim(code: string, userId: number): boolean {
  const now = Date.now();
  const result = db().prepare(
    `UPDATE invite_codes SET used_by=?, used_at=? WHERE code=? AND used_at IS NULL`,
  ).run(userId, now, code);
  return result.changes === 1;
}
