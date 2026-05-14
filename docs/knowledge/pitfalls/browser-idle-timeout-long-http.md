# 浏览器对长 HTTP idle 连接的超时

**What**: 同步 `POST /api/generate-image` 请求超过 4-5 分钟时,Safari/Chrome 浏览器层主动断开 fetch,前端报 "Failed to fetch",但后端实际生成成功。用户视角"生图失败",但 Gallery 后续刷新会看到这张图出现——非常困惑。

**Why**: 浏览器对 idle HTTP 连接有内置超时(Safari ~4-5 min, Chrome 略宽)。inkast driver / vite proxy / OpenAI SDK 三层超时都拉到 600s,但**浏览器层不是这条链的一部分**——它有自己的 idle policy,只要 socket 上没数据传输到一定时间就断。生图过程中后端只在最末尾返回数据,中间几分钟 socket 完全静默 → 浏览器 idle disconnect。

**Action**: 改用异步 jobs:`POST /api/jobs/generate` 立即返回 `jobId`(几百毫秒),前端 2s polling `GET /api/jobs?status=pending,running`。socket 长连接被打散成短轮询,彻底绕开 idle 问题。见 [async-jobs-over-sync-http](../decisions/async-jobs-over-sync-http.md)。

**替代方案没选**:keep-alive 心跳 / SSE / WebSocket 都能维持连接,但工程复杂度高过 jobs + polling,且不能解决"刷新页面后想看到任务"的需求。

## 关联条目

- [async-jobs-over-sync-http](../decisions/async-jobs-over-sync-http.md)
- [async-job-pipeline](../domains/async-job-pipeline.md)
- [image-driver-timeout-chain](image-driver-timeout-chain.md) — 后端这三层超时
