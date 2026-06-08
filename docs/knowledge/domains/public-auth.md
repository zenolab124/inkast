# 公开版 Linux.do OAuth 登录 + Session

公开版通过 Linux.do Connect（Discourse OAuth2）完成身份验证，Session 以 httpOnly Cookie 携带。

## 架构

```
浏览器                          api-public                  connect.linux.do
  │                                │                               │
  ├─GET /api/auth/linuxdo/authorize─┤                               │
  │                                │ randomBytes(16) → state       │
  │                                │ randomBytes(32) → verifier    │
  │                                │ SHA256(verifier) → challenge  │
  │                                │ storeState(state, verifier, redirect_to) TTL 10min
  │◄─302 redirect─────────────────-│                               │
  │                                                                 │
  ├─GET /oauth2/authorize?...───────────────────────────────────────┤
  │◄─302 ?code=...&state=...────────────────────────────────────────┤
  │                                                                 │
  ├─GET /api/auth/linuxdo/callback─┤                               │
  │                                │ consumeState(state) → 取 verifier,立即 DELETE
  │                                ├─POST /oauth2/token ───────────┤
  │                                │◄── { access_token } ──────────┤
  │                                ├─GET /api/user ────────────────┤
  │                                │◄── { id, username, ... } ─────┤
  │                                │ upsertUser(linux_do_id, ...)
  │                                │ createSession(user.id) → 32字节 hex token, 30天
  │◄─302 + Set-Cookie inkast_public_session (httpOnly)─────────────│
```

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `apps/api-public/src/server/routes/auth.ts` | 4 个 endpoint 实现 |
| `apps/api-public/src/domain/auth/oauth-config.ts` | `loadLinuxDoOAuthConfig()`：从 env 读取 OAuth 配置，首次调用后缓存 |
| `apps/api-public/src/domain/auth/oauth-state-store.ts` | `storeState` / `consumeState` / `reapExpiredStates`，TTL 10分钟 |
| `apps/api-public/src/server/middleware/auth.ts` | `requireAuth` middleware，`c.get('user')` |
| `apps/api-public/src/storage/sessions.ts` | `createSession` / `findValidSession` / `deleteSession` / `reapExpiredSessions` |
| `apps/api-public/src/storage/users.ts` | `upsertUser`（不动 status）/ `findUserById` |

## 核心流程

**authorize**
- `randomBytes(16).hex()` → `state`（CSRF 防护）
- `randomBytes(32)` base64url → `code_verifier`（PKCE）
- `SHA256(code_verifier)` base64url → `code_challenge`（S256 方法）
- `storeState(state, codeVerifier, redirect_to)` 写 `oauth_states` 表，TTL 10分钟
- 302 跳 `connect.linux.do/oauth2/authorize?...`

**callback**
1. `consumeState(state)` — 查 + DELETE（不管命中与否都删，防重放）
2. `POST /oauth2/token` code + verifier → `access_token`
3. `GET /api/user` Bearer token → userinfo（`id`/`username`/`avatar_template`/`trust_level`）
4. `upsertUser`：新用户 INSERT，老用户 UPDATE username/avatar/trust_level，不动 `status`
5. `createSession(user.id)` → 32字节 hex token，默认 30天
6. `setCookie` `inkast_public_session`，httpOnly，production 时 secure，SameSite=Lax

**requireAuth middleware**
- 优先读 cookie → `findValidSession` → `findUserById` → `c.set('user', user)`
- `PUBLIC_API_DEV_AUTH=1` 时额外支持 `X-Dev-User-Id` header（**生产严禁打开**）

**Endpoint 速查**

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/auth/linuxdo/authorize` | 发起 OAuth，支持 `?redirect_to=` 参数 |
| GET | `/api/auth/linuxdo/callback` | 接收 code，建 session，写 cookie |
| POST | `/api/auth/logout` | 删 session，清 cookie |
| GET | `/api/auth/me` | 返 `{ user, balance }`，未登录返 `{ user: null, balance: 0 }` |

**启动时 reaper**：`createApp()` 调 `reapExpiredSessions()` + `reapExpiredStates()`，清掉过期行，防止表无限增长。

**env 依赖**

| 变量 | 必填 | 默认/说明 |
| --- | --- | --- |
| `PUBLIC_LINUXDO_CLIENT_ID` | 是 | Linux.do 应用 ID |
| `PUBLIC_LINUXDO_CLIENT_SECRET` | 是 | Linux.do 应用 Secret |
| `PUBLIC_LINUXDO_CALLBACK_URL` | 否 | 默认 `http://localhost:5174/api/auth/linuxdo/callback` |
| `PUBLIC_API_DEV_AUTH` | 否 | `=1` 开启 dev 后门，**生产严禁** |

## 关联条目

- [public-edition-overview](public-edition-overview.md) — 整体架构
- [public-balance](public-balance.md) — `/auth/me` 返回余额调用 `getBalance`
- [public-rate-limit](#) — auth 外无限流，gen/prompt/redeem 有（待补）
- [integrations/better-sqlite3](../integrations/better-sqlite3.md) — sessions/users 底层存储
