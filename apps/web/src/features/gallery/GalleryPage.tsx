import { useEffect, useMemo, useState } from "react";
import { Download, ImageIcon, Loader2, RefreshCw, Search } from "lucide-react";
import type { GenerationRecord } from "@inkast/shared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLanguage } from "@/i18n/LanguageContext";
import { cn } from "@/lib/utils";
import { generationImageUrl, listGenerations } from "./api.js";
import { GalleryDetailDialog } from "./GalleryDetailDialog.js";

interface Props {
  refreshKey: number;
  onReuse?: (record: GenerationRecord) => void;
}

export function GalleryPage({ refreshKey, onReuse }: Props) {
  const { t } = useLanguage();
  const [items, setItems] = useState<GenerationRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [openRecord, setOpenRecord] = useState<GenerationRecord | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    listGenerations(200)
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

  const types = useMemo(() => {
    if (!items) return [];
    const counts = new Map<string, number>();
    for (const it of items) {
      const typ = stringify(it.promptSnapshot.type);
      if (!typ) continue;
      counts.set(typ, (counts.get(typ) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [items]);

  const filtered = useMemo(() => {
    if (!items) return [];
    const q = query.trim().toLowerCase();
    return items.filter(it => {
      const typ = stringify(it.promptSnapshot.type);
      const style = stringify(it.promptSnapshot.style);
      const subject = stringify(it.promptSnapshot.subject);
      if (typeFilter && typ !== typeFilter) return false;
      if (q && !(typ.toLowerCase().includes(q) || style.toLowerCase().includes(q) || subject.toLowerCase().includes(q)))
        return false;
      return true;
    });
  }, [items, query, typeFilter]);

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

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 rounded-md border border-border/50 bg-background/50 px-4 py-2.5">
        <h2 className="m-0 text-sm font-medium">{t.gallery.title}</h2>
        <span className="text-xs text-muted-foreground">· {items.length}</span>
        <div className="relative ml-2 max-w-md flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            strokeWidth={1.5}
          />
          <Input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t.galleryPage.searchPlaceholder}
            className="h-8 pl-7 text-xs"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <FilterChip
            label={t.galleryPage.filterAll}
            active={typeFilter === ""}
            onClick={() => setTypeFilter("")}
          />
          {types.map(([typ, n]) => (
            <FilterChip
              key={typ}
              label={`${typ} · ${n}`}
              active={typeFilter === typ}
              onClick={() => setTypeFilter(typ)}
            />
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border/60 p-12 text-sm text-muted-foreground">
          <ImageIcon className="size-7 opacity-40" strokeWidth={1.5} />
          {items.length === 0 ? t.galleryPage.empty : "—"}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {filtered.map(it => (
            <GalleryCard
              key={it.id}
              record={it}
              onReuse={onReuse}
              onOpen={() => setOpenRecord(it)}
            />
          ))}
        </div>
      )}

      <GalleryDetailDialog
        record={openRecord}
        onClose={() => setOpenRecord(null)}
        onReuse={onReuse}
      />
    </section>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border border-border/50 bg-card px-2.5 py-0.5 text-[11px] transition",
        active
          ? "border-transparent bg-primary text-primary-foreground"
          : "text-muted-foreground hover:text-foreground hover:bg-secondary",
      )}
    >
      {label}
    </button>
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
  const subjectText = stringify(record.promptSnapshot.subject);
  const typeLabel = stringify(record.promptSnapshot.type);
  const styleLabel = stringify(record.promptSnapshot.style);

  return (
    <article
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-md border border-border/60 bg-card shadow-(--shadow-paper)",
        "transition hover:shadow-(--shadow-paper-lifted)",
      )}
    >
      <Button
        type="button"
        variant="ghost"
        onClick={onOpen}
        title={t.gallery.openDetail}
        className="aspect-square h-auto w-full overflow-hidden rounded-none bg-background p-0 hover:bg-background"
      >
        <img
          src={url}
          alt={subjectText || typeLabel || "image"}
          loading="lazy"
          className="size-full object-cover transition group-hover:scale-[1.02]"
        />
      </Button>
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
          <span
            className="line-clamp-2 text-xs leading-snug text-muted-foreground"
            title={subjectText}
          >
            {subjectText}
          </span>
        )}
        <div className="mt-1 flex items-center justify-end gap-1">
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
      </div>
    </article>
  );
}

function stringify(val: unknown): string {
  if (val == null) return "";
  if (typeof val === "string") return val;
  if (typeof val === "object") {
    const desc = (val as { description?: unknown }).description;
    if (typeof desc === "string") return desc;
    return JSON.stringify(val);
  }
  return String(val);
}
