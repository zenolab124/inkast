# 公开版余额系统 + Ledger 流水

公开版用"次数"作为计量单位，`user_balance` 存当前余额，`balance_ledger` 留不可变流水供对账。

## 架构

```
调用方(gen/prompt routes, topup routes)
        │
        ▼
  balance/service.ts
  ┌────────────────────────────────────────────────────────┐
  │  getBalance(userId)  → SELECT balance WHERE user_id=?  │
  │  credit(userId, n, entry)  → applyDelta(+n)            │
  │  debit(userId, n, entry)   → applyDelta(-n)            │
  │                                                        │
  │  applyDelta(userId, delta, entry):                     │
  │    conn.transaction(() => {                            │
  │      INSERT OR IGNORE user_balance(0)    ← ensure 行   │
  │      SELECT balance                     ← 当前值       │
  │      next = current + delta                            │
  │      if next < 0 → throw InsufficientBalanceError      │
  │      UPDATE user_balance SET balance=next              │
  │      INSERT balance_ledger(type,delta,balance_after,..)│
  │    })()                                                │
  └────────────────────────────────────────────────────────┘
        │
        ▼
  SQLite(inkast-public.sqlite)
  user_balance 表         balance_ledger 表
  user_id PK              id, user_id, type, delta
  balance INTEGER         balance_after(冗余), related_id
```

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `apps/api-public/src/domain/balance/service.ts` | `getBalance` / `credit` / `debit` / `listLedger` + `InsufficientBalanceError` |
| `apps/api-public/src/storage/schema.sql` | `user_balance` / `balance_ledger` 表定义 |

## 核心流程

**applyDelta 事务（所有写操作的核心）**

```
BEGIN
  INSERT OR IGNORE INTO user_balance (user_id, balance, updated_at) VALUES (?, 0, ?)
  -- 确保行存在（首次写自动创建，balance=0）

  SELECT balance FROM user_balance WHERE user_id=?
  -- 读当前值（事务内，better-sqlite3 单写者串行保证隔离）

  next = current + delta
  if next < 0 → throw InsufficientBalanceError(userId, required, available)
  -- 余额不足立即抛，事务自动回滚，ledger 不留无效行

  UPDATE user_balance SET balance=next, updated_at=? WHERE user_id=?
  INSERT INTO balance_ledger (user_id, type, delta, balance_after, reason, related_id, created_at)
COMMIT
```

**并发安全**：better-sqlite3 是单写者同步 API，同进程内不存在并发写冲突。

**type 字段约定**（开放字符串，非枚举）

| type | 来源 | delta |
| --- | --- | --- |
| `topup:invite` | 邀请码兑换 | 正 |
| `topup:ldc` | LDC 支付（Phase 2 占位） | 正 |
| `consume:gen` | builtin 生图扣费 | 负 |
| `refund:gen` | builtin 生图失败退款 | 正 |
| `consume:llm` | builtin LLM 扣费 | 负 |
| `refund:llm` | builtin LLM 失败退款 | 正 |
| `system:grant` | 管理员手动赠送 | 正 |

**balance_after 冗余**：每条 ledger 记录写入后的余额，对账时无需全量回放，直接核对最后一条是否与 `user_balance` 一致。

**related_id**：关联业务主键——邀请码 code、gen_task uuid、ldc 订单号等，支持双向追踪。

**listLedger**：`SELECT ... ORDER BY created_at DESC, id DESC LIMIT ?`，简单分页，Phase 1 够用。

## 表结构速查

```sql
-- 每用户一行，PRIMARY KEY = user_id（不是自增 id）
user_balance: user_id PK, balance INTEGER, updated_at

-- 只增不减（INSERT 流水，不 UPDATE/DELETE）
balance_ledger: id AUTOINCREMENT, user_id, type, delta, balance_after,
                reason, related_id, created_at
                INDEX: (user_id, created_at DESC) / (type, created_at DESC)
```

## 关联条目

- [public-edition-overview](public-edition-overview.md) — 整体架构
- [public-topup](public-topup.md) — `credit(type='topup:invite')` 的调用方
- [domains/public-image-gen](public-edition-overview.md) — `debit/credit` 生图 saga 调用方（见 gen.ts）
- [decisions/balance-saga](../decisions/balance-saga.md) — debit→调driver→失败credit 的 saga 设计决策
- [decisions/ledger-open-string-type](../decisions/ledger-open-string-type.md) — type 字段为何不枚举
- [pitfalls/balance-saga-orphan](../pitfalls/balance-saga-orphan.md) — 进程 crash 在 debit 后 driver 前的孤儿风险
- [integrations/better-sqlite3](../integrations/better-sqlite3.md) — 单写者串行化保证
