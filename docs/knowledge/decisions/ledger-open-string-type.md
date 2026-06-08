# balance_ledger.type 用开放字符串,不用 enum

`balance_ledger` 表的 `type` 字段定义为 `TEXT NOT NULL`,约定字符串格式(`topup:invite` / `consume:gen` / `refund:gen` / `system:grant`),核心余额域不枚举所有可能值。

## 背景

流水类型需要支持:现有的 `topup:invite`、`consume:gen`、`refund:gen`,以及未来的 `topup:ldc`、`topup:wechat` 等。每新增一个充值通道,都会带来新的 type 值。如何定义 type,使得新通道上线不需要修改 schema?

## 方案对比

| 维度 | 开放字符串(选) | SQLite CHECK 约束 / 应用层 enum |
| --- | --- | --- |
| 新增通道 | 通道自己约定 type 字符串,核心零改 | 需 ALTER TABLE 或改 enum 定义 |
| 编译期约束 | 无,靠约定 | 有(TypeScript enum / zod union) |
| 对账/查询 | `WHERE type LIKE 'topup:%'` 仍可按前缀过滤 | 同 |
| schema migration | 无 | 每次加通道需要迁移 |

## 最终选择

**开放字符串**。`balance_ledger` schema:

```sql
type TEXT NOT NULL,  -- 'topup:invite'/'consume:gen'/'refund:gen'/'system:grant'...
                     -- 核心不枚举,topup 通道自己定
```

TypeScript 层 `LedgerEntry.type` 也是 `string`(见 `apps/api-public/src/domain/balance/service.ts`),不是 union 类型。

约定的命名规范:`<动作>:<来源>`。当前已用:
- `topup:invite` — 邀请码充值
- `consume:gen` — builtin 生图扣款
- `refund:gen` — builtin 生图失败退款
- `system:grant` — 系统赠送(运营用)

新通道约定好自己的前缀即可,不需要在核心代码里注册。

## 副作用

- 字符串打错不会编译报错,需要靠 review + 测试发现
- 查"所有充值类型"需要约定 `topup:` 前缀过滤,不能枚举穷举
- 这是刻意选择的权衡:扩展性 > 编译期完备性

## 关联条目

- [public-balance](../domains/public-balance.md) — 余额域全景
- [topup-plugin-architecture](topup-plugin-architecture.md) — 开放 type 的使用方(充值通道插件化)
- [balance-saga](balance-saga.md) — consume/refund type 的使用场景
