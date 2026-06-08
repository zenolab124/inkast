# Linux.do Connect OAuth

公开版用户登录走 Linux.do Connect(基于 Discourse 的 OAuth2 provider),是目前唯一的身份验证通道。

## 选型与集成方式

Linux.do 是国内开发者社区,提供 Discourse Connect 兼容的 OAuth2 服务(`connect.linux.do`)。选它是因为公开版定位就面向国内开发者群体,且 Linux.do 账号质量相对可控(trust_level 分级体系)。

集成为标准 OAuth2 Authorization Code 流程,额外强制 **PKCE S256**:
1. 后端生成 `state`(CSRF 令牌)+ `code_verifier`(随机 32 字节 base64url),派生 `code_challenge = SHA256(verifier)` base64url
2. 重定向到 `authorizeUrl?code_challenge=...&code_challenge_method=S256`
3. 用户授权后 callback 带 `code` + `state`;后端消费 state(一次性,防重放),用 `code` + `code_verifier` 换 access_token
4. 用 access_token 调 `userinfoUrl` 拉用户信息,`upsertUser` 写 DB,`createSession` 发 `httpOnly` cookie

实现入口:
- 配置:`apps/api-public/src/domain/auth/oauth-config.ts`
- 路由:`apps/api-public/src/server/routes/auth.ts`(3 个 endpoint)

## 使用方式

### Endpoint

| endpoint | 作用 |
| --- | --- |
| `GET /api/auth/linuxdo/authorize` | 发起登录,重定向到 Linux.do |
| `GET /api/auth/linuxdo/callback` | 接收授权码,完成登录,设 session cookie |
| `POST /api/auth/logout` | 销毁 session,清 cookie |
| `GET /api/auth/me` | 当前用户信息 + 余额(无 session 返 `user: null`) |

### 配置 env

| env | 默认值 | 说明 |
| --- | --- | --- |
| `PUBLIC_LINUXDO_CLIENT_ID` | 无,必须 | OAuth app client id |
| `PUBLIC_LINUXDO_CLIENT_SECRET` | 无,必须 | OAuth app client secret |
| `PUBLIC_LINUXDO_AUTHORIZE_URL` | `https://connect.linux.do/oauth2/authorize` | 可 env 覆盖 |
| `PUBLIC_LINUXDO_TOKEN_URL` | `https://connect.linux.do/oauth2/token` | 可 env 覆盖 |
| `PUBLIC_LINUXDO_USERINFO_URL` | `https://connect.linux.do/api/user` | 可 env 覆盖 |
| `PUBLIC_LINUXDO_CALLBACK_URL` | `http://localhost:5174/api/auth/linuxdo/callback` | 每 app 仅允许一个,见限制 |

### 凭据注入方式

- **本地 dev**:`apps/api-public/scripts/dev.sh` 从 macOS Keychain 拉取注入 env:
  ```
  security add-generic-password -s api-linuxdo-public-client-id -a inkast -U -w <value>
  security add-generic-password -s api-linuxdo-public-client-secret -a inkast -U -w <value>
  ```
- **生产(jdc)**:systemd `EnvironmentFile` 直接写 env,secret 不进代码不进 git

### 用户字段映射

Discourse 风格 userinfo payload → inkast 用户表:

| userinfo 字段 | 优先顺序 | 备注 |
| --- | --- | --- |
| `id` / `sub` | id 优先 | Linux.do 数值 id |
| `username` / `name` | username 优先 | 显示名 |
| `avatar_template` | Discourse 格式,含 `{size}` 占位 | 拼 `?size=120` 到 `https://linux.do` 得完整 URL |
| `trust_level` | 仅存库展示 | 目前不用于权限控制 |

## 限制与注意

- **confidential app**:client_id + client_secret 均须向 linux.do 申请,可能需要人工审核
- **每个 OAuth app 只允许一个 callback URL**:dev 和 prod 不能同一 app 并存。本地 dev 用 `PUBLIC_API_DEV_AUTH=1` 环境变量启用后门绕过登录鉴权,不需要真跑 OAuth 流程
- **state 一次性消费**:`oauth-state-store.ts` 的 `consumeState` 消费后立即删除,重放攻击无效
- **PKCE 强制**:没有 code_verifier 的 token exchange 会被 linux.do 拒绝,不可降级

## 关联条目

- [domains/public-auth](../domains/public-auth.md) — 公开版鉴权整体(session / middleware / balance)
- [domains/public-edition-overview](../domains/public-edition-overview.md) — 公开版架构全景
