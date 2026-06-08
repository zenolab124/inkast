# 公开版整体架构

公开版是 inkast 面向多用户的共享平台形态，独立进程、独立数据库，与主线（本地优先 BYOK 单用户自部署）并行运行。

## 架构

**主线 vs 公开版对比**

| 维度 | 主线 | 公开版 |
| --- | --- | --- |
| 用户模型 | 单用户，无登录 | 多用户，Linux.do OAuth |
| 数据库 | `inkast.sqlite` | `inkast-public.sqlite` |
| 图片存储 | 本地 `data/images/` | 浏览器 IndexedDB（+ R2 可选） |
| Provider 凭据 | 用户自填 → 后端 SQLite | 用户自填 → 浏览器 IndexedDB（passthrough）或平台凭据（builtin） |
| 端口 | 8787 | 8788（`PUBLIC_API_PORT`） |
| LLM | ClaudeCode SDK 或 OpenAI 兼容 | 用户自带 LLM 凭据（passthrough）或平台 builtin LLM |
| 余额系统 | 无 | 有（次数制，`user_balance` + `balance_ledger`） |
| 前端包 | `apps/web` | `apps/web-public`（从主线 fork + 增加 AuthHeader） |

**数据流全景**

```
浏览器
 │
 ├─[OAuth] ──→ GET /api/auth/linuxdo/authorize
 │              └─ 生成 state(CSRF) + code_verifier(PKCE)
 │              └─ 跳 connect.linux.do
 │              └─ callback → upsertUser → createSession
 │              └─ setCookie inkast_public_session (httpOnly, 30天)
 │
 ├─[本地配置/历史] ←→ IndexedDB (idb-keyval, 4个独立 DB)
 │   providers / jobs / generations / images
 │
 ├─[生图 · passthrough(用户 key)] ──→ POST /api/gen/passthrough
 │   provider: { baseUrl, apiKey, model } + prompt
 │   后端透传 → 上游 OpenAI 兼容接口
 │   cost=0,不扣 inkast 余额
 │   返回 b64 / R2 url → 存浏览器 IndexedDB
 │
 └─[生图 · builtin(平台 key)] ──→ POST /api/gen/builtin
     必须登录 + 余额 ≥ cost
     debit(consume:gen) → 调平台 provider → 失败 credit(refund:gen)
     返回 b64 / R2 url → 存浏览器 IndexedDB
```

## 8 张表一句话汇总

| 表 | 职责 |
| --- | --- |
| `users` | Linux.do 身份（upsert，login 不改 status） |
| `user_balance` | 每用户一行余额（单位"次"） |
| `balance_ledger` | 所有余额变动流水（可对账） |
| `sessions` | OAuth 登录 session，32字节 hex token，30天 TTL |
| `oauth_states` | authorize→callback CSRF state + PKCE verifier，10分钟 TTL |
| `gen_tasks` | 生图任务元数据（凭据不进库，图存浏览器） |
| `rate_limit` | 固定窗口计数 KV（ip/user 两维度，minute/hour/day） |
| `invite_codes` | 邀请码（topup 插件表，见 topup 目录） |

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `apps/api-public/src/index.ts` | 进程入口，`PUBLIC_API_PORT`/`PUBLIC_API_HOST` env |
| `apps/api-public/src/server/app.ts` | `createApp()`：初始化 DB、reaper、路由、topup 外挂 |
| `apps/api-public/src/storage/schema.sql` | 核心 7 张表（不含 topup 通道表） |
| `apps/api-public/src/storage/db.ts` | better-sqlite3 单例 + WAL + `applyExtraSchema()` |
| `apps/web-public/src/main.tsx` | 前端入口，LanguageProvider 包裹 App |
| `apps/web-public/src/App.tsx` | 主 App：tab(draft/gallery)、AuthHeader、三栏布局（与主线同构） |
| `apps/web-public/src/lib/idb.ts` | 4个独立 IndexedDB store（providers/jobs/generations/images） |
| `package.json` (根) | `public:dev` / `public:build` scripts 驱动两个子包 |

## 核心流程

**启动**：`createApp()` → `db()`（apply 核心 schema）→ `reapExpiredSessions` + `reapExpiredStates` → 挂 authRoutes / genRoutes / promptRoutes → `registerInviteCodeTopup(app)`（apply 自己的 schema + 挂 routes）。

**开发**：`pnpm public:dev` 同时启动 `api-public`（tsx watch, port 8788）和 `web-public`（Vite, port 5174）。

**构建**：`pnpm public:build` 先 build `@inkast/shared`，再并行 build 两包。

## 关联条目

- [public-auth](public-auth.md) — Linux.do OAuth 登录 + Session
- [public-balance](public-balance.md) — 余额系统 + Ledger 流水
- [public-topup](public-topup.md) — 充值外挂架构 + 邀请码
- [public-idb-storage](#) — 浏览器 IndexedDB 持久化（待补）
- [decisions/public-edition-separate-app](../decisions/public-edition-separate-app.md) — 为何独立进程/DB 而非主线扩展
- [decisions/json-overlay-vs-branch](../decisions/json-overlay-vs-branch.md) — 客户特化走 JSON overlay 而非 git fork
- [integrations/better-sqlite3](../integrations/better-sqlite3.md) — SQLite 单例用法
