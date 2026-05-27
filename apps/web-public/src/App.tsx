import { useEffect, useState } from "react";

// ── 类型 ────────────────────────────────────────
interface MeResponse {
  user: {
    id: number;
    username: string;
    avatar_url: string | null;
    trust_level: number | null;
  } | null;
  balance: number;
}

interface ProviderConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  useCodexHeader: boolean;
}

interface GeneratedImage {
  url: string | null;
  b64: string | null;
}

interface GenResponse {
  ok: boolean;
  task_id: string;
  model: string;
  images: GeneratedImage[];
  cost?: number;
  balance_after?: number;
  duration_ms: number;
}

// ── localStorage(provider config 本地优先存放)──
const PROVIDER_KEY = "inkast-public:provider";
function readProvider(): ProviderConfig | null {
  try {
    const raw = localStorage.getItem(PROVIDER_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function writeProvider(p: ProviderConfig | null): void {
  if (p) localStorage.setItem(PROVIDER_KEY, JSON.stringify(p));
  else localStorage.removeItem(PROVIDER_KEY);
}

// ── 主组件 ──────────────────────────────────────
export function App() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [meError, setMeError] = useState<string | null>(null);

  const reloadMe = () => {
    fetch("/api/auth/me", { credentials: "same-origin" })
      .then(r => r.json() as Promise<MeResponse>)
      .then(setMe)
      .catch(e => setMeError(String(e)));
  };

  useEffect(() => {
    reloadMe();
  }, []);

  return (
    <div className="relative z-10 mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-12">
      <header className="flex flex-col items-center gap-2">
        <h1 className="text-3xl font-semibold">Inkast · 公开版</h1>
        <p className="text-muted-foreground text-sm">本地优先的 AI 生图工具 · 体验版</p>
      </header>

      {meError && (
        <div className="bg-card text-destructive shadow-(--shadow-paper) rounded-md border p-4 text-sm">
          {meError}
        </div>
      )}

      {!me ? (
        <Skeleton />
      ) : !me.user ? (
        <LoginCard />
      ) : (
        <>
          <UserHeader me={me} onLogout={reloadMe} />
          <InviteCodeCard onRedeemed={reloadMe} />
          <ProviderConfigCard />
          <GenerateCard balance={me.balance} onBalanceMaybeChanged={reloadMe} />
        </>
      )}
    </div>
  );
}

// ── 子组件 ──────────────────────────────────────

function Skeleton() {
  return (
    <div className="bg-card text-muted-foreground shadow-(--shadow-paper) rounded-md border p-4 text-sm">
      加载中…
    </div>
  );
}

function LoginCard() {
  return (
    <div className="bg-card shadow-(--shadow-paper) flex flex-col items-center gap-3 rounded-md border p-6">
      <p className="text-muted-foreground text-sm">用 Linux.do 账号登录使用</p>
      <button
        onClick={() => {
          window.location.href = "/api/auth/linuxdo/authorize?redirect_to=/";
        }}
        className="bg-primary text-primary-foreground hover:opacity-90 rounded-md px-4 py-2 text-sm font-medium"
      >
        用 Linux.do 登录
      </button>
    </div>
  );
}

function UserHeader({ me, onLogout }: { me: MeResponse; onLogout: () => void }) {
  if (!me.user) return null;
  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    onLogout();
  };
  return (
    <div className="bg-card shadow-(--shadow-paper) flex items-center gap-3 rounded-md border p-4">
      {me.user.avatar_url && (
        <img src={me.user.avatar_url} alt="" className="h-10 w-10 rounded-full border" />
      )}
      <div className="flex-1">
        <div className="font-medium">{me.user.username}</div>
        <div className="text-muted-foreground text-xs">
          信任等级 {me.user.trust_level ?? "—"} · 余额 <strong>{me.balance}</strong> 次
        </div>
      </div>
      <button
        onClick={logout}
        className="border-border hover:bg-muted rounded-md border px-3 py-1.5 text-xs"
      >
        登出
      </button>
    </div>
  );
}

function InviteCodeCard({ onRedeemed }: { onRedeemed: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const submit = async () => {
    if (!code.trim()) return;
    setBusy(true);
    setResult(null);
    try {
      const r = await fetch("/api/topups/invite/redeem", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      const j = await r.json();
      if (r.ok) {
        setResult(`✓ 兑换成功 +${j.amount} 次,余额 ${j.balance_after}`);
        setCode("");
        onRedeemed();
      } else {
        setResult(`✗ ${j.error ?? "兑换失败"}`);
      }
    } catch (e) {
      setResult(`✗ ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-card shadow-(--shadow-paper) rounded-md border p-4">
      <div className="mb-2 text-sm font-medium">邀请码兑换</div>
      <div className="flex gap-2">
        <input
          type="text"
          value={code}
          onChange={e => setCode(e.target.value)}
          placeholder="输入邀请码"
          className="border-border bg-background flex-1 rounded-md border px-3 py-2 text-sm"
          disabled={busy}
        />
        <button
          onClick={submit}
          disabled={busy || !code.trim()}
          className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {busy ? "…" : "兑换"}
        </button>
      </div>
      {result && <div className="text-muted-foreground mt-2 text-xs">{result}</div>}
    </div>
  );
}

function ProviderConfigCard() {
  const [config, setConfig] = useState<ProviderConfig>(
    () => readProvider() ?? { baseUrl: "", apiKey: "", model: "gpt-image-2", useCodexHeader: false },
  );
  const [saved, setSaved] = useState<boolean>(() => readProvider() !== null);

  const save = () => {
    if (!config.baseUrl.trim() || !config.apiKey.trim() || !config.model.trim()) return;
    writeProvider(config);
    setSaved(true);
  };
  const clear = () => {
    writeProvider(null);
    setSaved(false);
    setConfig({ baseUrl: "", apiKey: "", model: "gpt-image-2", useCodexHeader: false });
  };

  return (
    <div className="bg-card shadow-(--shadow-paper) rounded-md border p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-medium">我的 Provider(可选)</div>
        <div className="text-muted-foreground text-xs">
          {saved ? "✓ 已保存(走透明代理,不扣余额)" : "走平台兜底,扣余额"}
        </div>
      </div>
      <div className="space-y-2">
        <input
          type="text"
          value={config.baseUrl}
          onChange={e => setConfig({ ...config, baseUrl: e.target.value })}
          placeholder="Base URL,如 https://api.openai.com/v1"
          className="border-border bg-background w-full rounded-md border px-3 py-2 text-sm"
        />
        <input
          type="password"
          value={config.apiKey}
          onChange={e => setConfig({ ...config, apiKey: e.target.value })}
          placeholder="API Key(仅存浏览器,不上传服务端)"
          className="border-border bg-background w-full rounded-md border px-3 py-2 text-sm"
        />
        <div className="flex gap-2">
          <input
            type="text"
            value={config.model}
            onChange={e => setConfig({ ...config, model: e.target.value })}
            placeholder="Model"
            className="border-border bg-background flex-1 rounded-md border px-3 py-2 text-sm"
          />
          <label className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={config.useCodexHeader}
              onChange={e => setConfig({ ...config, useCodexHeader: e.target.checked })}
            />
            Codex header
          </label>
        </div>
        <div className="flex gap-2 pt-1">
          <button
            onClick={save}
            disabled={!config.baseUrl.trim() || !config.apiKey.trim() || !config.model.trim()}
            className="bg-primary text-primary-foreground flex-1 rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50"
          >
            保存到浏览器
          </button>
          {saved && (
            <button
              onClick={clear}
              className="border-border hover:bg-muted rounded-md border px-3 py-1.5 text-xs"
            >
              清除
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function GenerateCard({
  balance,
  onBalanceMaybeChanged,
}: {
  balance: number;
  onBalanceMaybeChanged: () => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GenResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!prompt.trim()) return;
    setBusy(true);
    setResult(null);
    setError(null);

    const provider = readProvider();
    const endpoint = provider ? "/api/gen/passthrough" : "/api/gen/builtin";
    const body = provider
      ? { provider, prompt: prompt.trim() }
      : { prompt: prompt.trim() };

    try {
      const r = await fetch(endpoint, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (r.ok) {
        setResult(j);
        if (!provider) onBalanceMaybeChanged();
      } else {
        setError(`${j.error ?? "failed"}: ${j.message ?? ""}`);
        if (j.refunded) onBalanceMaybeChanged();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const provider = readProvider();
  const channelLabel = provider ? "透明代理(你的 key)" : `平台兜底(扣余额,当前余额 ${balance})`;

  return (
    <div className="bg-card shadow-(--shadow-paper) rounded-md border p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-sm font-medium">生图</div>
        <div className="text-muted-foreground text-xs">{channelLabel}</div>
      </div>
      <textarea
        value={prompt}
        onChange={e => setPrompt(e.target.value)}
        placeholder="描述你想要的图片(prompt)"
        rows={3}
        className="border-border bg-background mb-2 w-full rounded-md border px-3 py-2 text-sm"
        disabled={busy}
      />
      <button
        onClick={submit}
        disabled={busy || !prompt.trim()}
        className="bg-primary text-primary-foreground w-full rounded-md px-3 py-2 text-sm font-medium disabled:opacity-50"
      >
        {busy ? "生成中…" : "生成"}
      </button>

      {error && (
        <div className="text-destructive mt-3 text-xs">{error}</div>
      )}

      {result && (
        <div className="mt-3 space-y-2">
          <div className="text-muted-foreground text-xs">
            ✓ {result.model} · {result.duration_ms}ms
            {result.balance_after !== undefined && ` · 余额 ${result.balance_after}`}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {result.images.map((img, i) => (
              <ImageView key={i} image={img} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ImageView({ image }: { image: GeneratedImage }) {
  const src = image.url ?? (image.b64 ? `data:image/png;base64,${image.b64}` : "");
  if (!src) return null;
  return (
    <img
      src={src}
      alt=""
      className="border-border w-full rounded-md border"
    />
  );
}
