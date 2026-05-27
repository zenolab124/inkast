import { db } from "../../storage/db.js";

export interface LedgerEntry {
  /** 开放字符串,topup / consume 通道自己约定。例:'topup:invite' / 'consume:gen'。 */
  type: string;
  reason?: string;
  relatedId?: string;
}

export interface BalanceMutation {
  balanceAfter: number;
  ledgerId: number;
}

export class InsufficientBalanceError extends Error {
  constructor(
    public readonly userId: number,
    public readonly required: number,
    public readonly available: number,
  ) {
    super(`user ${userId} insufficient balance: need ${required}, have ${available}`);
    this.name = "InsufficientBalanceError";
  }
}

/**
 * 当前余额(单位"次")。用户从未发生过余额变动时返回 0(无 user_balance 行)。
 */
export function getBalance(userId: number): number {
  const row = db()
    .prepare(`SELECT balance FROM user_balance WHERE user_id=?`)
    .get(userId) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

/**
 * 加余额。amount 必须为正数。事务内 ensure user_balance 行 + UPDATE balance +
 * INSERT ledger 一气呵成,SQLite 单写者保证三步原子。
 *
 * 调用方约定 type 字段(如 'topup:invite' / 'topup:ldc' / 'refund:gen' /
 * 'system:grant'),核心不枚举。
 */
export function credit(
  userId: number,
  amount: number,
  entry: LedgerEntry,
): BalanceMutation {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error(`credit amount must be a positive integer, got ${amount}`);
  }
  return applyDelta(userId, amount, entry);
}

/**
 * 扣余额。amount 正数。余额不足抛 InsufficientBalanceError——事务自动回滚,
 * ledger 不留无效行。
 */
export function debit(
  userId: number,
  amount: number,
  entry: LedgerEntry,
): BalanceMutation {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error(`debit amount must be a positive integer, got ${amount}`);
  }
  return applyDelta(userId, -amount, entry);
}

function applyDelta(userId: number, delta: number, entry: LedgerEntry): BalanceMutation {
  const conn = db();
  const now = Date.now();

  return conn.transaction((): BalanceMutation => {
    conn
      .prepare(
        `INSERT OR IGNORE INTO user_balance (user_id, balance, updated_at) VALUES (?, 0, ?)`,
      )
      .run(userId, now);

    const current = conn
      .prepare(`SELECT balance FROM user_balance WHERE user_id=?`)
      .get(userId) as { balance: number };

    const next = current.balance + delta;
    if (next < 0) {
      throw new InsufficientBalanceError(userId, -delta, current.balance);
    }

    conn
      .prepare(`UPDATE user_balance SET balance=?, updated_at=? WHERE user_id=?`)
      .run(next, now, userId);

    const ledgerResult = conn
      .prepare(
        `INSERT INTO balance_ledger
           (user_id, type, delta, balance_after, reason, related_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(userId, entry.type, delta, next, entry.reason ?? null, entry.relatedId ?? null, now);

    return { balanceAfter: next, ledgerId: Number(ledgerResult.lastInsertRowid) };
  })();
}

export interface LedgerRow {
  id: number;
  user_id: number;
  type: string;
  delta: number;
  balance_after: number;
  reason: string | null;
  related_id: string | null;
  created_at: number;
}

/**
 * 列出用户最近 N 条流水(分页用 created_at + id 双键 cursor 更稳,Phase 1 简单分页)。
 */
export function listLedger(userId: number, limit = 50): LedgerRow[] {
  return db()
    .prepare(
      `SELECT * FROM balance_ledger WHERE user_id=? ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .all(userId, limit) as LedgerRow[];
}
