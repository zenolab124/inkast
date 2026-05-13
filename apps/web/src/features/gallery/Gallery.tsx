import { useEffect, useState } from "react";
import { Download, ImageIcon, Loader2, RefreshCw } from "lucide-react";
import type { GenerationRecord } from "@inkast/shared";
import { cn } from "../../lib/utils.js";
import { generationImageUrl, listGenerations } from "./api.js";
import { GalleryDetailDialog } from "./GalleryDetailDialog.js";

interface GalleryProps {
  refreshKey: number;
  onReuse?: (record: GenerationRecord) => void;
}

export function Gallery({ refreshKey, onReuse }: GalleryProps) {
  const [items, setItems] = useState<GenerationRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openRecord, setOpenRecord] = useState<GenerationRecord | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    listGenerations()
      .then(list => {
        if (!cancelled) setItems(list);
      })
      .catch(err => {
        if (!cancelled) setError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  if (error) {
    return (
      <section className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        加载历史失败:{error}
      </section>
    );
  }

  if (items === null) {
    return (
      <section className="flex items-center gap-2 rounded-md border border-border/60 bg-card p-5 text-sm text-muted-foreground shadow-(--shadow-paper)">
        <Loader2 className="size-4 animate-spin" strokeWidth={1.75} />
        加载历史…
      </section>
    );
  }

  if (items.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-center gap-2">
        <ImageIcon className="size-4 text-primary" strokeWidth={1.5} />
        <h2 className="text-sm font-medium tracking-wide">作品</h2>
        <span className="text-xs text-muted-foreground">· {items.length}</span>
      </header>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {items.map(it => (
          <GalleryCard
            key={it.id}
            record={it}
            onReuse={onReuse}
            onOpen={() => setOpenRecord(it)}
          />
        ))}
      </div>
      <GalleryDetailDialog
        record={openRecord}
        onClose={() => setOpenRecord(null)}
        onReuse={onReuse}
      />
    </section>
  );
}

function GalleryCard({
  record,
  onReuse,
  onOpen,
}: {
  record: GenerationRecord;
  onReuse?: (record: GenerationRecord) => void;
  onOpen: () => void;
}) {
  const url = generationImageUrl(record.id);
  const subjectText = stringifyMaybeObject(record.promptSnapshot.subject);
  const typeLabel = String(record.promptSnapshot.type ?? "");
  const styleLabel = String(record.promptSnapshot.style ?? "");

  return (
    <article
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-md border border-border/60 bg-card shadow-(--shadow-paper)",
        "transition hover:shadow-(--shadow-paper-lifted)",
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        title="查看详情"
        className="aspect-square overflow-hidden bg-background"
      >
        <img
          src={url}
          alt={subjectText || typeLabel || "image"}
          loading="lazy"
          className="size-full object-cover transition group-hover:scale-[1.02]"
        />
      </button>
      <div className="flex flex-col gap-1 px-3 py-2.5">
        {typeLabel && (
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {typeLabel}
          </span>
        )}
        {styleLabel && (
          <span className="line-clamp-1 text-xs text-foreground/85" title={styleLabel}>
            {styleLabel}
          </span>
        )}
        {subjectText && (
          <span className="line-clamp-2 text-xs leading-snug text-muted-foreground" title={subjectText}>
            {subjectText}
          </span>
        )}
        <div className="mt-1 flex items-center justify-end gap-1">
          {onReuse && (
            <button
              onClick={() => onReuse(record)}
              title="复用这个 prompt"
              className="rounded-sm p-1 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
            >
              <RefreshCw className="size-3.5" strokeWidth={1.75} />
            </button>
          )}
          <a
            href={url}
            download={`inkast-${record.id}.${record.imageFormat}`}
            title="下载"
            className="rounded-sm p-1 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
          >
            <Download className="size-3.5" strokeWidth={1.75} />
          </a>
        </div>
      </div>
    </article>
  );
}

function stringifyMaybeObject(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const desc = (value as { description?: unknown }).description;
    if (typeof desc === "string") return desc;
    return JSON.stringify(value);
  }
  return String(value);
}
