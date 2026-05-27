import { useEffect, useState } from "react";

interface MeResponse {
  user: {
    id: number;
    username: string;
    avatar_url: string | null;
    trust_level: number | null;
  } | null;
  balance: number;
}

export function App() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = () => {
    fetch("/api/auth/me", { credentials: "same-origin" })
      .then(r => r.json() as Promise<MeResponse>)
      .then(setMe)
      .catch(e => setError(String(e)));
  };

  useEffect(() => {
    reload();
  }, []);

  const login = () => {
    window.location.href = "/api/auth/linuxdo/authorize?redirect_to=/";
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    reload();
  };

  return (
    <div className="relative z-10 mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-6 px-6">
      <h1 className="text-4xl font-semibold">Inkast · 公开版</h1>
      <p className="text-muted-foreground text-center">
        本地优先的 AI 生图工具 · 体验版骨架
      </p>

      <div className="bg-card shadow-(--shadow-paper) w-full rounded-md border p-4 text-sm">
        {error && <div className="text-destructive">{error}</div>}
        {!me && !error && <div className="text-muted-foreground">加载中…</div>}

        {me?.user ? (
          <div className="flex items-center gap-3">
            {me.user.avatar_url && (
              <img
                src={me.user.avatar_url}
                alt=""
                className="h-10 w-10 rounded-full border"
              />
            )}
            <div className="flex-1">
              <div className="font-medium">{me.user.username}</div>
              <div className="text-muted-foreground text-xs">
                信任等级 {me.user.trust_level ?? "—"} · 余额 {me.balance} 次
              </div>
            </div>
            <button
              onClick={logout}
              className="border-border hover:bg-muted rounded-md border px-3 py-1.5 text-xs"
            >
              登出
            </button>
          </div>
        ) : me ? (
          <div className="flex flex-col items-center gap-3 py-4">
            <p className="text-muted-foreground text-xs">用 Linux.do 账号登录使用</p>
            <button
              onClick={login}
              className="bg-primary text-primary-foreground hover:opacity-90 rounded-md px-4 py-2 text-sm font-medium"
            >
              用 Linux.do 登录
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
