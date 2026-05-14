# 异步 jobs 取代同步 HTTP

把"生图 = 同步 HTTP 等响应"改成"提交 job → fire-and-forget → 前端 polling"。

## 背景

`POST /api/generate-image` 同步路径 await 上游模型 60s-5min。问题:
- **浏览器对长 HTTP idle 连接的容忍度有限**——Safari ~4-5 分钟没数据就主动断,前端 fetch 报 "Failed to fetch",但后端实际生成成功(从 [image-driver-timeout-chain](../pitfalls/image-driver-timeout-chain.md) 也能看到 inkast 把 driver/proxy 都拉到 600s,浏览器层 idle timeout 是新的薄弱环节)
- 用户**刷新页面就丢任务可见性**——后端 promise 仍在跑但前端失去了观察接口
- 不支持**多任务并发**——单 fetch 一次一个

## 方案对比

| | 同步 HTTP | 异步 jobs(选定) |
| --- | --- | --- |
| 长连接 idle | 致命 | 不存在长连接 |
| 多任务并发 | 困难 | 自然支持 |
| 刷新可见性 | 丢 | 从 SQLite 恢复 |
| 后端重启 | 任务静默丢 | reaper 标 failed,前端可见 |
| 实现复杂度 | 低 | 中(加表 + 轮询) |
| 取消能力 | AbortController 可取消 | 暂未做(需后端 in-process registry) |

## 最终选择

异步 jobs。

新增:
- SQLite `jobs` 表(id / status / prompt_snapshot / prompt_text / is_raw / generation_id / attempts / error_code / error_message / created_at / started_at / completed_at)
- `runGenerationJob(jobId, input)` 包装 `generate()`,never throws,自动 markRunning / markSucceeded / markFailed
- `POST /api/jobs/generate`:创建 job → fire-and-forget → 立即返回 `{jobId, status}`
- `GET /api/jobs?status=&since=&limit=` + `GET /api/jobs/:id`
- 前端 `useJobs()` hook:启动 fetch active jobs + 2s polling + diff 完成回调
- `<ActiveJobs jobs={activeJobs}>` 卡片显示在 Composer 和 Editor 之间

旧路径保留:`POST /api/generate-image` 同步仍在 routes/generate.ts 里,前端不再调用,留作兜底。

## 副作用

- **重启 reaper 必须做**:进程重启时 in-process promise 丢,如果不 reap pending/running 会变"僵尸任务",前端永远转圈。见 [reaper-abandoned-jobs](reaper-abandoned-jobs.md)
- **乐观 UI**:submitJob 立即插入 placeholder JobRecord 到 activeJobs,polling 拿到真实数据后替换
- **取消能力暂缺**:用户想中断只能等失败或重启 API。Phase 2 可加 `DELETE /api/jobs/:id` + 内存 AbortController registry
- **历史 prompt 仍存 generations 表**,jobs 表只保留任务元数据(为 generation_id FK 关联)

## 关联条目

- [async-job-pipeline](../domains/async-job-pipeline.md) — 实现
- [browser-idle-timeout-long-http](../pitfalls/browser-idle-timeout-long-http.md) — 触发动因
- [reaper-abandoned-jobs](reaper-abandoned-jobs.md) — 重启时的兜底
- [hmr-restart-aborts-jobs](../pitfalls/hmr-restart-aborts-jobs.md) — reaper 解决的具体场景
