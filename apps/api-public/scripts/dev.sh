#!/bin/sh
# 本地 dev wrapper:从 macOS keychain 拉 OAuth 凭据注入 env,再启 tsx watch。
# 生产(jdc/Linux)走 systemd EnvironmentFile,security 命令不存在 → 下面 if
# 跳过,env 保持外部值。
#
# 已存进 keychain 的 secret(添加方式见 ~/workspace/cc/servers/jd-cloud/ 或 README):
#   security add-generic-password -s api-linuxdo-public-client-id  -a inkast -U -w ...
#   security add-generic-password -s api-linuxdo-public-client-secret -a inkast -U -w ...

set -e

if command -v security >/dev/null 2>&1; then
  : "${PUBLIC_LINUXDO_CLIENT_ID:=$(security find-generic-password -s api-linuxdo-public-client-id -w 2>/dev/null || true)}"
  : "${PUBLIC_LINUXDO_CLIENT_SECRET:=$(security find-generic-password -s api-linuxdo-public-client-secret -w 2>/dev/null || true)}"
  export PUBLIC_LINUXDO_CLIENT_ID PUBLIC_LINUXDO_CLIENT_SECRET
fi

# 默认回调地址 = vite proxy(5174)/api/...,跟 Linux.do 应用配置一致。
: "${PUBLIC_LINUXDO_CALLBACK_URL:=http://localhost:5174/api/auth/linuxdo/callback}"
export PUBLIC_LINUXDO_CALLBACK_URL

exec node_modules/.bin/tsx watch src/index.ts
