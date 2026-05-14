# HMR 重启会 abort 正在跑的 jobs

**What**: `tsx watch` 检测 API 代码改动重启 Node 进程时,所有 in-flight 的 fire-and-forget generation jobs 都会丢——promise 死在内存里,前端 polling 仍看到这些 job `status=running`,UI 卡片永远转圈。

**Why**: 异步 jobs 用 fire-and-forget(`runGenerationJob(jobId, input).catch(log)` 不 await)。这个 promise 只活在当前进程,进程死了 promise 跟着死。jobs 表里 `status` 不会自动改 —— 数据库不知道执行者已经走了。

**Action**: API 启动时调用 `reaperAbandonedJobs()` 一次性把所有 `status IN ('pending','running')` 的行标记为 `failed + error_code='abandoned'`。前端 polling 看到 → 触发 onFailed 回调 → Banner 显示 "API process restarted before this job completed"。代码在 `apps/api/src/server/app.ts` createApp 启动时,日志 `[startup] reaped N abandoned job(s)`。详见 [reaper-abandoned-jobs](../decisions/reaper-abandoned-jobs.md)。

**副作用**:模型如果真的完成生图但响应回 API 时进程已经重启,图本身没保存(domain/generate writeFile 那一步在 runGenerationJob 里跑),用户得重生。这是 fire-and-forget 模式的固有代价。

## 关联条目

- [async-job-pipeline](../domains/async-job-pipeline.md)
- [reaper-abandoned-jobs](../decisions/reaper-abandoned-jobs.md)
- [tsx-watch-syntax-kill](tsx-watch-syntax-kill.md) — tsx watch 的另一面
