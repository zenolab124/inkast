# API 启动时 reap 残留 jobs

API 进程启动时,把所有 `status IN ('pending', 'running')` 的 jobs 行**标记为 failed**,避免前端永远转圈等已经丢失的任务。

## 背景

异步 jobs(见 [async-jobs-over-sync-http](async-jobs-over-sync-http.md))把生图任务从同步 HTTP 拆成"提交 → 后台 fire-and-forget"。但 fire-and-forget 的 promise **只活在当前进程**:
- HMR 重启(`tsx watch` 检测代码变化)
- 部署 / 重启
- 进程崩溃

任何上述情况发生时,jobs 表里残留 `status=running` 的行 —— 但执行那行任务的 promise 已经死了。前端 polling 看到它仍 running,显示卡片永远转圈,用户以为还在跑,实际无人处理。

## 方案对比

| | 不 reap | 启动时 reap(选定) | 心跳机制 |
| --- | --- | --- | --- |
| UI 表现 | 永远转圈 | 立即 failed banner | 偶尔失活 |
| 实现复杂度 | 0 | 极低(一条 UPDATE) | 中(后台 worker + 阈值) |
| 误标率 | 0 | 0(进程重启 = 确认丢) | 可能误标真在跑的 |

## 最终选择

启动时一次性 reap。

```sql
UPDATE jobs
SET status = 'failed',
    error_code = 'abandoned',
    error_message = 'API process restarted before this job completed',
    completed_at = <now>
WHERE status IN ('pending', 'running');
```

`createApp()` 在路由注册前调用 `reaperAbandonedJobs()`,日志输出 `[startup] reaped N abandoned job(s) from previous run`。

## 副作用

- 前端 polling 看到这些 failed jobs → 触发 `onFailed` 回调 → Banner 显示 "abandoned" 错误,用户知道任务挂了
- **不影响 generations 表**:已经成功的 generation 仍然在,只是它对应的 job(如果还有) 不重要——成功 job 在标 succeeded 时就 completed
- **重启期间正在跑的 driver 调用**:如果模型实际生成完成但还没回到 inkast 后端就重启了,服务端图片不会落盘,失去了。这是 fire-and-forget 模式的固有代价
- Phase 2 可考虑 **持久化 abort + 心跳机制**(每 10s 更新 jobs.heartbeat_at,启动时只 reap 超过 1min 没心跳的)

## 关联条目

- [async-job-pipeline](../domains/async-job-pipeline.md)
- [async-jobs-over-sync-http](async-jobs-over-sync-http.md)
- [hmr-restart-aborts-jobs](../pitfalls/hmr-restart-aborts-jobs.md)
- [tsx-watch-syntax-kill](../pitfalls/tsx-watch-syntax-kill.md) — tsx watch 重启的另一面
