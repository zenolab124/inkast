# balance-saga-orphan — saga 非原子留孤儿账

builtin 生图通道在 `debit` 成功后、`passthroughGenerate` 返回前若进程 crash，ledger 里会留下 `consume:gen` 孤儿条目（扣了次数但没出图），且无对应 `refund:gen` 补偿。`invite-code` 充值通道存在同类问题。

## What

`/api/gen/builtin` 的 saga 步骤：

```
debit(consume:gen)  ←── SQLite 事务，已 COMMIT
        ↓
passthroughGenerate ←── 异步 HTTP，可能花 30-600s
        ↓
credit(refund:gen)  ←── 仅在 catch 分支执行
```

如果进程在第二步执行中途被 kill（OOM、部署重启、服务器断电），第三步的退款 `credit` 永远不会执行。结果：`balance_ledger` 里有 `consume:gen` 条目，`user_balance` 已被扣减，但用户没有收到图。

`invite-code` redeem 的同类问题：`tryClaim`（标记 invite_code 已用，独立事务）成功后，若 `credit` 抛错，邀请码已消耗但余额没增加。

## Why

`debit`/`tryClaim` 是 SQLite 事务（同步，立即 COMMIT），`passthroughGenerate`/`credit` 是随后的独立操作。两者之间不存在分布式两阶段锁或 WAL redo log——这是经典的 saga 模式：把一个跨步骤的"原子"操作拆成多个本地事务 + 补偿，中间断点就留孤儿。

单进程 SQLite 不存在并发写竞争，但进程生命周期与 HTTP 请求异步之间的时间窗口无法消除。

## Action

**Phase 1 接受现状**，原因：

- 进程 crash 概率极低（正常运行中断极少）
- 出图耗时普遍 < 120s，restart 窗口小
- 孤儿账可离线对账：
  ```sql
  -- 找有 consume:gen 但缺对应 refund:gen 或 task success 的孤儿
  SELECT l.related_id, l.user_id, l.delta, l.created_at
  FROM balance_ledger l
  WHERE l.type = 'consume:gen'
    AND NOT EXISTS (
      SELECT 1 FROM balance_ledger r
      WHERE r.type IN ('refund:gen')
        AND r.related_id = l.related_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM gen_tasks t
      WHERE t.id = l.related_id AND t.status = 'success'
    );
  ```
  发现孤儿后手动 `system:grant` 补偿即可

**Phase 2 严格做法**：引入 reserved balance（预留 → 确认/回滚二阶段）：

```
reserveBalance(n)  → status='reserved'
passthroughGenerate
成功 → confirmReserved(n)
失败 → releaseReserved(n)
```

better-sqlite3 单写者特性使得同库跨步骤的两阶段实现相对简单，届时 `invite-code` 的 `tryClaim + credit` 也可包进同一事务。

**必读文件**：`apps/api-public/src/server/routes/gen.ts`（saga 注释段）· `apps/api-public/src/domain/balance/service.ts` · `apps/api-public/src/topups/invite-code/service.ts`

---

关联条目：[domains/public-balance](../domains/public-balance.md) · [domains/public-image-gen](../domains/public-image-gen.md)
