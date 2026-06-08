# 公开版生图(透明代理 + 兜底 + R2)

公开版提供两条生图通道：用户自带凭据的透明代理（passthrough）和后端平台凭据的兜底通道（builtin），图片经 R2 中转或 b64 回退，任务元数据落 `gen_tasks` 表，凭据绝不入库。

## 架构

```
前端 runJob
    │
    ├── IDB 有 enabled image provider?
    │       YES → POST /api/gen/passthrough  { provider:{baseUrl,apiKey,model}, prompt, options }
    │       NO  → POST /api/gen/builtin       { prompt, options }
    │
    ▼
server/routes/gen.ts
    │
    ├─[passthrough]─ requireAuth + rateLimit(ip=30/min)
    │     校验 provider 三件套
    │     createGenTask(channel='passthrough', cost=0)
    │     passthroughGenerate(...)   ← drivers/passthrough-image.ts
    │     uploadOrFallback(...)
    │     markGenTaskSuccess / markGenTaskFailed
    │
    └─[builtin]──── requireAuth + rateLimit(ip=20,user=10/min)
          loadBuiltinConfig() → enabled? 否→503
          快速余额检查(getBalance) → 不足→402
          createGenTask(channel='builtin', cost=N)
          debit(consume:gen)         → 不足→402 + markGenTaskFailed
          passthroughGenerate(...)   ← 同上 driver
          uploadOrFallback(...)
            成功 → markGenTaskSuccess
            失败 → credit(refund:gen) + markGenTaskFailed

uploadOrFallback
    │
    ├── R2 enabled? (bucket+publicBase+creds 全到位)
    │     YES → putImage(retry 0.5/2/8s, CacheControl: immutable 1年)
    │           成功 → { url: R2公开URL, b64: null }
    │           失败 → fallback b64
    └── NO / 上传失败 → { url: null, b64: <原文> }
```

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `apps/api-public/src/server/routes/gen.ts` | 两条 endpoint 路由逻辑、saga 流程、错误映射 |
| `apps/api-public/src/drivers/passthrough-image.ts` | 每次请求 new OpenAI client，AbortSignal 透传，PassthroughError 封装 |
| `apps/api-public/src/drivers/r2.ts` | S3Client 懒加载单例，putImage 4 次 retry（0.5/2/8s），CacheControl immutable |
| `apps/api-public/src/domain/gen/builtin-config.ts` | 读 `PUBLIC_BUILTIN_PROVIDER_*` env，enabled = baseUrl && apiKey |
| `apps/api-public/src/domain/gen/r2-config.ts` | 读 `PUBLIC_R2_*` env，enabled = bucket && publicBase && creds |
| `apps/api-public/src/domain/gen/upload-or-fallback.ts` | R2 启用时上传，失败或未启用降级 b64，不抛错 |
| `apps/api-public/src/storage/gen-tasks.ts` | createGenTask / markGenTaskSuccess / markGenTaskFailed / listGenTasksByUser |

## gen_tasks 表结构

| 字段 | 说明 |
| --- | --- |
| `id` | UUID（随机，不含用户信息） |
| `user_id` | 所属用户 |
| `prompt_json` | `{prompt, options}` 字符串，**provider 凭据绝不写入** |
| `channel` | `'passthrough'` / `'builtin'` |
| `model` | 使用的模型名 |
| `cost` | passthrough=0；builtin=`costPerImage`（默认 1） |
| `status` | `pending` → `success` / `failed` |
| `image_url` | 成功时第一张图的 R2 URL；R2 fallback 时写 `b64:passthrough:N` 标记 |
| `error_code` | 失败时上游 code 或 `internal_error` |

## 核心流程

**透明代理（passthrough）**

1. 校验 `provider.{baseUrl,apiKey,model}` 三件套（缺一返 400）
2. 写 `gen_tasks`（cost=0），凭据不落库
3. 调 `passthroughGenerate`：new OpenAI client（一次性），`response_format: b64_json`，超时 600s，AbortSignal 透传
4. `uploadOrFallback`：R2 上传或 b64 降级
5. 返 `{ok, task_id, model, images, duration_ms}`

**兜底通道（builtin）**

1. `loadBuiltinConfig()`：未配置返 503
2. 快速余额检查（`getBalance`）：不足返 402（UX 友好，避免无谓调用 driver）
3. 写 `gen_tasks`（cost=N，pending）
4. `debit(consume:gen)`：事务原子扣减，并发竞争在此再抓 `InsufficientBalanceError`
5. `passthroughGenerate`：同 passthrough driver（凭据来自 env 而非请求体）
6. 成功 → `markGenTaskSuccess`，返回 `balance_after`
7. 失败 → `credit(refund:gen)` + `markGenTaskFailed`，返 `{refunded, balance_after}`

**saga 孤儿风险**：步骤 4 扣款与步骤 5 调用 driver 之间不是原子，进程崩溃会留下"扣了但未出图"的孤儿任务。Phase 1 接受此风险，后续严格做需引入 reserved balance。

## 关联条目

- [decisions/passthrough-vs-builtin-gen](../decisions/passthrough-vs-builtin-gen.md) — 两通道设计决策
- [decisions/balance-saga](../decisions/balance-saga.md) — 余额 saga 与孤儿问题
- [public-balance](./public-balance.md) — 余额服务细节
- [integrations/cloudflare-r2](../integrations/cloudflare-r2.md) — R2 凭据与 bucket 配置
- [public-prompt-engine](./public-prompt-engine.md) — prompt 部分（本条只管生图）
- [integrations/openai-sdk-images](../integrations/openai-sdk-images.md) — OpenAI SDK 生图兼容细节
- [pitfalls/passthrough-key-in-transit](../pitfalls/passthrough-key-in-transit.md) — 凭据只在请求生命周期内存在
- [pitfalls/balance-saga-orphan](../pitfalls/balance-saga-orphan.md) — saga 孤儿问题
- [public-web](./public-web.md) — 前端如何选通道、如何消费 images 数组
