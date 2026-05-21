# Plugin Channel(plugin 通道)

inkast 把生图能力以 **token 鉴权 + v2 异步 callback 协议** 暴露给外部接入方(snap-ub 等)的通道。**与 Web UI 通道完全隔离** —— 共享 LLM driver + image provider 池,其它代码路径全部独立。

**v2.1(2026-05-22 起)**:plugin overlay 加 `imageStorage` 字段,二选一——`b64`(默认,v2 老协议)或 `r2`(inkast 直接 PUT R2,callback 改返 `image_url`)。callback / `/status/:id` 双协议兼容。详见 [[r2-direct-upload-v2.1]]。

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
        │     ③ 按 plugin.imageStorage.kind 分两条路:                      │
        │        b64(默认):transcodeToJpeg(sharp 转 JPEG q80,可 resize) │
        │                   → markTaskSucceeded(kind:b64, b64Json, mime)   │
        │        r2:        prepareImageForR2(可选 resize,保 PNG)         │
        │                   → putImage(R2,3 次指数退避 0.5/2/8s)         │
        │                   → markTaskSucceeded(kind:r2, imageUrl, mime)   │
        │   失败 → markTaskFailed + toOpenAiError mapper                   │
        │   R2 失败 → error_code='r2_upload_failed',不回退 b64             │
        │   → deliverCallback(attempt=0)                                   │
        └──────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
        ┌──────────────────────────────────────────────────────────────────┐
        │ Callback delivery(setTimeout 调度,in-memory)                   │
        │   POST callback_url + X-Callback-Token + body                    │
        │     body schema 按 task.imageUrl/b64Json 二选一:                 │
        │       r2 路径: { task_id, status, image_url, mime, ... }         │
        │       b64 路径:{ task_id, status, b64_json, mime, ... }(v2 老) │
        │   返非 2xx → 退避重试 5s / 30s / 5min × 3                        │
        │   4 次都失败 → markCallbackLost(status='callback_lost')          │
        │   调用方走 GET /plugins/v1/images/status/:id 兜底取结果          │
        │     (双协议兼容:image_url 优先,b64_json 兜底)                  │
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
| `apps/api/src/drivers/storage/r2.ts` | **R2 PutObject driver**(`@aws-sdk/client-s3`,3 次退避 + R2UploadError/R2ConfigError) |

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
| 落盘 | 是(`<dataDir>/images/YYYY/MM/`) | **二选一**:b64 留 24h(`plugin_tasks.b64_json`)/ R2 直传(`plugin_tasks.image_url`,bytes 在 R2 上) |
| 调用方 | 浏览器,长连接 polling | uniCloud 云函数,异步 callback |
| Prompt 引擎 | `draftPrompt`(走 LLM) | 二选一(skipLlmExpansion 开关) |
| JPEG transcode | 否 | b64 路径是(JPEG q80 缩 payload);**r2 路径保 PNG**(不再需要缩 payload) |
| 鉴权 | 无(本机) | Bearer Token |

两条路径共享 [provider-pool](provider-pool.md) 和 [prompt-engine](prompt-engine.md) 的 driver 入口,其它独立。

## 关联条目

- [admin-dashboard](admin-dashboard.md) — 看 plugin 通道运行状态的 HTML dashboard
- [plugin-overlay-loader](../shared/plugin-overlay-loader.md) — JSON overlay 加载机制
- [v2-async-callback-protocol](../decisions/v2-async-callback-protocol.md) — 为何走异步而不是同步
- [plugin-channel-isolation](../decisions/plugin-channel-isolation.md) — 为何不复用 Web UI 通道代码
- [json-overlay-vs-branch](../decisions/json-overlay-vs-branch.md) — 客户特化为何走 JSON overlay
- [new-plugin-onboarding](../workflows/new-plugin-onboarding.md) — 给新客户接入的 step-by-step
- [r2-direct-upload-v2.1](../decisions/r2-direct-upload-v2.1.md) — v2.1 R2 直传决策
- [per-capability-retry-budget](../decisions/per-capability-retry-budget.md) — provider retry 可在 Web UI 单独配
- [cloudflare-r2](../integrations/cloudflare-r2.md) — R2 driver + bucket 约定
- [callback-token-plaintext-roundtrip](../pitfalls/callback-token-plaintext-roundtrip.md)
- [plugin-task-no-deadline](../pitfalls/plugin-task-no-deadline.md)
- [plugin-pool-too-narrow-by-model](../pitfalls/plugin-pool-too-narrow-by-model.md)
- [snapub-overlay-jdc-only](../pitfalls/snapub-overlay-jdc-only.md)
