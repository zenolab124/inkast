import { useCallback, useEffect, useState } from "react";
import { Gift, LogIn, LogOut, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface MeResponse {
  user: {
    id: number;
    username: string;
    avatar_url: string | null;
    trust_level: number | null;
  } | null;
  balance: number;
}

/**
 * 公开版独有:嵌入主线 Header 右侧 buttons 那一行的紧凑 widget。
 *   - 未登录:"用 Linux.do 登录" 按钮 → /api/auth/linuxdo/authorize
 *   - 已登录:头像 + 用户名 + 余额 chip + 兑换码弹窗 + 登出
 *
 * 跟主线 Header 其它 Button 同尺寸/样式(variant=outline size=sm)对齐,
 * 不抢镜不撞位置。
 */
export function AuthHeader() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [redeemOpen, setRedeemOpen] = useState(false);

  const reload = useCallback(() => {
    fetch("/api/auth/me", { credentials: "same-origin" })
      .then(r => r.json() as Promise<MeResponse>)
      .then(setMe)
      .catch(() => setMe({ user: null, balance: 0 }));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const login = () => {
    const path = window.location.pathname + window.location.search;
    window.location.href = `/api/auth/linuxdo/authorize?redirect_to=${encodeURIComponent(path)}`;
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    reload();
  };

  if (!me) return null;

  if (!me.user) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={login}
        className="text-muted-foreground hover:text-foreground"
      >
        <LogIn strokeWidth={1.5} />
        Linux.do 登录
      </Button>
    );
  }

  return (
    <>
      <div className="border-border/60 bg-card flex items-center gap-2 rounded-md border px-2 py-1">
        {me.user.avatar_url && (
          <img
            src={me.user.avatar_url}
            alt=""
            className="border-border/40 size-6 rounded-full border"
          />
        )}
        <span className="text-foreground text-xs font-medium">{me.user.username}</span>
        <span className="text-muted-foreground flex items-center gap-0.5 text-xs">
          <Wallet className="size-3" strokeWidth={1.5} />
          {me.balance}
        </span>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setRedeemOpen(true)}
        className="text-muted-foreground hover:text-foreground"
        title="兑换邀请码"
      >
        <Gift strokeWidth={1.5} />
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={logout}
        className="text-muted-foreground hover:text-foreground"
        title="登出"
      >
        <LogOut strokeWidth={1.5} />
      </Button>

      <RedeemDialog
        open={redeemOpen}
        onOpenChange={setRedeemOpen}
        onRedeemed={reload}
      />
    </>
  );
}

function RedeemDialog({
  open,
  onOpenChange,
  onRedeemed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRedeemed: () => void;
}) {
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      const j = await r.json();
      if (r.ok) {
        setResult(`✓ +${j.amount} 次,余额 ${j.balance_after}`);
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>兑换邀请码</DialogTitle>
          <DialogDescription>输入邀请码兑换次数,用于平台兜底通道生图。</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Input
            value={code}
            onChange={e => setCode(e.target.value)}
            placeholder="邀请码"
            disabled={busy}
            onKeyDown={e => {
              if (e.key === "Enter") void submit();
            }}
          />
          {result && <div className="text-muted-foreground text-xs">{result}</div>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
          <Button onClick={submit} disabled={busy || !code.trim()}>
            {busy ? "兑换中…" : "兑换"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
