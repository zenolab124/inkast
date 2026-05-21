# Plugin 通道走 v2 异步 Callback,不是 v1 同步

snap-ub 接入时,inkast 一开始设计的是**同步 HTTP**:`POST /plugins/v1/images/generations` 挂着等 30-360s 返 b64。第一次实测 + snap-ub 工程现状一对比,立即切到**异步 callback**。

## 背景

同步路径下:
- snap-ub uniCloud **云函数硬超时 60s**——根本无法挂着等 inkast 完成生图
- snap-ub 为绕这个 60s,**在 jdc 跑了一个 Node worker 当长连接代理(~1500 行)** —— 复杂度都在客户端
- inkast 实测端到端耗时 150-240s,**单次成功的 best case 也超过 snap-ub worker 配的 180s timeout**(实测有 533s 完成的案例,worker 已标 timeout 但 inkast 仍 callback 成功 → 两侧状态不一致)

## 方案对比

| | v1 同步 | v2 异步 callback |
|---|---|---|
| 协议 | POST 一次,挂连接等 30-360s 返 b64 | POST submit → 立返 task_id → inkast 后台跑完 POST callback_url |
| 客户端复杂度 | **高**(需要长连接代理处理 60s timeout) | **低**(submit + 注册 callback handler) |
| snap-ub 那 1500 行 worker | **必须**(为绕 60s) | **删掉**(uniCloud 云函数 5 分钟 ok) |
| inkast 复杂度 | 低(handler 同步出图返结果) | **高**(plugin_tasks 表 + queue + retry + GC + recovery) |
| 状态保留 | 无(handler 返完就完了) | 24h(callback 丢失 → 走 status 兜底) |
| 任务超长 | 客户端 timeout 错误,但 inkast 内部仍跑 → 状态不一致 | inkast 完成后 callback,客户端无 timeout 概念 |
| 失败重试 | 客户端自己 retry(可能重复消耗) | inkast 内部 callback 5s/30s/5min × 3 |

## 最终选择

**v2 异步 callback**。理由:

1. **uniCloud 60s 超时是硬约束**,任何同步路径都绕不开
2. **复杂度从客户端转移到服务端是对的**——客户端可能是 serverless 受限环境,服务端是 long-running daemon
3. **snap-ub 删 1500 行 worker** —— 一次性还清架构债
4. **状态保留 24h + status 兜底**让两侧最终一致性可达

## 实现要点

- `POST /plugins/v1/images/submit` → 立返 200 + `task_id`(handler ≤100ms,**不调 LLM/image**)
- 后台 worker(in-memory queue + concurrency cap=2):跑 LLM(可选)+ image + JPEG transcode → markTaskSucceeded
- callback delivery:**setTimeout 调度的 in-memory retry**,5s / 30s / 5min × 3 次,4 次失败 → `callback_lost`
- `GET /plugins/v1/images/status/:id`:兜底接口,callback 丢失时调用方主动拉
- task 状态保留 24h,GC 自动清

## 关键 trade-offs(写入代码注释 + 文档)

- **inkast 内部无任务级 deadline** —— 上游极端慢(实测 533s)inkast 仍出图,但 snap-ub 那侧 180s 已 timeout,造成两侧不一致。**当前接受,改善留作 TODO**(plugin-async 加 6 分钟硬 timeout)
- **重启不续 callback retry** —— in-memory setTimeout 丢失;但 task 状态在 SQLite,调用方走 status 兜底拿结果
- **callback URL per-task,不在 plugin 配置里** —— dev/prod URL 不同时,只在 submit body 切换,inkast 不需要重新部署

## 关联条目

- [plugin-channel](../domains/plugin-channel.md) — v2 协议的实现承载
- [async-jobs-over-sync-http](async-jobs-over-sync-http.md) — Web UI 通道也走异步(同源思路,不同协议)
- [plugin-task-no-deadline](../pitfalls/plugin-task-no-deadline.md) — 当前实现的一个 gap
- [callback-token-plaintext-roundtrip](../pitfalls/callback-token-plaintext-roundtrip.md)
