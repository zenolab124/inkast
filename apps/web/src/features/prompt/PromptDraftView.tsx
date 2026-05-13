import { Sparkles, Lightbulb, Check, Plus, Loader2, ImagePlus } from "lucide-react";
import type { PromptDraft } from "@inkast/shared";
import { cn } from "../../lib/utils.js";
import { JsonTreeView } from "./JsonTreeView.js";

interface PromptDraftViewProps {
  draft: PromptDraft;
  meta?: { backend?: string; durationMs?: number };
  pending?: boolean;
  adoptedHints: Set<number>;
  onAdoptHint: (index: number) => void;
  generating?: boolean;
  onGenerate?: () => void;
}

export function PromptDraftView({
  draft,
  meta,
  pending,
  adoptedHints,
  onAdoptHint,
  generating,
  onGenerate,
}: PromptDraftViewProps) {
  const hasHints = draft.hints && draft.hints.length > 0;
  const allAdopted = hasHints && draft.hints.every((_, i) => adoptedHints.has(i));

  return (
    <div className={cn("relative grid grid-cols-1 gap-4 md:grid-cols-[1fr_320px]", pending && "opacity-60 pointer-events-none")}>
      {pending && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <div className="inline-flex items-center gap-2 rounded-md border border-border/60 bg-card px-3 py-1.5 text-sm text-muted-foreground shadow-(--shadow-paper-lifted)">
            <Loader2 className="size-4 animate-spin" strokeWidth={1.75} />
            重新起草中…
          </div>
        </div>
      )}

      <section className="rounded-md border border-border/60 bg-card p-5 shadow-(--shadow-paper)">
        <header className="mb-4 flex items-center justify-between gap-2 border-b border-border/60 pb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" strokeWidth={1.5} />
            <h2 className="text-sm font-medium tracking-wide">结构化 prompt</h2>
          </div>
          <div className="flex items-center gap-3">
            {meta && (
              <span className="text-xs text-muted-foreground">
                {meta.backend}
                {meta.durationMs ? ` · ${(meta.durationMs / 1000).toFixed(1)}s` : ""}
              </span>
            )}
            {onGenerate && (
              <button
                onClick={onGenerate}
                disabled={generating || pending}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground",
                  "shadow-(--shadow-paper) transition",
                  "hover:shadow-(--shadow-paper-lifted)",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                )}
              >
                {generating ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" strokeWidth={1.75} />
                    生图中…
                  </>
                ) : (
                  <>
                    <ImagePlus className="size-3.5" strokeWidth={1.75} />
                    生图
                  </>
                )}
              </button>
            )}
          </div>
        </header>
        <JsonTreeView data={draft.prompt} />
      </section>

      <aside className="flex flex-col rounded-md border border-border/60 bg-card p-5 shadow-(--shadow-paper)">
        <header className="mb-4 flex items-center justify-between gap-2 border-b border-border/60 pb-3">
          <div className="flex items-center gap-2">
            <Lightbulb className="size-4 text-accent" strokeWidth={1.5} />
            <h2 className="text-sm font-medium tracking-wide">补一补会更准</h2>
          </div>
          {hasHints && (
            <span className="text-xs text-muted-foreground">
              {adoptedHints.size}/{draft.hints.length}
            </span>
          )}
        </header>

        {hasHints ? (
          <>
            <ol className="flex flex-col gap-4">
              {draft.hints.map((hint, i) => {
                const adopted = adoptedHints.has(i);
                return (
                  <li key={i} className="flex gap-3">
                    <span
                      className={cn(
                        "mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-xs font-medium",
                        adopted
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary text-secondary-foreground",
                      )}
                    >
                      {adopted ? <Check className="size-3" strokeWidth={2.5} /> : i + 1}
                    </span>
                    <div className="flex-1 space-y-1.5">
                      <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        {hint.field}
                      </div>
                      <p
                        className={cn(
                          "text-sm leading-relaxed",
                          adopted ? "text-muted-foreground line-through decoration-1" : "text-foreground/90",
                        )}
                      >
                        {hint.suggestion}
                      </p>
                      {!adopted && (
                        <button
                          type="button"
                          onClick={() => onAdoptHint(i)}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-sm border border-border/60 bg-background px-2 py-0.5 text-xs text-muted-foreground transition",
                            "hover:text-foreground hover:shadow-(--shadow-paper)",
                          )}
                        >
                          <Plus className="size-3" strokeWidth={2} />
                          采纳,追加到输入
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
            {allAdopted && (
              <div className="mt-4 rounded-sm border border-primary/30 bg-primary/5 p-3 text-xs leading-relaxed text-muted-foreground">
                建议都采纳了 — 输入区已经累积了补充内容,点上方"重新起草"看精修后的版本。
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            没有发现明显模糊点,prompt 已经够具体了。
          </p>
        )}
      </aside>
    </div>
  );
}
