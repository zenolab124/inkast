import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createHash, randomBytes } from "node:crypto";
import { loadLinuxDoOAuthConfig } from "../../domain/auth/oauth-config.js";
import { consumeState, storeState } from "../../domain/auth/oauth-state-store.js";
import { getBalance } from "../../domain/balance/service.js";
import {
  createSession,
  deleteSession,
  findValidSession,
} from "../../storage/sessions.js";
import { findUserById, upsertUser } from "../../storage/users.js";

export const SESSION_COOKIE = "inkast_public_session";

export const authRoutes = new Hono();

function base64Url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

authRoutes.get("/auth/linuxdo/authorize", c => {
  const cfg = loadLinuxDoOAuthConfig();
  const state = randomBytes(16).toString("hex");
  const codeVerifier = base64Url(randomBytes(32));
  const codeChallenge = base64Url(
    createHash("sha256").update(codeVerifier).digest(),
  );

  const redirectTo = c.req.query("redirect_to") ?? null;
  storeState(state, codeVerifier, redirectTo);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: cfg.clientId,
    redirect_uri: cfg.callbackUrl,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  if (cfg.scope) params.set("scope", cfg.scope);

  return c.redirect(`${cfg.authorizeUrl}?${params.toString()}`, 302);
});

authRoutes.get("/auth/linuxdo/callback", async c => {
  const cfg = loadLinuxDoOAuthConfig();

  const code = c.req.query("code");
  const state = c.req.query("state");
  const error = c.req.query("error");
  if (error) return c.text(`OAuth provider error: ${error}`, 400);
  if (!code || !state) return c.text("missing code or state", 400);

  const stored = consumeState(state);
  if (!stored) return c.text("invalid or expired state", 400);

  // 1. code → access_token
  const tokenBody = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: cfg.callbackUrl,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    code_verifier: stored.codeVerifier,
  });
  const tokenRes = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: tokenBody.toString(),
  });
  if (!tokenRes.ok) {
    const detail = await tokenRes.text().catch(() => "");
    return c.text(`token exchange failed: ${tokenRes.status} ${detail}`, 502);
  }
  const tokenJson = (await tokenRes.json().catch(() => null)) as
    | { access_token?: string }
    | null;
  const accessToken = tokenJson?.access_token;
  if (!accessToken) return c.text("no access_token in token response", 502);

  // 2. access_token → userinfo
  const userRes = await fetch(cfg.userinfoUrl, {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
  });
  if (!userRes.ok) {
    return c.text(`userinfo failed: ${userRes.status}`, 502);
  }
  const userJson = (await userRes.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  if (!userJson) return c.text("invalid userinfo payload", 502);

  // 字段映射(Discourse / Linux.do Connect 风格)。首次跑通后如果字段不对
  // 再按实际 payload 调整这里。
  const linuxDoId = String(
    (userJson.id as string | number | undefined) ?? userJson.sub ?? "",
  );
  if (!linuxDoId) return c.text("userinfo missing id field", 502);
  const username = String(
    (userJson.username as string | undefined) ??
      (userJson.name as string | undefined) ??
      linuxDoId,
  );
  const avatarTpl = userJson.avatar_template as string | undefined;
  const avatarUrl = typeof avatarTpl === "string"
    ? new URL(avatarTpl.replace("{size}", "120"), "https://linux.do").toString()
    : ((userJson.avatar_url as string | undefined) ?? null);
  const trustLevel =
    typeof userJson.trust_level === "number" ? userJson.trust_level : null;

  const user = upsertUser({ linuxDoId, username, avatarUrl, trustLevel });

  // 3. 建 session + 发 cookie
  const session = createSession(user.id);
  setCookie(c, SESSION_COOKIE, session.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Lax",
    path: "/",
    maxAge: Math.floor((session.expiresAt - Date.now()) / 1000),
  });

  return c.redirect(stored.redirectTo ?? "/", 302);
});

authRoutes.post("/auth/logout", c => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) deleteSession(token);
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

authRoutes.get("/auth/me", c => {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return c.json({ user: null, balance: 0 });
  const sess = findValidSession(token);
  if (!sess) return c.json({ user: null, balance: 0 });
  const user = findUserById(sess.userId);
  if (!user) return c.json({ user: null, balance: 0 });
  return c.json({
    user: {
      id: user.id,
      username: user.username,
      avatar_url: user.avatar_url,
      trust_level: user.trust_level,
    },
    balance: getBalance(user.id),
  });
});
