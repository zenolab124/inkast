import { useCallback, useRef, useState } from "react";
import { Feather, AlertCircle, Settings, CheckCircle2, X, Languages } from "lucide-react";
import type {
  GenerationRecord,
  ImagePrompt,
  JobRecord,
  PromptDraft,
  ReferenceImage,
} from "@inkast/shared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/i18n/LanguageContext";
import { cn } from "@/lib/utils";
import { PromptComposer } from "./features/prompt/PromptComposer.js";
import { PromptFieldEditor } from "./features/prompt/PromptFieldEditor.js";
import { draftPrompt, type DraftPromptError } from "./features/prompt/api.js";
import { ProviderConfigDialog } from "./features/config/ProviderConfigDialog.js";
import { Gallery } from "./features/gallery/Gallery.js";
import { ActiveJobs } from "./features/jobs/ActiveJobs.js";
import { useJobs } from "./features/jobs/useJobs.js";

const EMPTY_PROMPT: ImagePrompt = { type: "", style: "", subject: "" };

interface FlashMessage {
  kind: "success" | "error";
  text: string;
}

export function App() {
  const { t, lang } = useLanguage();
  const [dark, setDark] = useState(false);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<ImagePrompt>(EMPTY_PROMPT);
  const [aiSuggested, setAiSuggested] = useState<Set<string>>(new Set());
  const [meta, setMeta] = useState<
    { backend?: string; durationMs?: number } | undefined
  >();
  const [galleryKey, setGalleryKey] = useState(0);
  const [flash, setFlash] = useState<FlashMessage | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [referenceImage, setReferenceImage] = useState<ReferenceImage | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const onJobSucceeded = useCallback(
    (job: JobRecord) => {
      const head = `${t.flash.generateDone} · ${(((job.completedAt ?? Date.now()) - (job.startedAt ?? job.createdAt)) / 1000).toFixed(1)}s`;
      const fallbacks = job.attempts.filter(a => !a.ok);
      const trail = fallbacks.length
        ? "\n" + fallbacks
            .map(a => `  · ${t.flash.skipped} ${a.providerName} (${a.errorCode ?? "?"})`)
            .join("\n")
        : "";
      setFlash({ kind: "success", text: head + trail });
      setGalleryKey(k => k + 1);
    },
    [t],
  );

  const onJobFailed = useCallback(
    (job: JobRecord) => {
      const isNoProvider = job.errorCode === "no_providers";
      const attemptDetails = job.attempts.length
        ? "\n" +
          job.attempts
            .map(
              a =>
                `  · ${a.providerName} (${a.errorCode ?? "?"}): ${
                  a.errorMessage ?? "(no detail)"
                }`,
            )
            .join("\n")
        : "";
      setFlash({
        kind: "error",
        text: isNoProvider
          ? t.flash.noProvider
          : `${job.errorMessage ?? job.errorCode ?? "unknown error"}${attemptDetails}`,
      });
      if (isNoProvider) setConfigOpen(true);
    },
    [t],
  );

  const { activeJobs, submitJob } = useJobs({
    onSucceeded: onJobSucceeded,
    onFailed: onJobFailed,
  });

  const hasFilled = !isEmptyPrompt(prompt);

  const aiFill = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed) return;

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setPending(true);
    setError(null);

    try {
      const resp = (await draftPrompt(
        { input: trimmed, lang },
        ac.signal,
      )) as PromptDraft & {
        _meta?: { backend?: string; durationMs?: number };
      };
      setPrompt(resp.prompt);
      setAiSuggested(computeAiFields(resp.prompt));
      setMeta(resp._meta);
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
  }, [input, lang]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPending(false);
  }, []);

  const handlePromptChange = useCallback(
    (next: ImagePrompt) => {
      if (aiSuggested.size > 0) {
        const changedKeys = diffKeys(prompt, next);
        if (changedKeys.length > 0) {
          const updated = new Set(aiSuggested);
          let mutated = false;
          for (const k of changedKeys) {
            if (updated.delete(k)) mutated = true;
          }
          if (mutated) setAiSuggested(updated);
        }
      }
      setPrompt(next);
    },
    [aiSuggested, prompt],
  );

  const generate = useCallback(async () => {
    setFlash(null);
    try {
      await submitJob({
        prompt,
        referenceImage: referenceImage ?? undefined,
      });
    } catch (err) {
      const e = err as { message?: string };
      setFlash({ kind: "error", text: e?.message ?? String(err) });
    }
  }, [prompt, referenceImage, submitJob]);

  const generateRaw = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    setFlash(null);
    const placeholder: ImagePrompt = { type: "raw", style: "", subject: trimmed };
    try {
      await submitJob({
        prompt: placeholder,
        rawPrompt: trimmed,
        referenceImage: referenceImage ?? undefined,
      });
    } catch (err) {
      const e = err as { message?: string };
      setFlash({ kind: "error", text: e?.message ?? String(err) });
    }
  }, [input, referenceImage, submitJob]);

  const reuseFromHistory = useCallback(
    (record: GenerationRecord) => {
      setPrompt(record.promptSnapshot);
      setAiSuggested(new Set());
      setMeta({ durationMs: record.durationMs ?? undefined });
      setFlash({ kind: "success", text: t.flash.reuseLoaded });
    },
    [t],
  );

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
            hasFilled={hasFilled}
            onSubmit={aiFill}
            onCancel={cancel}
            onGenerateRaw={generateRaw}
            generatingRaw={false}
            referenceImage={referenceImage}
            onReferenceImageChange={setReferenceImage}
          />
        </section>

        {error && (
          <Banner
            kind="error"
            title={t.banner.aiFillFailed}
            message={error}
            onClose={() => setError(null)}
          />
        )}
        {flash && (
          <Banner
            kind={flash.kind}
            title={flash.kind === "success" ? t.banner.ok : t.banner.generateFailed}
            message={flash.text}
            onClose={() => setFlash(null)}
          />
        )}

        <ActiveJobs jobs={activeJobs} />

        <PromptFieldEditor
          value={prompt}
          onChange={handlePromptChange}
          aiSuggestedFields={aiSuggested}
          meta={meta}
          pending={pending}
          generating={false}
          onGenerate={generate}
        />

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

function isEmptyPrompt(p: ImagePrompt): boolean {
  return !p.type && !p.style && !p.subject;
}

function computeAiFields(p: ImagePrompt): Set<string> {
  const out = new Set<string>();
  for (const [k, v] of Object.entries(p)) {
    if (v == null) continue;
    if (typeof v === "string" && v.length > 0) out.add(k);
    else if (Array.isArray(v) && v.length > 0) out.add(k);
    else if (typeof v === "number" || typeof v === "boolean") out.add(k);
  }
  return out;
}

function diffKeys(prev: ImagePrompt, next: ImagePrompt): string[] {
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  const changed: string[] = [];
  for (const k of keys) {
    const a = (prev as Record<string, unknown>)[k];
    const b = (next as Record<string, unknown>)[k];
    if (!shallowEqual(a, b)) changed.push(k);
  }
  return changed;
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!shallowEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    if (ka.length !== kb.length) return false;
    for (const k of ka) {
      if (
        !shallowEqual(
          (a as Record<string, unknown>)[k],
          (b as Record<string, unknown>)[k],
        )
      )
        return false;
    }
    return true;
  }
  return false;
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
  const { t } = useLanguage();
  const Icon = kind === "success" ? CheckCircle2 : AlertCircle;
  return (
    <Alert
      variant={kind === "error" ? "destructive" : "default"}
      className={cn(
        "relative rounded-md pr-10",
        kind === "success" && "border-primary/30 bg-primary/5",
      )}
    >
      <Icon
        className={kind === "success" ? "text-primary" : "text-destructive"}
        strokeWidth={1.75}
      />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed">
          {message}
        </pre>
      </AlertDescription>
      {onClose && (
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onClose}
          className="absolute right-2 top-2 text-muted-foreground"
          aria-label={t.banner.close}
        >
          <X strokeWidth={1.75} />
        </Button>
      )}
    </Alert>
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
  const { t, lang, setLang } = useLanguage();
  return (
    <header className="flex items-center justify-between border-b border-border/60 pb-5">
      <div className="flex items-center gap-3">
        <Feather className="size-5 text-primary" strokeWidth={1.5} />
        <span className="text-xl font-medium tracking-tight">{t.app.title}</span>
        <span className="ml-2 hidden text-xs text-muted-foreground sm:inline">
          {t.app.tagline}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setLang(lang === "zh" ? "en" : "zh")}
          title={lang === "zh" ? "Switch to English" : "切换到中文"}
          className="text-muted-foreground hover:text-foreground"
        >
          <Languages strokeWidth={1.5} />
          {lang === "zh" ? t.header.langEn : t.header.langZh}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onOpenConfig}
          title={t.header.config}
          className="text-muted-foreground hover:text-foreground"
        >
          <Settings strokeWidth={1.5} />
          {t.header.config}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onToggleDark}
          className="text-muted-foreground hover:text-foreground"
        >
          {dark ? t.header.light : t.header.dark}
        </Button>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="mt-auto border-t border-border/60 pt-5 text-xs text-muted-foreground">
      <div className="flex items-center justify-between">
        <span>Phase 1 · MVP</span>
        <span>v0.0.1</span>
      </div>
    </footer>
  );
}
