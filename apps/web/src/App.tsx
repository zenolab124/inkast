import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Feather,
  ImageIcon,
  Languages,
  Settings,
  Sparkles,
  X,
} from "lucide-react";
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
import { PromptComposer, type LockMode } from "./features/prompt/PromptComposer.js";
import { PromptFieldEditor } from "./features/prompt/PromptFieldEditor.js";
import { draftPrompt, type DraftPromptError } from "./features/prompt/api.js";
import { ProviderConfigDialog } from "./features/config/ProviderConfigDialog.js";
import { GalleryPage } from "./features/gallery/GalleryPage.js";
import { SessionWorkspace } from "./features/workspace/SessionWorkspace.js";
import { useJobs } from "./features/jobs/useJobs.js";

const EMPTY_PROMPT: ImagePrompt = { type: "", style: "", subject: "" };

type AppTab = "draft" | "gallery";

interface FlashMessage {
  kind: "success" | "error";
  text: string;
}

export function App() {
  const { t, lang } = useLanguage();
  const [dark, setDark] = useState(false);
  const [tab, setTab] = useState<AppTab>("draft");

  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<ImagePrompt>(EMPTY_PROMPT);
  const [aiSuggested, setAiSuggested] = useState<Set<string>>(new Set());
  const [meta, setMeta] = useState<
    { backend?: string; durationMs?: number } | undefined
  >();
  const [flash, setFlash] = useState<FlashMessage | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [referenceImage, setReferenceImage] = useState<ReferenceImage | null>(null);
  const [lockMode, setLockMode] = useState<LockMode>(null);
  const [sessionGenerationIds, setSessionGenerationIds] = useState<string[]>([]);
  const [galleryKey, setGalleryKey] = useState(0);
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
      if (job.generationId) {
        setSessionGenerationIds(prev =>
          prev.includes(job.generationId!) ? prev : [job.generationId!, ...prev],
        );
      }
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

  const expanded = lockMode !== null;

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
      setLockMode("ai-filled");
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

  const skipText = useCallback(() => {
    setPrompt(EMPTY_PROMPT);
    setAiSuggested(new Set());
    setMeta(undefined);
    setLockMode("m2");
  }, []);

  const unlock = useCallback(() => {
    setLockMode(null);
  }, []);

  const reuseFromHistory = useCallback(
    (record: GenerationRecord) => {
      setPrompt(record.promptSnapshot);
      setAiSuggested(new Set());
      setMeta({ durationMs: record.durationMs ?? undefined });
      setLockMode("ai-filled");
      setFlash({ kind: "success", text: t.flash.reuseLoaded });
      setTab("draft");
    },
    [t],
  );

  // ⌘E / Ctrl+E to enter M2 (skip text)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "e") {
        e.preventDefault();
        if (tab === "draft" && !expanded) skipText();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tab, expanded, skipText]);

  return (
    <div
      className={cn(
        "theme-paper relative flex h-screen flex-col overflow-hidden",
        dark && "dark",
      )}
    >
      <div className="relative z-10 mx-auto flex h-full w-full max-w-[1500px] flex-col gap-3 px-6 py-4">
        <Header
          tab={tab}
          onTab={setTab}
          dark={dark}
          onToggleDark={() => setDark(d => !d)}
          onOpenConfig={() => setConfigOpen(true)}
          backToDraft={tab === "draft" && lockMode === "m2" ? unlock : undefined}
        />

        {(error || flash) && tab === "draft" && (
          <div className="flex flex-col gap-2">
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
          </div>
        )}

        {tab === "draft" && (
          <div
            className={cn(
              "grid min-h-0 flex-1 gap-3 transition-[grid-template-columns] duration-300 ease-out",
              expanded
                ? "grid-cols-[0.42fr_1.4fr_0.6fr]"
                : "grid-cols-[1.4fr_0.42fr_0.6fr]",
            )}
          >
            <section className="min-h-0 overflow-y-auto rounded-md border border-border/60 bg-card p-4 shadow-(--shadow-paper)">
              <PromptComposer
                value={input}
                onChange={setInput}
                pending={pending}
                onExpand={aiFill}
                onCancel={cancel}
                onGenerateRaw={generateRaw}
                generatingRaw={false}
                onSkipText={skipText}
                lockMode={lockMode}
                onUnlock={unlock}
                referenceImage={referenceImage}
                onReferenceImageChange={setReferenceImage}
              />
            </section>

            <section className="flex min-h-0 flex-col overflow-y-auto rounded-md border border-border/60 bg-card p-4 shadow-(--shadow-paper)">
              <PromptFieldEditor
                value={prompt}
                onChange={handlePromptChange}
                aiSuggestedFields={aiSuggested}
                meta={meta}
                pending={pending}
                generating={false}
                onGenerate={expanded ? generate : undefined}
                collapsed={!expanded}
              />
            </section>

            <section className="min-h-0 overflow-y-auto rounded-md border border-border/60 bg-card p-4 shadow-(--shadow-paper)">
              <SessionWorkspace
                sessionGenerationIds={sessionGenerationIds}
                activeJobs={activeJobs}
                onReuse={reuseFromHistory}
              />
            </section>
          </div>
        )}

        {tab === "gallery" && (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <GalleryPage refreshKey={galleryKey} onReuse={reuseFromHistory} />
          </div>
        )}

        <Footer />
      </div>

      <ProviderConfigDialog
        open={configOpen}
        onClose={() => setConfigOpen(false)}
      />
    </div>
  );
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
  tab,
  onTab,
  dark,
  onToggleDark,
  onOpenConfig,
  backToDraft,
}: {
  tab: AppTab;
  onTab: (t: AppTab) => void;
  dark: boolean;
  onToggleDark: () => void;
  onOpenConfig: () => void;
  backToDraft?: () => void;
}) {
  const { t, lang, setLang } = useLanguage();
  return (
    <header className="flex items-center justify-between border-b border-border/60 pb-4">
      <div className="flex items-center gap-3">
        <Feather className="size-5 text-primary" strokeWidth={1.5} />
        <span className="text-xl font-medium tracking-tight">{t.app.title}</span>
        <span className="ml-2 hidden text-xs text-muted-foreground sm:inline">
          {t.app.tagline}
        </span>

        <nav className="ml-6 flex items-center gap-1">
          <TabButton
            active={tab === "draft"}
            onClick={() => onTab("draft")}
            icon={<Sparkles className="size-3.5" strokeWidth={1.5} />}
          >
            {t.tabs.draft}
          </TabButton>
          <TabButton
            active={tab === "gallery"}
            onClick={() => onTab("gallery")}
            icon={<ImageIcon className="size-3.5" strokeWidth={1.5} />}
          >
            {t.tabs.gallery}
          </TabButton>
        </nav>
      </div>
      <div className="flex items-center gap-2">
        {backToDraft && (
          <Button
            variant="outline"
            size="sm"
            onClick={backToDraft}
            className="border-accent/40 text-accent hover:bg-accent/10 hover:text-accent"
          >
            {t.composer.backToDraft}
          </Button>
        )}
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

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition",
        active
          ? "bg-card text-foreground shadow-(--shadow-paper) border border-border/60"
          : "text-muted-foreground hover:bg-secondary hover:text-foreground",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function Footer() {
  return (
    <footer className="mt-auto border-t border-border/60 pt-4 text-xs text-muted-foreground">
      <div className="flex items-center justify-between">
        <span>Phase 1 · MVP</span>
        <span>v0.0.1</span>
      </div>
    </footer>
  );
}
