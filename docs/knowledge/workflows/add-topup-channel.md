# add-topup-channel — 新增一种充值通道

在公开版 `apps/api-public` 里增加一个新的充值入口（如 LDC 支付、礼品卡、管理员手动充值等）。以 `invite-code` 通道为模板，核心余额代码零改动。

## 设计原则

充值通道是"外挂"到核心 app 的插件：

- 每个通道有自己的 SQLite 表（通过 `applyExtraSchema` 在启动时注入）
- 每个通道有自己的 routes（挂到 `/api` 下）
- 核心 `createApp()` 只追加一行 `registerXxxTopup(app)`，不修改其他代码
- 通道通过调用核心 `credit()` 注入余额，不直接写 `user_balance` 表

---

## 步骤

### 1. 创建通道目录

```bash
mkdir apps/api-public/src/topups/<channel>/
```

以 `invite-code` 为例，目录结构如下（完整模板在 `apps/api-public/src/topups/invite-code/`）：

```
topups/<channel>/
  schema.sql       # 通道自己的表（REFERENCES users 即可）
  repository.ts    # 数据访问层
  service.ts       # 业务逻辑（校验 + 调用核心 credit）
  routes.ts        # Hono endpoint（requireAuth + rateLimit）
  index.ts         # register 函数 = applyExtraSchema + app.route
```

### 2. 编写 schema.sql

```sql
-- <channel> topup 通道独立 schema
CREATE TABLE IF NOT EXISTS <channel>_codes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  -- 通道专属字段...
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  used_at     INTEGER,
  created_at  INTEGER NOT NULL
);
```

规则：
- 表名加 `_` 通道前缀，避免与核心表冲突
- 通过 `REFERENCES users(id)` 与用户表关联
- `idempotent`（`CREATE TABLE IF NOT EXISTS`），启动时可反复 apply

### 3. 编写 repository.ts

数据访问层，封装 SQL 查询。参考 `invite-code/repository.ts`：

```ts
import { db } from "../../storage/db.js";

export function findById(id: number) { ... }
export function markUsed(id: number, userId: number): boolean { ... }
```

并发安全：better-sqlite3 是单写者同步 API，`changes === 1` 判断是否抢占成功（见 `tryClaim` 模式）。

### 4. 编写 service.ts

业务逻辑层：校验、调用 `credit()`。

```ts
import { credit } from "../../domain/balance/service.js";

export function redeemXxx(userId: number, ...): RedeemResult {
  // 1. 校验（查 DB、判状态、防重复）
  // 2. 标记已用（原子 UPDATE WHERE 未用）
  // 3. 调核心 credit，type 约定 'topup:<channel>'
  const { balanceAfter } = credit(userId, amount, {
    type: "topup:<channel>",
    reason: "...",
    relatedId: ...,
  });
  return { amount, balanceAfter };
}
```

`type` 字段是开放字符串，`balance_ledger` 无枚举约束，通道自由约定（见 `decisions/ledger-open-string-type`）。

**注意**：`tryClaim`（标记已用）与 `credit` 目前是两个独立事务——极小概率下前者成功后者失败会留脏数据。如需严格，把两者包进同一 `db().transaction()` 里（better-sqlite3 单库单写者，同一进程可以）。

### 5. 编写 routes.ts

Hono endpoint，必须 `requireAuth` + `rateLimit` 防刷：

```ts
import { Hono } from "hono";
import { requireAuth } from "../../server/middleware/auth.js";
import { rateLimit } from "../../server/middleware/rate-limit.js";
import { RedeemError, redeemXxx } from "./service.js";

export const xxxRoutes = new Hono();

xxxRoutes.post(
  "/topups/<channel>/redeem",
  requireAuth,
  rateLimit({ tag: "redeem_<ch>", window: "hour", ipLimit: 20, userLimit: 10 }),
  async c => {
    const body = await c.req.json().catch(() => null);
    const user = c.get("user");
    // ...
    const result = redeemXxx(user.id, ...);
    return c.json({ ok: true, amount: result.amount, balance_after: result.balanceAfter });
  }
);
```

### 6. 编写 index.ts（register 函数）

```ts
import type { Hono } from "hono";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { applyExtraSchema } from "../../storage/db.js";
import { xxxRoutes } from "./routes.js";

export function registerXxxTopup(app: Hono): void {
  const schemaPath = join(dirname(fileURLToPath(import.meta.url)), "schema.sql");
  applyExtraSchema(schemaPath);
  app.route("/api", xxxRoutes);
}
```

### 7. 在 app.ts 挂载

在 `apps/api-public/src/server/app.ts` 的"充值通道"区块追加一行：

```ts
import { registerXxxTopup } from "../topups/<channel>/index.js";

// 在 createApp() 末尾：
registerXxxTopup(app);
```

**核心 createApp 其他代码不变**。

---

## 验证

```bash
# 本地 dev
pnpm public:api:dev

# 测试 endpoint
curl -X POST http://localhost:8788/api/topups/<channel>/redeem \
  -H 'Content-Type: application/json' \
  -H 'Cookie: inkast_public_session=<token>' \
  -d '{"code": "TEST123"}'
```

检查 `balance_ledger`：

```sql
SELECT * FROM balance_ledger WHERE user_id=? ORDER BY created_at DESC LIMIT 5;
```

---

## 参考文件

- `apps/api-public/src/topups/invite-code/` — 完整实现模板
- `apps/api-public/src/domain/balance/service.ts` — `credit()` 函数签名
- `apps/api-public/src/storage/db.ts` — `applyExtraSchema()` 实现
- `apps/api-public/src/server/app.ts` — `createApp()` 挂载点

---

关联条目：[domains/public-balance](../domains/public-balance.md) · [domains/public-edition-overview](../domains/public-edition-overview.md) · [pitfalls/balance-saga-orphan](../pitfalls/balance-saga-orphan.md)
