# deploy-public-edition — 部署公开版到 jdc

将 `apps/api-public` + `apps/web-public` 部署到 jdc（`ssh jdc`），服务跑在 `https://inkast.124213.xyz`，端口 8788，nginx 反代。

## 前提

- jdc 上已安装 Node 24+、pnpm 10+
- Linux.do OAuth App 的 callback URL 已配好（见"注意事项"）
- R2 凭据（`PUBLIC_R2_*`）已备妥（如需 R2 图片存储）

---

## 步骤

### 1. 本地构建

```bash
# 根目录
pnpm public:build
# 等价于：pnpm --filter @inkast/shared build && pnpm --filter @inkast/web-public build && pnpm --filter @inkast/api-public build
```

产物：
- `apps/web-public/dist/` — SPA 静态文件
- `apps/api-public/dist/` — Hono API（ESM）
- `apps/api-public/src/storage/schema.sql` — 需随包传到 jdc（运行时 `import.meta.url` 解析）

### 2. rsync 到 jdc

```bash
# dist + schema + 生产 node_modules
rsync -av --delete apps/api-public/dist/ jdc:/root/inkast-public/api/dist/
rsync -av          apps/api-public/src/storage/schema.sql jdc:/root/inkast-public/api/src/storage/
rsync -av --delete apps/api-public/node_modules/ jdc:/root/inkast-public/api/node_modules/
rsync -av --delete apps/web-public/dist/ jdc:/root/inkast-public/web/dist/
```

### 3. 写 .env 文件（生产 EnvironmentFile）

在 jdc 上创建 `/root/inkast-public/.env`，权限 `600`：

```bash
chmod 600 /root/inkast-public/.env
```

必需变量：

```ini
PUBLIC_LINUXDO_CLIENT_ID=<从 Linux.do OAuth 应用页面拿>
PUBLIC_LINUXDO_CLIENT_SECRET=<同上>
PUBLIC_LINUXDO_CALLBACK_URL=https://inkast.124213.xyz/api/auth/linuxdo/callback

# SQLite 位置（建议放 /root/inkast-public/data/）
PUBLIC_DB_PATH=/root/inkast-public/data/inkast-public.sqlite

# 端口
PUBLIC_API_PORT=8788
PUBLIC_API_HOST=127.0.0.1
```

可选变量（如需 builtin provider）：

```ini
PUBLIC_BUILTIN_PROVIDER_BASE_URL=https://...
PUBLIC_BUILTIN_PROVIDER_API_KEY=...
PUBLIC_BUILTIN_PROVIDER_MODEL=gpt-image-2
PUBLIC_BUILTIN_COST_PER_IMAGE=1

# R2 图片存储
PUBLIC_R2_ACCOUNT_ID=...
PUBLIC_R2_ACCESS_KEY_ID=...
PUBLIC_R2_SECRET_ACCESS_KEY=...
PUBLIC_R2_BUCKET=inkast-public-images
PUBLIC_R2_PUBLIC_BASE_URL=https://...
```

本地 dev 跳过手写 .env，改用 `apps/api-public/scripts/dev.sh`（从 macOS Keychain 拉凭据）。

### 4. 初始化 SQLite（幂等建表）

首次部署或 schema 变更后：

```bash
ssh jdc "cd /root/inkast-public && node api/dist/index.js &"
# 进程启动时 db() 自动 applyExtraSchema
# 确认建表后 kill 临时进程
```

或者直接启动 systemd service（下一步），app 启动时幂等建表。

### 5. 配置 systemd service

`/etc/systemd/system/inkast-public.service`：

```ini
[Unit]
Description=Inkast Public API
After=network.target

[Service]
Type=simple
WorkingDirectory=/root/inkast-public/api
EnvironmentFile=/root/inkast-public/.env
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable inkast-public
systemctl restart inkast-public
systemctl status inkast-public
```

### 6. 配置 nginx

`/etc/nginx/sites-available/inkast-public`：

```nginx
server {
  listen 443 ssl;
  server_name inkast.124213.xyz;

  # SSL 由 jdc 通配符证书覆盖，路径见 cc 仓库 servers/jdc/nginx.md

  # API 反代
  location /api/ {
    proxy_pass http://127.0.0.1:8788;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_read_timeout 660s;   # passthrough 最长 600s + 60s 余量
  }

  # SPA 静态文件 + fallback
  root /root/inkast-public/web/dist;
  location / {
    try_files $uri $uri/ /index.html;
  }
}
```

```bash
ln -s /etc/nginx/sites-available/inkast-public /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

### 7. chmod 711 /root（关键，新服务器必做）

```bash
chmod 711 /root
```

否则 nginx（`www-data` 用户）无法 traverse 到 `/root/inkast-public/web/dist/`，静态文件全部 403。  
详情见 [pitfalls/root-700-blocks-nginx](../pitfalls/root-700-blocks-nginx.md)。

### 8. 健康检查 + changelog

```bash
curl https://inkast.124213.xyz/api/health
# 期望: {"ok":true,"service":"inkast-api-public","ts":...}
```

**在 `~/workspace/cc/servers/jdc/` 对应文档的"变更日志"中留痕**（基础设施管理硬性要求）：更新服务清单、记录端口/域名/deploy 时间。

---

## 注意事项

### OAuth callback URL 限制

Linux.do Connect 每个 OAuth App 只允许配**一个** callback URL。dev 环境（`localhost:5174/api/auth/linuxdo/callback`）和生产（`https://inkast.124213.xyz/api/auth/linuxdo/callback`）不能共存于同一 App。

解决方案：
- 本地 dev 使用 `PUBLIC_API_DEV_AUTH=1` 环境变量开启 dev 后门（绕过 OAuth，使用固定测试用户），**不要在生产环境开启**
- 或创建两个独立 OAuth App，dev/prod 各用一套凭据

### 首次登录赠初始额度

新用户 OAuth 登录后余额为 0，无法使用 builtin 通道。如需自动赠送初始额度，在 `apps/api-public/src/domain/auth/` 的用户创建路径里加 `credit(userId, n, { type: 'system:grant', reason: '新用户注册赠送' })`。

### 静态 preview 图

如果前端引用了 `/previews/*.png` 路径，需确认图片已迁移到 R2 或已复制到 `apps/web-public/public/previews/`。否则 SPA fallback 会把缺失的图片请求返回 `index.html`（详情见 [pitfalls/nginx-spa-fallback-swallows-static](../pitfalls/nginx-spa-fallback-swallows-static.md)）。

---

关联条目：[pitfalls/root-700-blocks-nginx](../pitfalls/root-700-blocks-nginx.md) · [pitfalls/nginx-spa-fallback-swallows-static](../pitfalls/nginx-spa-fallback-swallows-static.md) · [domains/public-edition-overview](../domains/public-edition-overview.md) · [domains/public-auth](../domains/public-auth.md) · [workflows/deploy-jdc](deploy-jdc.md)
