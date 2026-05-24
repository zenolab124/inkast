import { useEffect, useMemo, useState } from "react";
import { ImageIcon, Loader2, RefreshCw, Search } from "lucide-react";
import Masonry from "react-masonry-css";
import type { PluginGalleryItem } from "@inkast/shared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLanguage } from "@/i18n/LanguageContext";
import { cn } from "@/lib/utils";
import { listPluginGallery } from "./api.js";

/** Same breakpoints as the main Gallery so column counts feel consistent. */
const MASONRY_BREAKPOINTS = {
  default: 6,
  1279: 5,
  1023: 4,
  767: 3,
  639: 2,
};

export function PluginGalleryPage() {
  const { t } = useLanguage();
  const [items, setItems] = useState<PluginGalleryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [pluginFilter, setPluginFilter] = useState<string>("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setItems(null);
    listPluginGallery(500)
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

  const pluginCounts = useMemo(() => {
    if (!items) return [];
    const counts = new Map<string, number>();
    for (const it of items) counts.set(it.pluginId, (counts.get(it.pluginId) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [items]);

  const filtered = useMemo(() => {
    if (!items) return [];
    const q = query.trim().toLowerCase();
    return items.filter(it => {
      if (pluginFilter && it.pluginId !== pluginFilter) return false;
      if (q && !it.prompt.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, query, pluginFilter]);

  if (error) {
    return (
      <Alert variant="destructive" className="rounded-md">
        <AlertTitle>载入失败</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (items === null) {
    return (
      <section className="flex items-center gap-2 rounded-md border border-border/60 bg-card p-5 text-sm text-muted-foreground shadow-(--shadow-paper)">
        <Loader2 className="size-4 animate-spin" strokeWidth={1.75} />
        Loading…
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 rounded-md border border-border/50 bg-background/50 px-4 py-2.5">
        <h2 className="m-0 text-sm font-medium">{t.tabs.pluginGallery}</h2>
        <span className="text-xs text-muted-foreground">· {items.length}</span>
        <span className="text-[11px] text-muted-foreground">
          (24h 内 · R2 链接)
        </span>
        <div className="relative ml-2 max-w-md flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            strokeWidth={1.5}
          />
          <Input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="搜索 prompt"
            className="h-8 pl-7 text-xs"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <FilterChip
            label="全部"
            active={pluginFilter === ""}
            onClick={() => setPluginFilter("")}
          />
          {pluginCounts.map(([pid, n]) => (
            <FilterChip
              key={pid}
              label={`${pid} · ${n}`}
              active={pluginFilter === pid}
              onClick={() => setPluginFilter(pid)}
            />
          ))}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setRefreshKey(k => k + 1)}
          className="ml-auto h-8 gap-1.5 px-2 text-xs"
        >
          <RefreshCw className="size-3.5" strokeWidth={1.75} />
          刷新
        </Button>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border/60 p-12 text-sm text-muted-foreground">
          <ImageIcon className="size-7 opacity-40" strokeWidth={1.5} />
          {items.length === 0 ? "暂无 plugin 通道作品(24h 滚动窗口)" : "—"}
        </div>
      ) : (
        <Masonry
          breakpointCols={MASONRY_BREAKPOINTS}
          className="-ml-3 flex w-auto"
          columnClassName="bg-clip-padding pl-3"
        >
          {filtered.map(it => (
            <PluginGalleryCard key={it.id} item={it} />
          ))}
        </Masonry>
      )}
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

function PluginGalleryCard({ item }: { item: PluginGalleryItem }) {
  const time = useMemo(() => {
    const d = new Date(item.createdAt);
    return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }, [item.createdAt]);

  // Truncate prompt for the card subtitle; full text is available in title tooltip.
  const promptPreview = useMemo(() => {
    const p = item.prompt.trim();
    return p.length > 90 ? p.slice(0, 90) + "…" : p;
  }, [item.prompt]);

  return (
    <article
      className={cn(
        "group relative mb-3 flex flex-col overflow-hidden rounded-md border border-border/60 bg-card shadow-(--shadow-paper)",
        "transition hover:shadow-(--shadow-paper-lifted)",
      )}
    >
      <a
        href={item.imageUrl}
        target="_blank"
        rel="noreferrer"
        className="block overflow-hidden bg-background"
        title={item.prompt}
      >
        <img
          src={item.imageUrl}
          alt={promptPreview || item.id}
          loading="lazy"
          className="block w-full transition group-hover:scale-[1.02]"
        />
      </a>
      <div className="flex flex-col gap-1 px-2.5 py-1.5">
        <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span className="truncate font-mono" title={item.pluginId}>
            {item.pluginId}
          </span>
          <span className="shrink-0 font-mono">{time}</span>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/80">
          {item.providerName && (
            <span className="rounded bg-secondary/60 px-1.5 py-0.5 font-mono">
              {item.providerName}
            </span>
          )}
          {item.imageDurationMs != null && (
            <span className="font-mono">{fmtMs(item.imageDurationMs)}</span>
          )}
        </div>
        {promptPreview && (
          <p
            className="line-clamp-2 text-[11px] leading-snug text-muted-foreground"
            title={item.prompt}
          >
            {promptPreview}
          </p>
        )}
      </div>
    </article>
  );
}

function fmtMs(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}
