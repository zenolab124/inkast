/**
 * Linux.do Connect OAuth2 配置。endpoint URL 全部 env 化默认值用申请页面
 * 给出的值,有 OIDC discovery 后续可以改成自动拉取。secret 通过 keychain
 * (本地 dev,scripts/dev.sh 注入) 或 systemd EnvironmentFile (jdc 生产)
 * 进入 env,代码本身不持久化任何 secret。
 */

export interface LinuxDoOAuthConfig {
  clientId: string;
  clientSecret: string;
  authorizeUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
  callbackUrl: string;
  /** Linux.do 当前未要求 scope;留空默认。 */
  scope: string;
}

const DEFAULTS = {
  authorizeUrl: "https://connect.linux.do/oauth2/authorize",
  tokenUrl: "https://connect.linux.do/oauth2/token",
  userinfoUrl: "https://connect.linux.do/api/user",
  callbackUrl: "http://localhost:5174/api/auth/linuxdo/callback",
  scope: "",
};

let _cached: LinuxDoOAuthConfig | null = null;

export function loadLinuxDoOAuthConfig(): LinuxDoOAuthConfig {
  if (_cached) return _cached;

  const clientId = process.env.PUBLIC_LINUXDO_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.PUBLIC_LINUXDO_CLIENT_SECRET?.trim() ?? "";
  if (!clientId || !clientSecret) {
    throw new Error(
      "PUBLIC_LINUXDO_CLIENT_ID / PUBLIC_LINUXDO_CLIENT_SECRET 未设置。本地 dev 检查 scripts/dev.sh 是否从 keychain 拉到,生产检查 systemd EnvironmentFile。",
    );
  }

  _cached = {
    clientId,
    clientSecret,
    authorizeUrl: process.env.PUBLIC_LINUXDO_AUTHORIZE_URL?.trim() || DEFAULTS.authorizeUrl,
    tokenUrl: process.env.PUBLIC_LINUXDO_TOKEN_URL?.trim() || DEFAULTS.tokenUrl,
    userinfoUrl: process.env.PUBLIC_LINUXDO_USERINFO_URL?.trim() || DEFAULTS.userinfoUrl,
    callbackUrl: process.env.PUBLIC_LINUXDO_CALLBACK_URL?.trim() || DEFAULTS.callbackUrl,
    scope: process.env.PUBLIC_LINUXDO_SCOPE?.trim() ?? DEFAULTS.scope,
  };
  return _cached;
}
