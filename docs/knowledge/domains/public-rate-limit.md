# 公开版限流

固定窗口计数中间件，IP 和 user 双维度限流，基于 SQLite UPSERT 原子操作，挂载在 gen/prompt/topup 等敏感 endpoint 前。

## 架构

```
Hono middleware: rateLimit({ tag, window, ipLimit?, userLimit? })
    │
    ├── [IP 维度] 解析客户端 IP
    │     X-Forwarded-For → X-Real-IP → 'unknown'（兜底共桶）
    │     scope = "<tag>:ip:<ip>:<windowTag>"
    │     incrementAndGet(scope)  →  count > ipLimit → 429
    │
    └── [user 维度]
          先取 c.get('user')（上游 requireAuth 已注入）
          无则自解 cookie → findValidSession → userId
          无 user → 跳过（允许匿名）
          scope = "<tag>:user:<userId>:<windowTag>"
          incrementAndGet(scope)  →  count > userLimit → 429

storage/rate-limit.ts · incrementAndGet(scope)
    │
    └── INSERT INTO rate_limit (scope, count, window_start) VALUES (?,1,?)
        ON CONFLICT(scope) DO UPDATE SET count = count + 1
        RETURNING count
        （better-sqlite3 单写者，语句级原子）

formatWindowTag(window: 'minute'|'hour'|'day')
    └── UTC YYYYMMDD[HH[MM]]  e.g. "minute:202606091437"
```

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `apps/api-public/src/server/middleware/rate-limit.ts` | `rateLimit` factory，IP 解析，user 懒解析，429 格式 |
| `apps/api-public/src/storage/rate-limit.ts` | `incrementAndGet` UPSERT，`reapExpired` GC（未挂定时器） |
| `apps/api-public/src/storage/schema.sql` | `rate_limit` 表：scope PK，count，window_start |

## rate_limit 表

```sql
CREATE TABLE IF NOT EXISTS rate_limit (
  scope        TEXT PRIMARY KEY,   -- e.g. "gen_pt:ip:1.2.3.4:minute:202606091437"
  count        INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL   -- epoch ms，用于 GC
);
```

## 各 endpoint 限流配置

| endpoint | tag | window | IP 限 | user 限 | 备注 |
| --- | --- | --- | --- | --- | --- |
| `POST /api/gen/passthrough` | `gen_pt` | minute | 30 | — | 用户自己 key，IP 足够 |
| `POST /api/gen/builtin` | `gen_bi` | minute | 20 | 10 | 花平台 provider 钱，严点 |
| `POST /api/prompt/draft` | `prompt` | minute | 30 | 30 | 透明代理路径无 user，仅 IP 限 |
| `POST /api/topups/invite/redeem` | `redeem`（推测） | hour | 20 | 10 | 防暴力试码 |

## 429 响应格式

```json
{
  "error": "rate_limited",
  "scope": "ip",          // "ip" 或 "user"
  "limit": 30,
  "window": "minute",
  "tag": "gen_pt"
}
```

无 `Retry-After` header（Phase 1 未实现）。

## 设计要点

**unknown IP 共桶**：header 缺失时 IP 取 `'unknown'`，所有无法识别来源的请求共享同一个计数桶，防止攻击者故意去掉转发头绕过 IP 限流。jdc nginx 实际上总会注入 `X-Forwarded-For`。

**透明代理路径不强制 auth**：`/api/prompt/draft` 不挂 `requireAuth`，中间件里的 user 维度通过自解 cookie 获取 userId，无 session 时 userLimit 跳过。这让匿名用户（使用透明代理）和已登录用户（builtin）都能走同一 endpoint。

**builtin user 限额在 requireAuth 之后**：`/api/gen/builtin` 先挂 `requireAuth` 再挂 `rateLimit`，所以 `c.get('user')` 一定有值，不需要懒解析 cookie。

## 已知问题 / 坑

**reapExpired 未挂定时器**：`storage/rate-limit.ts` 有 `reapExpired(cutoffMs)` 函数但代码注释"startup 时和定时 reaper 用"，实际上未在任何地方调用（`index.ts` / `app.ts` 均无挂载）。长时间运行后 `rate_limit` 表会持续膨胀，不影响正确性，但会占用磁盘空间并拖慢 UPSERT。Phase 1 SQLite 单实例流量低，够用；高并发再改 Redis（代码注释已说明）。

## 关联条目

- [public-auth](./public-auth.md) — session/requireAuth 中间件
- [public-image-gen](./public-image-gen.md) — gen endpoint 限流点
- [public-topup](./public-topup.md) — redeem endpoint 限流点
- [public-edition-overview](./public-edition-overview.md) — 公开版整体架构
- [integrations/better-sqlite3](../integrations/better-sqlite3.md) — SQLite 单写者语义
