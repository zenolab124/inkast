import { credit } from "../../domain/balance/service.js";
import { findByCode, tryClaim } from "./repository.js";

export type RedeemErrorCode =
  | "not_found"
  | "already_used"
  | "expired"
  | "race_lost";

export class RedeemError extends Error {
  constructor(public readonly code: RedeemErrorCode, message?: string) {
    super(message ?? code);
    this.name = "RedeemError";
  }
}

export interface RedeemResult {
  amount: number;
  balanceAfter: number;
}

/**
 * 用户用 code 兑换次数。流程:
 *   1. 查 code,确认存在 / 未用 / 未过期
 *   2. tryClaim 原子标记(防并发)——失败说明同 code 同瞬间被另一请求抢先
 *   3. 调核心 credit 加余额,type='topup:invite' 留痕
 *
 * 第 2 步成功后第 3 步理论上不会失败(credit 只校验 amount > 0),但万一
 * credit 抛了——invite_codes 已经标记 used 而余额没加,这是脏数据。Phase 1
 * 接受这种极小概率风险;真要严格,把 tryClaim + credit 包进一个 better-sqlite3
 * 事务里(都是同库,可以的)。后续要做时再补。
 */
export function redeem(userId: number, code: string): RedeemResult {
  const row = findByCode(code);
  if (!row) throw new RedeemError("not_found");
  if (row.used_at !== null) throw new RedeemError("already_used");
  if (row.expires_at !== null && row.expires_at < Date.now()) {
    throw new RedeemError("expired");
  }

  if (!tryClaim(code, userId)) {
    throw new RedeemError("race_lost", `code ${code} claimed by another request`);
  }

  const { balanceAfter } = credit(userId, row.amount, {
    type: "topup:invite",
    reason: "邀请码兑换",
    relatedId: code,
  });

  return { amount: row.amount, balanceAfter };
}
