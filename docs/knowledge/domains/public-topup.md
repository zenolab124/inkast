# 公开版充值外挂架构 + 邀请码

充值通道以"外挂"插件化接入，每条通道自包含表/仓储/服务/路由，核心业务零感知，`createApp` 一行挂载。

## 架构

```
apps/api-public/src/topups/
├── invite-code/          ← 首个充值通道（已上线）
│   ├── index.ts          ← register 函数（applyExtraSchema + app.route）
│   ├── schema.sql        ← invite_codes 表（独立，通过外键引用 users）
│   ├── repository.ts     ← findByCode / createInviteCode / tryClaim
│   ├── service.ts        ← redeem()：校验 + 原子 claim + credit
│   └── routes.ts         ← POST /api/topups/invite/redeem
└── (ldc/)                ← Phase 2 占位，未实现

apps/api-public/src/server/app.ts
  createApp():
    ...
    registerInviteCodeTopup(app)   ← 核心 createApp 唯一感知点
    // Phase 2: registerLdcTopup(app)  ← 追加一行，其它不变
```

**外挂接入协议**：每个充值通道实现 `register<Name>Topup(app: Hono): void`，内部做两件事：
1. `applyExtraSchema(schemaPath)` — 将自己的 `schema.sql` apply 到核心 DB（同一连接）
2. `app.route("/api", xyzRoutes)` — 挂自己的 routes

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `apps/api-public/src/topups/invite-code/index.ts` | `registerInviteCodeTopup`：schema apply + routes 挂载 |
| `apps/api-public/src/topups/invite-code/schema.sql` | `invite_codes` 表 + 未使用码索引 |
| `apps/api-public/src/topups/invite-code/repository.ts` | `findByCode` / `createInviteCode` / `tryClaim` |
| `apps/api-public/src/topups/invite-code/service.ts` | `redeem(userId, code)` 完整兑换逻辑 |
| `apps/api-public/src/topups/invite-code/routes.ts` | `POST /api/topups/invite/redeem`（requireAuth + rateLimit） |
| `apps/api-public/src/server/app.ts` | `registerInviteCodeTopup(app)` 调用处 |

## 核心流程

**redeem 完整流程**

```
POST /api/topups/invite/redeem  { code: "xxx" }
  │
  ├─ requireAuth           → 必须登录，c.get('user')
  ├─ rateLimit(hour)       → IP ≤20次/小时，user ≤10次/小时（防暴力试码）
  │
  ├─ findByCode(code)
  │   not found → 404 RedeemError("not_found")
  │
  ├─ row.used_at !== null → 409 RedeemError("already_used")
  ├─ row.expires_at < now → 409 RedeemError("expired")   （NULL=永不过期）
  │
  ├─ tryClaim(code, userId)
  │   UPDATE invite_codes SET used_by=?, used_at=? WHERE code=? AND used_at IS NULL
  │   changes === 0 → 409 RedeemError("race_lost")   ← 防并发兑换同一码
  │
  └─ credit(userId, row.amount, { type: 'topup:invite', relatedId: code })
      → { balanceAfter }
      → 200 { ok: true, amount, balance_after }
```

**并发安全**：`tryClaim` 通过 `WHERE used_at IS NULL` 的条件 UPDATE + 检查 `changes` 实现乐观锁，同一码并发兑换只有一个请求的 `changes=1`，其余得到 `race_lost`。

**已知风险**（Phase 1 接受）：`tryClaim` 成功后 `credit` 理论上不会失败，但若进程在两步之间 crash，会留下"标记已用但余额未加"的孤儿 invite_code。严格做法是把两步包进同一 `conn.transaction()`（同库可以），Phase 2 补。

**invite_codes 表结构**

```sql
invite_codes:
  code        TEXT PK          -- 兑换码
  amount      INTEGER          -- 兑换得到的次数
  used_by     INTEGER REF users -- NULL=未用
  used_at     INTEGER          -- NULL=未用，epoch ms
  expires_at  INTEGER          -- NULL=永不过期
  created_by  TEXT             -- 'admin' / 'system' / 'campaign:xxx'
  created_at  INTEGER
INDEX idx_invite_unused ON invite_codes(used_at) WHERE used_at IS NULL
```

**LDC 通道（Phase 2 占位）**：按同样外挂协议实现 `registerLdcTopup(app)`，`createApp` 追加一行即可，不改核心逻辑。详见 [decisions/ldc-deferred-invite-first](../decisions/ldc-deferred-invite-first.md)。

## 关联条目

- [public-balance](public-balance.md) — `credit` 调用方，`topup:invite` type
- [public-edition-overview](public-edition-overview.md) — 整体架构，`createApp` 挂载点
- [public-auth](public-auth.md) — `requireAuth` middleware
- [decisions/topup-plugin-architecture](../decisions/topup-plugin-architecture.md) — 外挂插件化设计决策
- [decisions/ldc-deferred-invite-first](../decisions/ldc-deferred-invite-first.md) — LDC 推迟，邀请码先行
- [workflows/add-topup-channel](../workflows/add-topup-channel.md) — 新增充值通道 step-by-step
