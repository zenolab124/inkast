import { useEffect, useState } from "react";
import { Plus, Trash2, Pencil, Save, KeyRound, Loader2 } from "lucide-react";
import type { ProviderSummary } from "@inkast/shared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLanguage } from "@/i18n/LanguageContext";
import { cn } from "@/lib/utils";
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
  const { t } = useLanguage();
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
    if (!confirm(t.config.confirmDelete)) return;
    setError(null);
    try {
      await deleteProvider(id);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="flex max-h-[80vh] w-full max-w-2xl flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <header className="flex items-center gap-2 border-b border-border/60 px-6 py-4 pr-12">
          <KeyRound className="size-4 text-primary" strokeWidth={1.5} />
          <DialogTitle className="text-base font-medium">{t.config.title}</DialogTitle>
          <DialogDescription className="sr-only">{t.config.description}</DialogDescription>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {error && (
            <Alert variant="destructive" className="mb-4 rounded-md">
              <AlertTitle>{t.config.error}</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {providers === null ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" strokeWidth={1.75} />
              {t.config.loading}
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {providers.length === 0 && !form && (
                <li className="rounded-sm border border-dashed border-border bg-background px-4 py-6 text-center text-sm text-muted-foreground">
                  {t.config.none}
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
                    <Button
                      variant="ghost"
                      size="icon-xs"
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
                      className="text-muted-foreground hover:bg-secondary hover:text-foreground"
                    >
                      <Pencil strokeWidth={1.75} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => remove(p.id)}
                      className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 strokeWidth={1.75} />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {form && (
            <div className="mt-4 rounded-sm border border-primary/30 bg-primary/5 p-4">
              <h3 className="mb-3 text-sm font-medium">
                {form.id ? t.config.edit : t.config.addNew}
              </h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field
                  label={t.config.fields.name}
                  value={form.name}
                  onChange={v => setForm({ ...form, name: v })}
                  placeholder="OpenAI"
                />
                <Field
                  label={t.config.fields.priority}
                  value={form.priority}
                  onChange={v => setForm({ ...form, priority: v })}
                  placeholder="100"
                />
                <Field
                  label={t.config.fields.baseUrl}
                  value={form.baseUrl}
                  onChange={v => setForm({ ...form, baseUrl: v })}
                  placeholder="https://api.openai.com/v1"
                  className="sm:col-span-2"
                />
                <Field
                  label={t.config.fields.model}
                  value={form.model}
                  onChange={v => setForm({ ...form, model: v })}
                  placeholder="gpt-image-2"
                />
                <Field
                  label={form.id ? t.config.fields.apiKeyEdit : t.config.fields.apiKey}
                  value={form.apiKey}
                  onChange={v => setForm({ ...form, apiKey: v })}
                  placeholder="sk-…"
                  type="password"
                />
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setForm(null)}
                  disabled={pending}
                  className="text-muted-foreground hover:text-foreground"
                >
                  {t.config.cancel}
                </Button>
                <Button
                  size="sm"
                  onClick={save}
                  disabled={pending || !form.name.trim() || !form.baseUrl.trim()}
                >
                  {pending ? (
                    <Loader2 className="animate-spin" strokeWidth={1.75} />
                  ) : (
                    <Save strokeWidth={1.75} />
                  )}
                  {t.config.save}
                </Button>
              </div>
            </div>
          )}
        </div>

        <footer className="border-t border-border/60 px-6 py-3">
          {!form && (
            <Button size="sm" onClick={() => setForm({ ...EMPTY_FORM })}>
              <Plus strokeWidth={1.75} />
              {t.config.addNew}
            </Button>
          )}
        </footer>
      </DialogContent>
    </Dialog>
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
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </Label>
      <Input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}
