import { useEffect, useState } from "react";
import { Plus, Trash2, Pencil, X, Save, KeyRound, Loader2 } from "lucide-react";
import type { ProviderSummary } from "@inkast/shared";
import { cn } from "../../lib/utils.js";
import {
  createProvider,
  deleteProvider,
  listProviders,
  updateProvider,
} from "./api.js";

interface Props {
  open: boolean;
  onClose: () => void;
  onChange?: (providers: ProviderSummary[]) => void;
}

interface FormState {
  id: string | null;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  priority: string;
}

const EMPTY_FORM: FormState = {
  id: null,
  name: "",
  baseUrl: "",
  apiKey: "",
  model: "gpt-image-2",
  priority: "100",
};

export function ProviderConfigDialog({ open, onClose, onChange }: Props) {
  const [providers, setProviders] = useState<ProviderSummary[] | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    refresh();
  }, [open]);

  async function refresh() {
    setError(null);
    try {
      const list = await listProviders();
      setProviders(list);
      onChange?.(list);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function save() {
    if (!form) return;
    setError(null);
    setPending(true);
    try {
      const priority = Number(form.priority) || 100;
      if (form.id) {
        const patch: Parameters<typeof updateProvider>[1] = {
          name: form.name.trim(),
          baseUrl: form.baseUrl.trim(),
          model: form.model.trim() || "gpt-image-2",
          priority,
        };
        if (form.apiKey.trim()) patch.apiKey = form.apiKey.trim();
        await updateProvider(form.id, patch);
      } else {
        if (!form.apiKey.trim()) throw new Error("API key is required for new providers");
        await createProvider({
          name: form.name.trim(),
          baseUrl: form.baseUrl.trim(),
          apiKey: form.apiKey.trim(),
          model: form.model.trim() || "gpt-image-2",
          priority,
        });
      }
      setForm(null);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("删除这个 provider?")) return;
    setError(null);
    try {
      await deleteProvider(id);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 p-6 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-md border border-border bg-card shadow-(--shadow-paper-lifted)"
        onClick={e => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-border/60 px-6 py-4">
          <div className="flex items-center gap-2">
            <KeyRound className="size-4 text-primary" strokeWidth={1.5} />
            <h2 className="text-base font-medium">图像 provider 配置</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-sm p-1 text-muted-foreground transition hover:text-foreground"
          >
            <X className="size-4" strokeWidth={1.75} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {error && (
            <div className="mb-4 rounded-sm border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          {providers === null ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" strokeWidth={1.75} />
              加载中…
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {providers.length === 0 && !form && (
                <li className="rounded-sm border border-dashed border-border bg-background px-4 py-6 text-center text-sm text-muted-foreground">
                  还没有 provider。点下方"添加 provider"配置一个 OpenAI 兼容图像端点。
                </li>
              )}
              {providers.map(p => (
                <li
                  key={p.id}
                  className="flex items-start justify-between gap-3 rounded-sm border border-border/70 bg-background px-4 py-3"
                >
                  <div className="flex-1 space-y-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-medium">{p.name}</span>
                      <span className="text-xs text-muted-foreground">
                        priority {p.priority} · {p.model}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {p.baseUrl}
                    </div>
                    <div className="font-mono text-xs text-muted-foreground">
                      key {p.keyMasked}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button
                      onClick={() =>
                        setForm({
                          id: p.id,
                          name: p.name,
                          baseUrl: p.baseUrl,
                          apiKey: "",
                          model: p.model,
                          priority: String(p.priority),
                        })
                      }
                      className="rounded-sm p-1.5 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                    >
                      <Pencil className="size-3.5" strokeWidth={1.75} />
                    </button>
                    <button
                      onClick={() => remove(p.id)}
                      className="rounded-sm p-1.5 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" strokeWidth={1.75} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {form && (
            <div className="mt-4 rounded-sm border border-primary/30 bg-primary/5 p-4">
              <h3 className="mb-3 text-sm font-medium">
                {form.id ? "编辑 provider" : "添加 provider"}
              </h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field
                  label="名称"
                  value={form.name}
                  onChange={v => setForm({ ...form, name: v })}
                  placeholder="OpenAI"
                />
                <Field
                  label="优先级 (越小越先用)"
                  value={form.priority}
                  onChange={v => setForm({ ...form, priority: v })}
                  placeholder="100"
                />
                <Field
                  label="Base URL"
                  value={form.baseUrl}
                  onChange={v => setForm({ ...form, baseUrl: v })}
                  placeholder="https://api.openai.com/v1"
                  className="sm:col-span-2"
                />
                <Field
                  label="模型"
                  value={form.model}
                  onChange={v => setForm({ ...form, model: v })}
                  placeholder="gpt-image-2"
                />
                <Field
                  label={form.id ? "API key (留空保持原值)" : "API key"}
                  value={form.apiKey}
                  onChange={v => setForm({ ...form, apiKey: v })}
                  placeholder="sk-…"
                  type="password"
                />
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  onClick={() => setForm(null)}
                  disabled={pending}
                  className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground transition hover:text-foreground"
                >
                  取消
                </button>
                <button
                  onClick={save}
                  disabled={pending || !form.name.trim() || !form.baseUrl.trim()}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow-(--shadow-paper)",
                    "hover:shadow-(--shadow-paper-lifted)",
                    "disabled:cursor-not-allowed disabled:opacity-50",
                  )}
                >
                  {pending ? (
                    <Loader2 className="size-3.5 animate-spin" strokeWidth={1.75} />
                  ) : (
                    <Save className="size-3.5" strokeWidth={1.75} />
                  )}
                  保存
                </button>
              </div>
            </div>
          )}
        </div>

        <footer className="border-t border-border/60 px-6 py-3">
          {!form && (
            <button
              onClick={() => setForm({ ...EMPTY_FORM })}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow-(--shadow-paper) transition hover:shadow-(--shadow-paper-lifted)"
            >
              <Plus className="size-3.5" strokeWidth={1.75} />
              添加 provider
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  className,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  type?: "text" | "password";
  className?: string;
}) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="rounded-sm border border-input bg-background px-2.5 py-1.5 text-sm outline-none transition focus:border-ring"
      />
    </label>
  );
}
