import { useCallback, useEffect, useState } from "react";
import { LogIn, LogOut, Wallet, Gift } from "lucide-react";
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
 * 公开版独有:右上角浮窗 widget。
 *   - 未登录:"登录" → /api/auth/linuxdo/authorize?redirect_to=/
 *   - 已登录:头像 + 用户名 + 余额 + 兑换码弹窗 + 登出
 *
 * 主线 App.tsx fork 后只加一行 <AuthHeader /> 渲染,其它代码不动。
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

  return (
    <div className="fixed top-4 right-4 z-50">
      {me.user ? (
        <div className="bg-card shadow-(--shadow-paper) flex items-center gap-2 rounded-md border p-1.5">
          {me.user.avatar_url && (
            <img
              src={me.user.avatar_url}
              alt=""
              className="border-border h-7 w-7 rounded-full border"
            />
          )}
          <div className="px-1 text-xs">
            <div className="font-medium">{me.user.username}</div>
            <div className="text-muted-foreground flex items-center gap-1">
              <Wallet className="size-3" />
              {me.balance} 次
            </div>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => setRedeemOpen(true)}
          >
            <Gift className="size-3" />
            兑换
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            onClick={logout}
            aria-label="登出"
          >
            <LogOut className="size-3" />
          </Button>
        </div>
      ) : (
        <Button size="sm" onClick={login} className="shadow-(--shadow-paper)">
          <LogIn className="size-4" />
          用 Linux.do 登录
        </Button>
      )}

      <RedeemDialog
        open={redeemOpen}
        onOpenChange={setRedeemOpen}
        onRedeemed={reload}
      />
    </div>
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
