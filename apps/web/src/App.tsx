import { useCallback, useRef, useState } from "react";
import { Feather, AlertCircle, Settings, CheckCircle2 } from "lucide-react";
import type { GenerationRecord, PromptDraft } from "@inkast/shared";
import { cn } from "./lib/utils.js";
import { PromptComposer } from "./features/prompt/PromptComposer.js";
import { PromptDraftView } from "./features/prompt/PromptDraftView.js";
import { draftPrompt, type DraftPromptError } from "./features/prompt/api.js";
import { ProviderConfigDialog } from "./features/config/ProviderConfigDialog.js";
import { Gallery } from "./features/gallery/Gallery.js";
import { generateImage, type GenerateError } from "./features/gallery/api.js";

interface DraftState {
  draft: PromptDraft;
  meta?: { backend?: string; durationMs?: number };
  adopted: Set<number>;
}

interface FlashMessage {
  kind: "success" | "error";
  text: string;
}

export function App() {
  const [dark, setDark] = useState(false);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<DraftState | null>(null);
  const [appendNonce, setAppendNonce] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [galleryKey, setGalleryKey] = useState(0);
  const [flash, setFlash] = useState<FlashMessage | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const generateAbortRef = useRef<AbortController | null>(null);

  const submit = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed) return;

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setPending(true);
    setError(null);

    try {
      const resp = (await draftPrompt({ input: trimmed }, ac.signal)) as PromptDraft & {
        _meta?: { backend?: string; durationMs?: number };
      };
      const { _meta, ...draft } = resp;
      setState({ draft, meta: _meta, adopted: new Set() });
    } catch (err) {
      if (ac.signal.aborted) return;
      const e = err as DraftPromptError;
      setError(e?.message ?? String(err));
    } finally {
      if (abortRef.current === ac) {
        abortRef.current = null;
        setPending(false);
      }
    }
  }, [input]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPending(false);
  }, []);

  const adoptHint = useCallback((index: number) => {
    setState(prev => {
      if (!prev) return prev;
      if (prev.adopted.has(index)) return prev;
      const hint = prev.draft.hints[index];
      if (!hint) return prev;
      setInput(prevInput => appendSuggestion(prevInput, hint.field, hint.suggestion));
      setAppendNonce(n => n + 1);
      const adopted = new Set(prev.adopted);
      adopted.add(index);
      return { ...prev, adopted };
    });
  }, []);

  const generate = useCallback(async () => {
    if (!state) return;
    generateAbortRef.current?.abort();
    const ac = new AbortController();
    generateAbortRef.current = ac;
    setGenerating(true);
    setFlash(null);

    try {
      const resp = await generateImage({ prompt: state.draft.prompt }, ac.signal);
      const fallbacks = resp.driver.attempts.filter(a => !a.ok);
      const head = `生图完成 · ${resp.driver.providerName} · ${(resp.driver.totalDurationMs / 1000).toFixed(1)}s`;
      const fallbackTrail = fallbacks.length
        ? "\n" + fallbacks
            .map(a => `  · 跳过 ${a.providerName} (${a.errorCode ?? "?"})`)
            .join("\n")
        : "";
      setFlash({ kind: "success", text: head + fallbackTrail });
      setGalleryKey(k => k + 1);
    } catch (err) {
      if (ac.signal.aborted) return;
      const ge = err as GenerateError;
      const message = ge.message;
      const isNoProvider = message.includes("no_providers");
      // Inline the first attempt's upstream summary if present — saves the
      // user from having to grep API logs.
      const attemptDetails = ge.attempts?.length
        ? ge.attempts
            .map(
              a =>
                `  · ${a.providerName} (${a.errorCode ?? "?"}): ${
                  a.errorMessage ?? "(no detail)"
                }`,
            )
            .join("\n")
        : null;
      setFlash({
        kind: "error",
        text: isNoProvider
          ? "还没有 provider — 点右上角齿轮先配一个 OpenAI 兼容图像端点"
          : attemptDetails
            ? `${message}\n${attemptDetails}`
            : message,
      });
      if (isNoProvider) setConfigOpen(true);
    } finally {
      if (generateAbortRef.current === ac) {
        generateAbortRef.current = null;
        setGenerating(false);
      }
    }
  }, [state]);

  const reuseFromHistory = useCallback((record: GenerationRecord) => {
    setState({
      draft: { prompt: record.promptSnapshot, hints: [] },
      meta: { durationMs: record.durationMs ?? undefined },
      adopted: new Set(),
    });
    setFlash({ kind: "success", text: "已载入历史 prompt,可调整后再生图" });
  }, []);

  return (
    <div className={cn("theme-paper relative min-h-screen", dark && "dark")}>
      <div className="relative z-10 mx-auto flex min-h-screen max-w-5xl flex-col gap-8 px-8 py-10">
        <Header
          dark={dark}
          onToggleDark={() => setDark(d => !d)}
          onOpenConfig={() => setConfigOpen(true)}
        />

        <section className="rounded-md border border-border/60 bg-card p-6 shadow-(--shadow-paper)">
          <PromptComposer
            value={input}
            onChange={setInput}
            pending={pending}
            hasDraft={!!state}
            onSubmit={submit}
            onCancel={cancel}
            appendNonce={appendNonce}
          />
        </section>

        {error && (
          <Banner
            kind="error"
            title="起草失败"
            message={error}
            onClose={() => setError(null)}
          />
        )}
        {flash && (
          <Banner
            kind={flash.kind}
            title={flash.kind === "success" ? "OK" : "生图失败"}
            message={flash.text}
            onClose={() => setFlash(null)}
          />
        )}

        {state && (
          <PromptDraftView
            draft={state.draft}
            meta={state.meta}
            pending={pending}
            adoptedHints={state.adopted}
            onAdoptHint={adoptHint}
            generating={generating}
            onGenerate={generate}
          />
        )}

        {!state && !error && !pending && <Intro />}

        <Gallery refreshKey={galleryKey} onReuse={reuseFromHistory} />

        <Footer />
      </div>

      <ProviderConfigDialog
        open={configOpen}
        onClose={() => setConfigOpen(false)}
      />
    </div>
  );
}

function appendSuggestion(current: string, field: string, suggestion: string): string {
  const line = `补充·${field}: ${suggestion}`;
  if (!current.trim()) return line;
  if (current.includes(line)) return current;
  return `${current.replace(/\s+$/, "")}\n${line}`;
}

function Banner({
  kind,
  title,
  message,
  onClose,
}: {
  kind: "success" | "error";
  title: string;
  message: string;
  onClose?: () => void;
}) {
  const Icon = kind === "success" ? CheckCircle2 : AlertCircle;
  const palette =
    kind === "success"
      ? "border-primary/30 bg-primary/5 text-foreground/90"
      : "border-destructive/40 bg-destructive/5 text-destructive";
  return (
    <div className={cn("flex items-start gap-3 rounded-md border p-4 text-sm", palette)}>
      <Icon
        className={cn("mt-0.5 size-4 shrink-0", kind === "success" ? "text-primary" : "text-destructive")}
        strokeWidth={1.75}
      />
      <div className="flex-1">
        <div className="font-medium">{title}</div>
        <div className="mt-1 whitespace-pre-wrap font-mono text-xs leading-relaxed opacity-90">
          {message}
        </div>
      </div>
      {onClose && (
        <button
          onClick={onClose}
          className="rounded-sm px-1 text-xs text-muted-foreground transition hover:text-foreground"
        >
          ×
        </button>
      )}
    </div>
  );
}

function Header({
  dark,
  onToggleDark,
  onOpenConfig,
}: {
  dark: boolean;
  onToggleDark: () => void;
  onOpenConfig: () => void;
}) {
  return (
    <header className="flex items-center justify-between border-b border-border/60 pb-5">
      <div className="flex items-center gap-3">
        <Feather className="size-5 text-primary" strokeWidth={1.5} />
        <span className="text-xl font-medium tracking-tight">Inkast</span>
        <span className="ml-2 hidden text-xs text-muted-foreground sm:inline">
          local-first ai image studio
        </span>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={onOpenConfig}
          title="Provider 配置"
          className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-card px-3 py-1.5 text-sm text-muted-foreground transition hover:text-foreground hover:shadow-(--shadow-paper)"
        >
          <Settings className="size-4" strokeWidth={1.5} />
          配置
        </button>
        <button
          onClick={onToggleDark}
          className="rounded-md border border-border/60 bg-card px-3 py-1.5 text-sm text-muted-foreground transition hover:text-foreground hover:shadow-(--shadow-paper)"
        >
          {dark ? "Paper · Light" : "Paper · Dark"}
        </button>
      </div>
    </header>
  );
}

function Intro() {
  const items = [
    {
      title: "散文 → JSON prompt",
      body: "把模糊的描述拆成 type / style / subject / lighting … 让模型按字段处理,而不是猜散文。",
    },
    {
      title: "ClaudeCode 一等公民",
      body: "默认走本机已登录的 ClaudeCode,无需 API key。生成稳定的结构化 JSON。",
    },
    {
      title: "OpenAI 兼容生图 + 池切换",
      body: "在「配置」里加 provider,网络/5xx/配额自动切换。生成图本地落盘,完整可审计。",
    },
  ];

  return (
    <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {items.map(it => (
        <article
          key={it.title}
          className="rounded-md border border-border/60 bg-card p-5 shadow-(--shadow-paper) transition hover:shadow-(--shadow-paper-lifted)"
        >
          <h3 className="text-base font-medium text-foreground">{it.title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {it.body}
          </p>
        </article>
      ))}
    </section>
  );
}

function Footer() {
  return (
    <footer className="mt-auto border-t border-border/60 pt-5 text-xs text-muted-foreground">
      <div className="flex items-center justify-between">
        <span>Phase 1 · MVP · 纸张主题</span>
        <span>v0.0.1</span>
      </div>
    </footer>
  );
}
