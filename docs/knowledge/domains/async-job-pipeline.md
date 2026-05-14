# 异步生图任务流水线

替换之前的同步 `POST /api/generate-image` 路径(后端 await 模型,前端 fetch 等)。**浏览器对长 HTTP 连接的 idle 超时**(Safari ~5min)会让"生图实际完成但前端拿不到"——必须异步化。见 [pitfalls/browser-idle-timeout-long-http](../pitfalls/browser-idle-timeout-long-http.md)。

## 架构

```
浏览器
  POST /api/jobs/generate {prompt, rawPrompt?, referenceImage?}
              │
              ▼
        Hono 路由(routes/jobs.ts)
              │ validate + createJob(status=pending)
              │ runGenerationJob(jobId, input).catch(log)  ← fire-and-forget
              │ ← 立即返回 {jobId, status:"pending"}
              ▼
       jobs 表(SQLite)
       ┌────────────────────────────────────┐
       │ id / status / prompt_snapshot /    │
       │ prompt_text / is_raw /             │
       │ generation_id / attempts /         │
       │ error_code / error_message /       │
       │ created_at / started_at /          │
       │ completed_at                       │
       └────────────────────────────────────┘
              ▲
              │ markJobRunning → drive(image driver) → markJobSucceeded/Failed
              │
       runGenerationJob() in domain/generate

浏览器
  ↕ useJobs() polling: GET /api/jobs?status=pending,running every 2s
  diff prev vs next → 消失 = 完成 → GET /api/jobs/:id → onSucceeded/onFailed
  refresh-safe: 启动时 listJobs({status:["pending","running"]}) 重显卡片
```

## 关键文件

| 文件 | 职责 |
| --- | --- |
| [apps/api/src/storage/schema.sql](../../../apps/api/src/storage/schema.sql) | `jobs` 表 DDL + idx_jobs_status / idx_jobs_created_at |
| [apps/api/src/storage/jobs.ts](../../../apps/api/src/storage/jobs.ts) | 仓储:`createJob` / `markJobRunning` / `markJobSucceeded` / `markJobFailed` / `updateJobAttempts` / `listJobs` / `getJob` / `reaperAbandonedJobs` |
| [apps/api/src/domain/generate/index.ts](../../../apps/api/src/domain/generate/index.ts) | `runGenerationJob(jobId, input)` 包装,fire-and-forget,never throws |
| [apps/api/src/server/routes/jobs.ts](../../../apps/api/src/server/routes/jobs.ts) | `POST /jobs/generate`(异步)+ `GET /jobs` + `GET /jobs/:id` |
| [apps/api/src/server/app.ts](../../../apps/api/src/server/app.ts) | 启动时调 `reaperAbandonedJobs()` 把上次未完成的 pending/running 标 failed |
| [apps/web/src/features/jobs/api.ts](../../../apps/web/src/features/jobs/api.ts) | `submitGenerateJob` / `listJobs` / `getJob` 客户端 |
| [apps/web/src/features/jobs/useJobs.ts](../../../apps/web/src/features/jobs/useJobs.ts) | 启动恢复 + 2s polling + 完成回调 + 乐观插入 placeholder |
| [apps/web/src/features/jobs/ActiveJobs.tsx](../../../apps/web/src/features/jobs/ActiveJobs.tsx) | 任务卡片 UI:状态 / elapsed 秒数 / prompt 节选 |

## 核心流程

1. 用户点"生图" / "直接生图" / 字段编辑器底部"生图" → `submitJob()` 调 `POST /api/jobs/generate` → 立即拿 `jobId`
2. 前端乐观插入 placeholder JobRecord 到 `activeJobs`,ActiveJobs 卡片立刻显示
3. 后端 `runGenerationJob`:`markJobRunning` → `generate()` → 成功 `markJobSucceeded(generationId)` / 失败 `markJobFailed(code, message, attempts)`
4. 前端 `useJobs` 每 2s `listJobs({status:["pending","running"]})` → diff prev vs next:
   - 仍在 active → 卡片继续显示
   - 不在 next → 调 `getJob(id)` 拿最终状态 → 触发 `onSucceeded`(Gallery 刷新 + flash success)或 `onFailed`(flash error)
5. **页面刷新**:`useJobs` 启动时 `listJobs({status:["pending","running"]})` → 卡片重新显示;后端没丢任务,继续 polling 到完成

## 重启恢复(reaper)

API 进程重启(HMR / 部署)时,**正在跑的 promise 没人 await**——这些 in-flight 任务会被丢。`reaperAbandonedJobs()` 在 `createApp` 启动时把所有 `status IN ('pending','running')` 的行标记为 `failed` + `error_code='abandoned'`,前端 polling 看到 → 走 onFailed 路径,UI 显示 "abandoned" banner 而不是永远转圈。见 [pitfalls/hmr-restart-aborts-jobs](../pitfalls/hmr-restart-aborts-jobs.md)。

## 旧同步路径

`POST /api/generate-image` 仍保留(`routes/generate.ts`)但前端不再调用——保留作兜底 / 第三方调用接口。

## 关联条目

- [async-jobs-over-sync-http](../decisions/async-jobs-over-sync-http.md) — 为什么异步化
- [reaper-abandoned-jobs](../decisions/reaper-abandoned-jobs.md) — 重启时为什么 reap
- [image-generation](image-generation.md) — `generate()` 函数本身的端到端
- [hmr-restart-aborts-jobs](../pitfalls/hmr-restart-aborts-jobs.md) — reaper 解决的问题
- [browser-idle-timeout-long-http](../pitfalls/browser-idle-timeout-long-http.md) — 异步化的根本驱动
