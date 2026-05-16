import { useEffect, useState } from "react";
import { Download, ImageIcon, Loader2, RefreshCw } from "lucide-react";
import type { GenerationRecord } from "@inkast/shared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/i18n/LanguageContext";
import { cn } from "@/lib/utils";
import { generationImageUrl, listGenerations } from "./api.js";
import { GalleryDetailDialog } from "./GalleryDetailDialog.js";

interface GalleryProps {
  refreshKey: number;
  onReuse?: (record: GenerationRecord) => void;
}

export function Gallery({ refreshKey, onReuse }: GalleryProps) {
  const { t } = useLanguage();
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
      <Alert variant="destructive" className="rounded-md">
        <AlertTitle>{t.gallery.loadError}</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (items === null) {
    return (
      <section className="flex items-center gap-2 rounded-md border border-border/60 bg-card p-5 text-sm text-muted-foreground shadow-(--shadow-paper)">
        <Loader2 className="size-4 animate-spin" strokeWidth={1.75} />
        {t.gallery.loading}
      </section>
    );
  }

  if (items.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-center gap-2">
        <ImageIcon className="size-4 text-primary" strokeWidth={1.5} />
        <h2 className="text-sm font-medium tracking-wide">{t.gallery.title}</h2>
        <span className="text-xs text-muted-foreground">· {items.length}</span>
      </header>
      <div className="columns-2 gap-3 sm:columns-3 md:columns-4 lg:columns-5 xl:columns-6">
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
  const { t } = useLanguage();
  const url = generationImageUrl(record.id);
  const subjectText = stringifyMaybeObject(record.promptSnapshot.subject);
  const typeLabel = String(record.promptSnapshot.type ?? "");
  const styleLabel = String(record.promptSnapshot.style ?? "");

  return (
    <article
      className={cn(
        "group relative mb-3 flex break-inside-avoid flex-col overflow-hidden rounded-md border border-border/60 bg-card shadow-(--shadow-paper)",
        "transition hover:shadow-(--shadow-paper-lifted)",
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        title={t.gallery.openDetail}
        className="block w-full overflow-hidden bg-background p-0"
      >
        <img
          src={url}
          alt={subjectText || typeLabel || "image"}
          loading="lazy"
          className="block w-full transition group-hover:scale-[1.02]"
        />
      </button>
      <div className="flex flex-col gap-0.5 px-2.5 py-2">
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          {typeLabel && (
            <span className="font-semibold uppercase tracking-wider text-foreground/75">
              {typeLabel}
            </span>
          )}
          {typeLabel && styleLabel && <span className="opacity-40">·</span>}
          {styleLabel && (
            <span className="line-clamp-1" title={styleLabel}>
              {styleLabel}
            </span>
          )}
        </div>
        {subjectText && (
          <span
            className="line-clamp-2 text-[11px] leading-snug text-foreground/85"
            title={subjectText}
          >
            {subjectText}
          </span>
        )}
        <div className="mt-0.5 flex items-center justify-end gap-0.5 opacity-0 transition group-hover:opacity-100">
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
            <a
              href={url}
              download={`inkast-${record.id}.${record.imageFormat}`}
            >
              <Download strokeWidth={1.75} />
            </a>
          </Button>
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
