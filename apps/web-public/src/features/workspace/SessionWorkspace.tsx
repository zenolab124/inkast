import { useEffect, useState } from "react";
import { Download, ImageIcon, Loader2, RefreshCw } from "lucide-react";
import type { GenerationRecord, JobRecord } from "@inkast/shared";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/i18n/LanguageContext";
import { cn } from "@/lib/utils";
import { generationImageUrl, listGenerations } from "@/features/gallery/api.js";

interface Props {
  sessionGenerationIds: string[];
  activeJobs: JobRecord[];
  onReuse?: (record: GenerationRecord) => void;
}

export function SessionWorkspace({
  sessionGenerationIds,
  activeJobs,
  onReuse,
}: Props) {
  const { t } = useLanguage();
  const [records, setRecords] = useState<GenerationRecord[]>([]);

  useEffect(() => {
    if (sessionGenerationIds.length === 0) {
      setRecords([]);
      return;
    }
    let cancelled = false;
    listGenerations(100)
      .then(all => {
        if (cancelled) return;
        const idSet = new Set(sessionGenerationIds);
        const found = all.filter(r => idSet.has(r.id));
        const ordered = sessionGenerationIds
          .map(id => found.find(r => r.id === id))
          .filter((r): r is GenerationRecord => r != null);
        setRecords(ordered);
      })
      .catch(err => {
        console.error("[workspace] listGenerations failed:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionGenerationIds]);

  const activeCount = activeJobs.length;
  const doneCount = records.length;
  const isEmpty = doneCount === 0 && activeCount === 0;

  return (
    <div className="flex h-full flex-col gap-3">
      <header className="flex items-baseline justify-between">
        <h3 className="text-sm font-medium tracking-wide">
          {t.workspace.title}
        </h3>
        <span className="text-[10.5px] text-muted-foreground">
          {activeCount + doneCount > 0
            ? activeCount > 0
              ? `${activeCount} ${t.workspace.activeLabel} · ${doneCount}${t.workspace.countSuffix}`
              : `${doneCount}${t.workspace.countSuffix}`
            : t.workspace.refreshNote}
        </span>
      </header>

      {isEmpty ? (
        <EmptyState />
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {activeJobs.map(job => (
            <LoadingTile key={`job-${job.id}`} job={job} />
          ))}
          {records.map(record => (
            <Tile key={record.id} record={record} onReuse={onReuse} />
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  const { t } = useLanguage();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border/60 p-5 text-center text-[11px] leading-relaxed text-muted-foreground">
      <ImageIcon className="size-6 opacity-40" strokeWidth={1.5} />
      <p className="m-0">{t.workspace.empty}</p>
      <p className="m-0 text-[10px]">{t.workspace.emptyTip}</p>
    </div>
  );
}

function LoadingTile({ job }: { job: JobRecord }) {
  const { t } = useLanguage();
  const elapsed = useElapsedSeconds(job.startedAt ?? job.createdAt);
  return (
    <article
      className="group relative flex aspect-square flex-col overflow-hidden rounded-md border border-primary/30 bg-primary/5 shadow-(--shadow-paper)"
      title={job.promptText}
    >
      <div className="flex flex-1 items-center justify-center">
        <Loader2
          className="size-6 animate-spin text-primary"
          strokeWidth={1.75}
        />
      </div>
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-card/80 px-2 py-1 text-[9.5px] tabular-nums text-muted-foreground backdrop-blur-sm">
        <span className="uppercase tracking-wider">
          {job.status === "running"
            ? t.jobs.statusRunning
            : t.jobs.statusPending}
        </span>
        <span>{elapsed}s</span>
      </div>
    </article>
  );
}

function useElapsedSeconds(startMs: number): number {
  const [seconds, setSeconds] = useState(() =>
    Math.max(0, Math.floor((Date.now() - startMs) / 1000)),
  );
  useEffect(() => {
    const t = setInterval(() => {
      setSeconds(Math.max(0, Math.floor((Date.now() - startMs) / 1000)));
    }, 1000);
    return () => clearInterval(t);
  }, [startMs]);
  return seconds;
}

function Tile({
  record,
  onReuse,
}: {
  record: GenerationRecord;
  onReuse?: (record: GenerationRecord) => void;
}) {
  const { t } = useLanguage();
  const url = generationImageUrl(record.id);
  return (
    <article
      className={cn(
        "group relative flex aspect-square flex-col overflow-hidden rounded-md border border-border/60 bg-card shadow-(--shadow-paper)",
      )}
    >
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="block size-full overflow-hidden bg-background"
        title={t.gallery.openDetail}
      >
        <img
          src={url}
          alt={String(record.promptSnapshot.type ?? "image")}
          loading="lazy"
          className="size-full object-cover transition group-hover:scale-[1.02]"
        />
      </a>
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-end gap-0.5 bg-card/85 px-1 py-0.5 opacity-0 backdrop-blur-sm transition group-hover:opacity-100">
        {onReuse && (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => onReuse(record)}
            title={t.gallery.reuse}
            className="text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <RefreshCw strokeWidth={1.75} />
          </Button>
        )}
        <Button
          asChild
          variant="ghost"
          size="icon-xs"
          title={t.gallery.download}
          className="text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <a href={url} download={`inkast-${record.id}.${record.imageFormat}`}>
            <Download strokeWidth={1.75} />
          </a>
        </Button>
      </div>
    </article>
  );
}
