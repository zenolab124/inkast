# 充值通道插件化:核心只暴露 credit(),通道在 topups/ 下独立实现

公开版余额系统将充值通道设计成外挂式插件——核心余额只暴露 `credit()` 接口,每种充值方式在 `topups/<name>/` 下独立实现自己的 schema、路由和业务逻辑,通过 `createApp` 里一行 `register*()` 挂载。

## 背景

充值方式天然多样(邀请码、Linux.do Credit、未来可能的支付宝/微信),且上线节奏不同:邀请码可以 1 小时做完,LDC 集成需要 2-3 周。如何组织代码,使得不同节奏的充值通道互不干扰、核心余额域零改动?

## 方案对比

| 维度 | 插件化(选) | 枚举在核心 |
| --- | --- | --- |
| 新增通道改动范围 | 只加 `topups/<name>/` + `createApp` 一行 | 改核心余额逻辑 + schema |
| 故障隔离 | 通道故障不影响其它通道和核心 | 一处 bug 影响全部 |
| 代码边界 | 通道间彼此不知,只通过 `credit()` 通信 | 余额服务知道所有通道细节 |
| schema 隔离 | 通道自管 `schema.sql`,不侵入核心表 | 核心表越来越宽 |

## 最终选择

**插件化**。每个充值通道包含 5 个文件(以 invite-code 为例):

```
apps/api-public/src/topups/invite-code/
  index.ts      registerInviteCodeTopup(app: Hono) — 入口
  schema.sql    CREATE TABLE invite_codes (...)
  repository.ts DB 读写
  routes.ts     /api/invite-code/redeem 等 HTTP 路由
  service.ts    业务逻辑(code 校验 + credit 调用)
```

`index.ts` 是唯一对外契约:调用 `applyExtraSchema(schemaPath)` 挂自己的表,再 `app.route("/api", ...)` 挂路由。

`apps/api-public/src/server/app.ts` 里的挂载方式:

```ts
// Phase 2 新增 LDC 时,只加这一行,其它代码不动:
// registerLdcTopup(app);
registerInviteCodeTopup(app);
```

通道内部通过 `credit(userId, amount, { type: 'topup:invite' })` 写余额,type 字段使用约定字符串(见 [ledger-open-string-type](ledger-open-string-type.md))。各通道彼此不 import,核心余额域不 import 任何通道。

## 关联条目

- [public-balance](../domains/public-balance.md) — 余额域全景
- [ledger-open-string-type](ledger-open-string-type.md) — type 字段开放字符串设计
- [ldc-deferred-invite-first](ldc-deferred-invite-first.md) — 为什么 Phase 1 只做邀请码
- [balance-saga](balance-saga.md) — 消费侧对称设计
