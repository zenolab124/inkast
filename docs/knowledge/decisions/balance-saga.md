# builtin 生图用 saga 扣减/退款,不用"成功后再扣"

builtin 通道消费平台 provider 额度,必须扣用户余额。扣减方式选 saga(try-debit → 调 driver → catch-credit 补偿),不选事后扣款。

## 背景

builtin 生图流程跨两个不同的原子单元:
1. 余额变动(SQLite 事务,可原子)
2. 生图 driver 调用(异步 HTTP,不可原子)

两者无法放入同一个事务。需要决定错误时的恢复策略。

## 方案对比

| 方案 | 成功路径 | 失败路径 | 优缺点 |
| --- | --- | --- | --- |
| saga:先扣后退 | debit → driver 成功 | debit → driver 失败 → credit 补偿 | 失败有补偿路径;两笔 ledger 可追踪 |
| 事后扣:成功再扣 | driver 成功 → debit | driver 失败 → 不扣 | 简单;但 driver 成功后 debit 失败时余额不扣(平台亏损) |

"成功后再扣"的问题:driver 成功(图已生成)、debit 抛异常(并发导致余额不足)的情况下,用户拿到图但没被扣款——平台悄悄出资。saga 把这个风险转到另一端:debit 成功但 driver 失败时需要 credit 回来,补偿逻辑稍复杂但财务安全。

## 最终选择

**saga 模式**。实现在 `apps/api-public/src/server/routes/gen.ts` 的 `/api/gen/builtin` 路由:

```
debit(user, cost, { type: 'consume:gen', relatedId: taskId })
  ↓ driver 成功
markTaskSuccess(taskId)
  ↓ driver 抛异常
credit(user, cost, { type: 'refund:gen', relatedId: taskId })
markTaskFailed(taskId)
```

ledger 记两种 type:
- `consume:gen`(delta 为负):生图扣款
- `refund:gen`(delta 为正):生图失败退款

`related_id = taskId` 让 ledger 行和 `gen_tasks` 行双向关联,便于对账。响应体里带 `refunded` 字段,前端可提示"已退款"。

## 副作用

debit(SQLite 事务)与 driver(异步 HTTP)之间存在间隔——如果进程在 debit 后、driver 调用前 crash,会留下"已扣款但未出图也未退款"的**孤儿账**。`balance_ledger` 里会有一条 `consume:gen` 行但没有对应的 `refund:gen` 或成功记录。Phase 1 接受这个风险;如果要严格处理,需要引入"预留余额"状态并在 startup 时 reap 孤儿。

## 关联条目

- [public-balance](../domains/public-balance.md) — 余额域全景
- [public-image-gen](../domains/public-image-gen.md) — 生图端到端(包含 saga 流程)
- [ledger-open-string-type](ledger-open-string-type.md) — type 字段为何不枚举
- [topup-plugin-architecture](topup-plugin-architecture.md) — 充值通道架构(与消费形成一对)
