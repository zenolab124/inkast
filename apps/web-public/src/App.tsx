import { useEffect, useState } from "react";

interface Health {
  ok: boolean;
  service: string;
  ts: number;
}

export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then(r => r.json() as Promise<Health>)
      .then(setHealth)
      .catch(e => setError(String(e)));
  }, []);

  return (
    <div className="relative z-10 mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-6 px-6">
      <h1 className="text-4xl font-semibold">Inkast · 公开版</h1>
      <p className="text-muted-foreground text-center">
        本地优先的 AI 生图工具 · 体验版骨架
      </p>
      <div className="bg-card shadow-(--shadow-paper) w-full rounded-md border p-4 text-sm">
        <div className="text-muted-foreground mb-2 text-xs uppercase tracking-wide">
          后端健康检查
        </div>
        {health && (
          <pre className="text-foreground overflow-x-auto">
            {JSON.stringify(health, null, 2)}
          </pre>
        )}
        {error && <div className="text-destructive">{error}</div>}
        {!health && !error && (
          <div className="text-muted-foreground">加载中…</div>
        )}
      </div>
    </div>
  );
}
