import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ImageIcon, Loader2, RefreshCw, Search, Sparkles } from "lucide-react";
import Masonry from "react-masonry-css";
import type {
  PluginGalleryItem,
  PluginGalleryPluginCount,
} from "@inkast/shared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useLanguage } from "@/i18n/LanguageContext";
import { cn } from "@/lib/utils";
import { fetchPluginGallery } from "./api.js";

/** Same breakpoints as the main Gallery so column counts feel consistent. */
const MASONRY_BREAKPOINTS = {
  default: 6,
  1279: 5,
  1023: 4,
  767: 3,
  639: 2,
};

const PAGE_SIZE = 60;

interface PageState {
  items: PluginGalleryItem[];
  nextCursor: string | null;
  total: number;
  pluginCounts: PluginGalleryPluginCount[];
}

export function PluginGalleryPage() {
  const { t } = useLanguage();
  const [page, setPage] = useState<PageState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [pluginFilter, setPluginFilter] = useState<string>("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selected, setSelected] = useState<PluginGalleryItem | null>(null);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // Track the latest request token so a slow page-1 doesn't clobber a quick
  // filter change. Compared by value inside the async handler.
  const requestTokenRef = useRef(0);

  // First page (and reset on filter change / refresh).
  useEffect(() => {
    const token = ++requestTokenRef.current;
    setPage(null);
    setError(null);
    fetchPluginGallery({ limit: PAGE_SIZE, pluginId: pluginFilter || null })
      .then(resp => {
        if (token !== requestTokenRef.current) return;
        setPage({
          items: resp.items,
          nextCursor: resp.nextCursor,
          total: resp.total,
          pluginCounts: resp.pluginCounts,
        });
      })
      .catch(err => {
        if (token !== requestTokenRef.current) return;
        setError((err as Error).message);
      });
  }, [pluginFilter, refreshKey]);

  const loadMore = useCallback(async () => {
    if (!page || !page.nextCursor || loadingMore) return;
    setLoadingMore(true);
    const token = requestTokenRef.current;
    try {
      const resp = await fetchPluginGallery({
        limit: PAGE_SIZE,
        cursor: page.nextCursor,
        pluginId: pluginFilter || null,
      });
      if (token !== requestTokenRef.current) return;
      setPage(prev =>
        prev
          ? {
              items: [...prev.items, ...resp.items],
              nextCursor: resp.nextCursor,
              total: resp.total,
              pluginCounts: resp.pluginCounts,
            }
          : prev,
      );
    } catch (err) {
      if (token === requestTokenRef.current) {
        setError((err as Error).message);
      }
    } finally {
      setLoadingMore(false);
    }
  }, [page, loadingMore, pluginFilter]);

  // IntersectionObserver-driven infinite scroll. Watches the sentinel below the
  // grid; when it enters the viewport (or gets within `rootMargin`), kick the
  // next page. Re-binds whenever loadMore identity changes.
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            void loadMore();
          }
        }
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [loadMore]);

  const filteredItems = useMemo(() => {
    if (!page) return [];
    const q = query.trim().toLowerCase();
    if (!q) return page.items;
    // Note: search is client-side over the already-loaded pages only — there
    // is intentionally no server-side prompt FTS yet (DB cost would jump for
    // little gain at this size). Header copy reflects this.
    return page.items.filter(it => it.prompt.toLowerCase().includes(q));
  }, [page, query]);

  if (error) {
    return (
      <Alert variant="destructive" className="rounded-md">
        <AlertTitle>载入失败</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (page === null) {
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
        <span className="text-xs text-muted-foreground">
          · {page.items.length}/{page.total}
        </span>
        <span className="text-[11px] text-muted-foreground">
          (永久归档 · R2 链接)
        </span>
        <div className="relative ml-2 max-w-md flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            strokeWidth={1.5}
          />
          <Input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="搜索 prompt(仅当前已加载的页)"
            className="h-8 pl-7 text-xs"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <FilterChip
            label={`全部 · ${page.total}`}
            active={pluginFilter === ""}
            onClick={() => setPluginFilter("")}
          />
          {page.pluginCounts.map(({ pluginId, count }) => (
            <FilterChip
              key={pluginId}
              label={`${pluginId} · ${count}`}
              active={pluginFilter === pluginId}
              onClick={() => setPluginFilter(pluginId)}
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

      {filteredItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border/60 p-12 text-sm text-muted-foreground">
          <ImageIcon className="size-7 opacity-40" strokeWidth={1.5} />
          {page.items.length === 0 ? "暂无 plugin 通道作品" : "—"}
        </div>
      ) : (
        <>
          <Masonry
            breakpointCols={MASONRY_BREAKPOINTS}
            className="-ml-3 flex w-auto"
            columnClassName="bg-clip-padding pl-3"
          >
            {filteredItems.map(it => (
              <PluginGalleryCard
                key={it.id}
                item={it}
                onOpen={() => setSelected(it)}
              />
            ))}
          </Masonry>

          <div
            ref={sentinelRef}
            className="flex h-12 items-center justify-center text-[11px] text-muted-foreground"
          >
            {loadingMore && (
              <span className="flex items-center gap-1.5">
                <Loader2 className="size-3.5 animate-spin" strokeWidth={1.75} />
                加载更多…
              </span>
            )}
            {!loadingMore && !page.nextCursor && page.items.length > 0 && (
              <span>—— 已加载全部 ——</span>
            )}
          </div>
        </>
      )}

      <PluginGalleryDetailDialog
        item={selected}
        onOpenChange={open => {
          if (!open) setSelected(null);
        }}
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

const ROUND_LABELS: Record<0 | 1 | 2 | 3, string> = {
  0: "原始 prompt",
  1: "LLM 重写 R1",
  2: "指纹降级 R2",
  3: "色彩锚定 R3",
};

function PluginGalleryCard({
  item,
  onOpen,
}: {
  item: PluginGalleryItem;
  onOpen: () => void;
}) {
  const time = useMemo(() => {
    const d = new Date(item.createdAt);
    return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }, [item.createdAt]);

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
      <button
        type="button"
        onClick={onOpen}
        className="block overflow-hidden bg-background text-left"
        title={item.prompt}
      >
        <img
          src={item.imageUrl}
          alt={promptPreview || item.id}
          loading="lazy"
          className="block w-full transition group-hover:scale-[1.02]"
        />
      </button>
      <div className="flex flex-col gap-1 px-2.5 py-1.5">
        <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span className="truncate font-mono" title={item.pluginId}>
            {item.pluginId}
          </span>
          <span className="shrink-0 font-mono">{time}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1 text-[10px]">
          <RoundBadge round={item.successRound} />
          {item.postReviewEdited && <ReviewBadge />}
          {item.providerName && (
            <span className="rounded bg-secondary/60 px-1.5 py-0.5 font-mono text-muted-foreground/80">
              {item.providerName}
            </span>
          )}
          {item.imageDurationMs != null && (
            <span className="font-mono text-muted-foreground/70">
              {fmtMs(item.imageDurationMs)}
            </span>
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

function RoundBadge({ round }: { round: 0 | 1 | 2 | 3 }) {
  // Round 0 = caller's literal prompt won — celebrate it visually (primary
  // green). Other rounds = some form of rescue, muted tone.
  const accent =
    round === 0
      ? "bg-primary/15 text-primary border-primary/30"
      : "bg-accent/20 text-foreground/80 border-border";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono",
        accent,
      )}
      title="rewrite chain 中产出本图的回合"
    >
      R{round} · {ROUND_LABELS[round]}
    </span>
  );
}

function ReviewBadge() {
  return (
    <span
      className="inline-flex items-center gap-1 rounded border border-border bg-card px-1.5 py-0.5 font-mono text-muted-foreground"
      title="post-review-edit 二次润色替换了图片"
    >
      <Sparkles className="size-2.5" strokeWidth={2} />
      已润色
    </span>
  );
}

function fmtMs(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function PluginGalleryDetailDialog({
  item,
  onOpenChange,
}: {
  item: PluginGalleryItem | null;
  onOpenChange: (open: boolean) => void;
}) {
  if (!item) {
    return (
      <Dialog open={false} onOpenChange={onOpenChange}>
        <DialogContent />
      </Dialog>
    );
  }

  const createdAt = new Date(item.createdAt).toLocaleString("zh-CN", {
    hour12: false,
  });

  return (
    <Dialog open={!!item} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "flex h-[85vh] flex-col gap-0 overflow-hidden rounded-md p-0 sm:max-w-6xl",
        )}
      >
        <DialogHeader className="shrink-0 border-b border-border/60 px-5 py-3">
          <DialogTitle className="flex items-center gap-2 text-sm font-medium">
            <span className="font-mono">{item.pluginId}</span>
            <span className="text-xs text-muted-foreground">· {item.id}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_24rem]">
          <a
            href={item.imageUrl}
            target="_blank"
            rel="noreferrer"
            className="flex min-h-0 min-w-0 items-center justify-center overflow-hidden bg-background p-3"
            title="点击在新标签打开原图"
          >
            <img
              src={item.imageUrl}
              alt={item.prompt}
              className="max-h-full max-w-full object-contain"
            />
          </a>

          <aside className="flex min-h-0 flex-col gap-4 overflow-y-auto border-l border-border/60 p-5">
            <div className="flex flex-wrap gap-1.5 text-[11px]">
              <RoundBadge round={item.successRound} />
              {item.postReviewEdited && <ReviewBadge />}
              {item.providerName && (
                <span className="rounded border border-border bg-card px-1.5 py-0.5 font-mono text-muted-foreground">
                  {item.providerName}
                </span>
              )}
              {item.llmDurationMs != null && (
                <span className="rounded border border-border bg-card px-1.5 py-0.5 font-mono text-muted-foreground">
                  LLM {fmtMs(item.llmDurationMs)}
                </span>
              )}
              {item.imageDurationMs != null && (
                <span className="rounded border border-border bg-card px-1.5 py-0.5 font-mono text-muted-foreground">
                  img {fmtMs(item.imageDurationMs)}
                </span>
              )}
              <span className="rounded border border-border bg-card px-1.5 py-0.5 font-mono text-muted-foreground">
                {createdAt}
              </span>
            </div>

            <DetailSection title="调用方 prompt(原始,未截断)">
              <pre className="whitespace-pre-wrap break-words rounded-md border border-border bg-card p-3 text-[12px] leading-relaxed text-foreground">
                {item.prompt}
              </pre>
            </DetailSection>

            {item.rewrittenPrompts.length > 0 && (
              <DetailSection
                title={`LLM 重写链(共 ${item.rewrittenPrompts.length} 轮)`}
              >
                <ol className="m-0 flex list-none flex-col gap-2 p-0">
                  {item.rewrittenPrompts.map((rw, idx) => (
                    <li
                      key={idx}
                      className="rounded-md border border-border bg-card p-3"
                    >
                      <div className="mb-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                        R{idx + 1}
                      </div>
                      <pre className="m-0 whitespace-pre-wrap break-words text-[12px] leading-relaxed">
                        {rw}
                      </pre>
                    </li>
                  ))}
                </ol>
              </DetailSection>
            )}

            {item.promptJson !== null && item.promptJson !== undefined && (
              <DetailSection title="prompt JSON(merged)">
                <pre className="overflow-x-auto rounded-md border border-border bg-card p-3 text-[11px] leading-relaxed">
                  {JSON.stringify(item.promptJson, null, 2)}
                </pre>
              </DetailSection>
            )}
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DetailSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="m-0 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}
