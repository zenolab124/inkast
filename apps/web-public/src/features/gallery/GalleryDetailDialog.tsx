import { Download, RefreshCw, Copy, Check, Sparkles, ChevronDown, Quote } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { GenerationRecord, ProviderSummary, TextElement } from "@inkast/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useLanguage } from "@/i18n/LanguageContext";
import { listProviders } from "@/features/config/api";
import { cn } from "@/lib/utils";
import { generationImageUrl } from "./api.js";

interface Props {
  record: GenerationRecord | null;
  onClose: () => void;
  onReuse?: (record: GenerationRecord) => void;
}

// Display order for known prompt fields. Anything else falls through to the
// "extras" section at the bottom, alphabetised.
const KNOWN_FIELD_ORDER = [
  "type",
  "style",
  "subject",
  "background",
  "layout",
  "lighting",
  "mood",
  "camera",
  "color_palette",
  "count",
  "text_elements",
] as const;

// Field names whose i18n label lives under editor.fields. The key shape over
// there is camelCase; we map known snake_case keys before lookup.
const EDITOR_FIELD_KEY_MAP: Record<string, string> = {
  color_palette: "colorPalette",
  text_elements: "textElements",
};

export function GalleryDetailDialog({ record, onClose, onReuse }: Props) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  const [proseExpanded, setProseExpanded] = useState(false);
  const [providers, setProviders] = useState<ProviderSummary[]>([]);

  // Reset transient UI state every time a new record is opened.
  useEffect(() => {
    setProseExpanded(false);
    setCopied(false);
  }, [record?.id]);

  // Load provider list when the dialog opens, so we can resolve providerId → name.
  useEffect(() => {
    if (!record) return;
    let cancelled = false;
    listProviders()
      .then(list => {
        if (!cancelled) setProviders(list);
      })
      .catch(() => {
        if (!cancelled) setProviders([]);
      });
    return () => {
      cancelled = true;
    };
  }, [record]);

  const aiFilledSet = useMemo(
    () => new Set(record?.aiFilledFields ?? []),
    [record?.aiFilledFields],
  );
  const orderedFields = useMemo(
    () => (record ? orderPromptFields(record.promptSnapshot) : []),
    [record],
  );

  async function copyJson() {
    if (!record) return;
    await navigator.clipboard.writeText(
      JSON.stringify(record.promptSnapshot, null, 2),
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (!record) return null;

  const url = generationImageUrl(record.id);
  const createdAt = new Date(record.createdAt).toLocaleString();
  const durationLabel = record.durationMs
    ? `${(record.durationMs / 1000).toFixed(1)}s`
    : "—";
  const providerLabel = (() => {
    if (!record.providerId) return "—";
    const found = providers.find(p => p.id === record.providerId);
    return found?.name ?? record.providerId.slice(-8);
  })();
  const hasProse = !!record.prose && record.prose.trim().length > 0;
  const isFromAi = (record.aiFilledFields?.length ?? 0) > 0;

  return (
    <Dialog open={!!record} onOpenChange={open => !open && onClose()}>
      <DialogContent className="flex max-h-[88vh] w-full max-w-5xl flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <header className="flex items-center justify-between border-b border-border/60 px-6 py-3.5 pr-12">
          <DialogTitle className="text-sm font-medium">
            {t.detail.title}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {t.detail.title}
          </DialogDescription>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={copyJson}
              className="text-muted-foreground hover:text-foreground"
            >
              {copied ? (
                <>
                  <Check strokeWidth={2.5} />
                  {t.detail.copied}
                </>
              ) : (
                <>
                  <Copy strokeWidth={1.75} />
                  {t.detail.copyJson}
                </>
              )}
            </Button>
            {onReuse && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  onReuse(record);
                  onClose();
                }}
                className="text-muted-foreground hover:text-foreground"
              >
                <RefreshCw strokeWidth={1.75} />
                {t.detail.reuse}
              </Button>
            )}
            <Button asChild size="sm">
              <a
                href={url}
                download={`inkast-${record.id}.${record.imageFormat}`}
              >
                <Download strokeWidth={1.75} />
                {t.detail.download}
              </a>
            </Button>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden md:grid-cols-[minmax(280px,360px)_1fr]">
          {/* Left: image + meta */}
          <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto border-b border-border/60 p-4 md:border-b-0 md:border-r">
            <div className="overflow-hidden rounded-md border border-border/60 bg-background shadow-(--shadow-paper)">
              <img
                src={url}
                alt={String(record.promptSnapshot.type ?? "image")}
                className="block w-full"
              />
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11.5px] leading-snug">
              <MetaRow label={t.detail.meta.createdAt} value={createdAt} />
              <MetaRow label={t.detail.meta.size} value={record.size} />
              <MetaRow label={t.detail.meta.quality} value={record.quality} />
              <MetaRow label={t.detail.meta.duration} value={durationLabel} />
              <MetaRow label={t.detail.meta.provider} value={providerLabel} />
            </dl>
          </aside>

          {/* Right: prose + structured prompt */}
          <section className="flex min-h-0 flex-col gap-5 overflow-y-auto p-5">
            {hasProse && (
              <ProseBlock
                prose={record.prose!}
                expanded={proseExpanded}
                onToggle={() => setProseExpanded(v => !v)}
              />
            )}
            <StructuredBlock
              isFromAi={isFromAi}
              orderedFields={orderedFields}
              aiFilledSet={aiFilledSet}
            />
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-foreground/85">{value}</dd>
    </>
  );
}

function ProseBlock({
  prose,
  expanded,
  onToggle,
}: {
  prose: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useLanguage();
  return (
    <section className="flex flex-col gap-2">
      <header className="flex items-center gap-2">
        <Quote className="size-3.5 text-accent" strokeWidth={1.5} />
        <span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t.detail.prose}
        </span>
        <span className="text-[10.5px] text-muted-foreground/70">
          · {t.detail.proseFromUser}
        </span>
      </header>
      <blockquote
        className={cn(
          "rounded-r-md border-l-2 border-accent/70 bg-accent/[0.06] px-4 py-3 text-[13px] italic leading-relaxed text-foreground/90",
          !expanded && "line-clamp-3",
        )}
      >
        {prose}
      </blockquote>
      {/* Toggle is unconditional — line-clamp will be a no-op for short prose, */}
      {/* and rather than measuring overflow we keep the button cheap. */}
      <button
        type="button"
        onClick={onToggle}
        className="flex w-fit items-center gap-1 text-[11px] text-accent/80 hover:text-accent"
      >
        {expanded ? t.detail.proseCollapse : t.detail.proseExpand}
        <ChevronDown
          className={cn("size-3 transition-transform", expanded && "rotate-180")}
          strokeWidth={1.75}
        />
      </button>
    </section>
  );
}

function StructuredBlock({
  isFromAi,
  orderedFields,
  aiFilledSet,
}: {
  isFromAi: boolean;
  orderedFields: Array<[string, unknown]>;
  aiFilledSet: Set<string>;
}) {
  const { t } = useLanguage();
  if (orderedFields.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <header className="flex items-center gap-2">
        <Sparkles className="size-3.5 text-primary" strokeWidth={1.5} />
        <span className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t.detail.structured}
        </span>
        <span className="text-[10.5px] text-muted-foreground/70">
          · {isFromAi ? t.detail.structuredFromAi : t.detail.structuredManual}
        </span>
      </header>
      <dl className="flex flex-col">
        {orderedFields.map(([key, value], idx) => (
          <FieldRow
            key={key}
            field={key}
            value={value}
            isAi={aiFilledSet.has(key)}
            last={idx === orderedFields.length - 1}
          />
        ))}
      </dl>
    </section>
  );
}

function FieldRow({
  field,
  value,
  isAi,
  last,
}: {
  field: string;
  value: unknown;
  isAi: boolean;
  last: boolean;
}) {
  const { t } = useLanguage();
  const label = fieldLabel(field, t);
  return (
    <div
      className={cn(
        "grid grid-cols-[80px_1fr] gap-x-4 py-2",
        !last && "border-b border-dashed border-border/50",
      )}
    >
      <dt className="flex items-start gap-1 pt-0.5">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        {isAi && (
          <Badge
            variant="secondary"
            className="ml-0.5 h-4 rounded-full px-1.5 py-0 text-[9px] font-medium uppercase tracking-wider"
            title={t.editor.aiBadge}
          >
            <Sparkles className="size-2.5" strokeWidth={2} />
            {t.detail.aiBadge}
          </Badge>
        )}
      </dt>
      <dd className="min-w-0 text-[13px] leading-relaxed text-foreground/90">
        <FieldValue field={field} value={value} />
      </dd>
    </div>
  );
}

function FieldValue({ field, value }: { field: string; value: unknown }) {
  if (value == null) return <span className="text-muted-foreground">—</span>;

  if (field === "color_palette" && Array.isArray(value)) {
    return <PaletteInline colors={value as unknown[]} />;
  }

  if (field === "text_elements" && Array.isArray(value)) {
    return <TextElementsInline items={value as TextElement[]} />;
  }

  if (field === "mood" && Array.isArray(value)) {
    return <MoodChips items={value as unknown[]} />;
  }

  if (Array.isArray(value)) {
    return (
      <span>
        {value.map((v, i) => (
          <span key={i}>
            {i > 0 && <span className="text-muted-foreground/60"> · </span>}
            {String(v)}
          </span>
        ))}
      </span>
    );
  }

  if (typeof value === "object") {
    const desc = (value as { description?: unknown }).description;
    if (typeof desc === "string") return <span>{desc}</span>;
    return (
      <code className="font-mono text-[11.5px] text-muted-foreground">
        {JSON.stringify(value)}
      </code>
    );
  }

  return <span>{String(value)}</span>;
}

function PaletteInline({ colors }: { colors: unknown[] }) {
  const valid = colors.filter((c): c is string => typeof c === "string");
  if (valid.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
      {valid.map((c, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          <span
            className="inline-block size-3.5 rounded-sm border border-border/50"
            style={{ background: c }}
          />
          <code className="font-mono text-[11px] text-muted-foreground">{c}</code>
        </span>
      ))}
    </div>
  );
}

function MoodChips({ items }: { items: unknown[] }) {
  const valid = items.filter((c): c is string => typeof c === "string");
  if (valid.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {valid.map((m, i) => (
        <Badge
          key={i}
          variant="secondary"
          className="rounded-full bg-primary/12 px-2 py-0.5 text-[11px] font-normal text-primary/85"
        >
          {m}
        </Badge>
      ))}
    </div>
  );
}

function TextElementsInline({ items }: { items: TextElement[] }) {
  if (!items.length) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-col gap-1">
      {items.map((te, i) => {
        const attrs = [te.position, te.font, te.size, te.color]
          .filter(s => typeof s === "string" && s.length > 0)
          .join(" · ");
        return (
          <div key={i} className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium text-foreground">"{te.content}"</span>
            {attrs && (
              <span className="text-[11px] text-muted-foreground">· {attrs}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function fieldLabel(field: string, t: ReturnType<typeof useLanguage>["t"]): string {
  const mapped = EDITOR_FIELD_KEY_MAP[field] ?? field;
  const editorLabel = (t.editor.fields as Record<string, string>)[mapped];
  if (editorLabel) return editorLabel;
  return field;
}

function orderPromptFields(snapshot: Record<string, unknown>): Array<[string, unknown]> {
  const seen = new Set<string>();
  const ordered: Array<[string, unknown]> = [];
  for (const key of KNOWN_FIELD_ORDER) {
    if (key in snapshot && !isEmptyValue(snapshot[key])) {
      ordered.push([key, snapshot[key]]);
      seen.add(key);
    }
  }
  const extras = Object.entries(snapshot)
    .filter(([k, v]) => !seen.has(k) && !isEmptyValue(v))
    .sort(([a], [b]) => a.localeCompare(b));
  return [...ordered, ...extras];
}

function isEmptyValue(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === "string") return v.length === 0;
  if (Array.isArray(v)) return v.length === 0;
  return false;
}
