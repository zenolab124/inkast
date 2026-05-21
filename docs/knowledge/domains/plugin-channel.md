# Plugin Channel(plugin 通道)

inkast 把生图能力以 **token 鉴权 + v2 异步 callback 协议** 暴露给外部接入方(snap-ub 等)的通道。**与 Web UI 通道完全隔离** —— 共享 LLM driver + image provider 池,其它代码路径全部独立。

## 架构

```
                                          ┌─ /admin/plugin-stats (loopback only HTML dashboard)
                                          │
nginx /inkast/ → 127.0.0.1:8787 ───┬──────┴───────────────────────────────────────────
                                   │
                                   ▼
        ┌──────────────────────────────────────────────────────────────────┐
        │ POST /plugins/v1/images/submit                                   │
        │   ├─ pluginAuth middleware: Bearer Token → plugin id             │
        │   ├─ 参数校验(prompt 2-2000 / callback_url / callback_token)   │
        │   ├─ createPluginTask → plugin_tasks 表(queued)                 │
        │   └─ enqueueTask → in-memory FIFO → 立即返 200 + task_id (≤100ms)│
        └──────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
        ┌──────────────────────────────────────────────────────────────────┐
        │ Worker(in-memory queue,MAX_CONCURRENT=2)                       │
        │   markTaskRunning →                                              │
        │     ① skipLlmExpansion?                                          │
        │       是 → buildSkipLlmPromptText(user prompt + 约束块)           │
        │       否 → draftPrompt(LLM 散文→JSON)+ enforceFields 浅合并     │
        │     ② generateImage(走 image provider 池)                       │
        │     ③ transcodeToJpeg(sharp,可选 cover-fit 到 outputDimensions) │
        │     ④ markTaskSucceeded(b64Json + mime + providerId/Name)       │
        │   失败 → markTaskFailed + toOpenAiError mapper                   │
        │   → deliverCallback(attempt=0)                                   │
        └──────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
        ┌──────────────────────────────────────────────────────────────────┐
        │ Callback delivery(setTimeout 调度,in-memory)                   │
        │   POST callback_url + X-Callback-Token + body                    │
        │   返非 2xx → 退避重试 5s / 30s / 5min × 3                        │
        │   4 次都失败 → markCallbackLost(status='callback_lost')          │
        │   调用方走 GET /plugins/v1/images/status/:id 兜底取结果          │
        └──────────────────────────────────────────────────────────────────┘
```

## 关键文件

| 文件 | 职责 |
|---|---|
| `apps/api/src/server/routes/plugins.ts` | submit + status 两个 endpoint + 参数校验 |
| `apps/api/src/server/middleware/plugin-auth.ts` | Bearer Token 中间件,挂 plugin 到 `c.var.plugin` |
| `apps/api/src/domain/plugin-async/index.ts` | 整个 worker + queue + callback + transcode + recovery + GC,**单文件 ~420 行** |
| `apps/api/src/storage/plugin-tasks.ts` | SQLite CRUD + reaperInflightPluginTasks + gcOldPluginTasks |
| `apps/api/src/storage/plugin-stats.ts` | dashboard 用的 aggregate 查询 |
| `apps/api/src/plugins/types.ts` | `InkastPlugin` 接口契约 |
| `apps/api/src/plugins/registry.ts` | 启动时从 `INKAST_PLUGIN_DIR` 加载 JSON + env 加载 token |
| `apps/api/src/plugins/loader.ts` | JSON + zod 校验 |
| `apps/api/src/plugins/errors.ts` | `ImageGenError` / `LlmDriverError` → OpenAI 风格错误体 mapper |

## 生命周期

```
queued → running → succeeded ─┐ → callback POST →┬─ 200: 终态
                              │                   ├─ retry → 4 attempts → callback_lost(图仍可拉)
                              │
              → failed ───────┴── 同上(callback body 含 error_code) → 终态(或 callback_lost)
```

终态 task 24h 后由 GC 删除(`gcOldPluginTasks`,setInterval 每小时 + startup 一次)。

## 重启恢复

systemd 重启时 `initPluginAsync` → `reaperInflightPluginTasks`:扫 `status IN (queued, running)` 的 task,全部标 `failed` + `error_code='interrupted'`,然后**立即对每个发 callback**。调用方无需 polling 等。

## 与 Web UI 通道的边界

| | Web UI 通道 | Plugin 通道 |
|---|---|---|
| 路由 | `/api/*` | `/plugins/v1/*` |
| 表 | `jobs` + `generations` | `plugin_tasks`(独立) |
| 落盘 | 是(`<dataDir>/images/YYYY/MM/`) | **否**(b64 留 24h 后 GC) |
| 调用方 | 浏览器,长连接 polling | uniCloud 云函数,异步 callback |
| Prompt 引擎 | `draftPrompt`(走 LLM) | 二选一(skipLlmExpansion 开关) |
| JPEG transcode | 否 | 是(默认 JPEG q80,可选 resize) |
| 鉴权 | 无(本机) | Bearer Token |

两条路径共享 [provider-pool](provider-pool.md) 和 [prompt-engine](prompt-engine.md) 的 driver 入口,其它独立。

## 关联条目

- [admin-dashboard](admin-dashboard.md) — 看 plugin 通道运行状态的 HTML dashboard
- [plugin-overlay-loader](../shared/plugin-overlay-loader.md) — JSON overlay 加载机制
- [v2-async-callback-protocol](../decisions/v2-async-callback-protocol.md) — 为何走异步而不是同步
- [plugin-channel-isolation](../decisions/plugin-channel-isolation.md) — 为何不复用 Web UI 通道代码
- [json-overlay-vs-branch](../decisions/json-overlay-vs-branch.md) — 客户特化为何走 JSON overlay
- [new-plugin-onboarding](../workflows/new-plugin-onboarding.md) — 给新客户接入的 step-by-step
- [callback-token-plaintext-roundtrip](../pitfalls/callback-token-plaintext-roundtrip.md)
- [plugin-task-no-deadline](../pitfalls/plugin-task-no-deadline.md)
