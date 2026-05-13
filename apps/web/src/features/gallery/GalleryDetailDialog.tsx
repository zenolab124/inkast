import { X, Download, RefreshCw, Copy, Check } from "lucide-react";
import { useState } from "react";
import type { GenerationRecord } from "@inkast/shared";
import { cn } from "../../lib/utils.js";
import { JsonTreeView } from "../prompt/JsonTreeView.js";
import { generationImageUrl } from "./api.js";

interface Props {
  record: GenerationRecord | null;
  onClose: () => void;
  onReuse?: (record: GenerationRecord) => void;
}

export function GalleryDetailDialog({ record, onClose, onReuse }: Props) {
  const [copied, setCopied] = useState(false);
  if (!record) return null;

  const url = generationImageUrl(record.id);
  const createdAt = new Date(record.createdAt).toLocaleString();
  const durationLabel = record.durationMs
    ? `${(record.durationMs / 1000).toFixed(1)}s`
    : "—";

  async function copyJson() {
    if (!record) return;
    await navigator.clipboard.writeText(JSON.stringify(record.promptSnapshot, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 p-6 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-md border border-border bg-card shadow-(--shadow-paper-lifted)"
        onClick={e => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-border/60 px-6 py-3.5">
          <div className="flex items-baseline gap-3 text-sm">
            <span className="font-medium">作品详情</span>
            <span className="text-xs text-muted-foreground">
              {createdAt} · {record.size} · {record.quality} · {durationLabel}
            </span>
          </div>
          <button
            onClick={onClose}
            className="rounded-sm p-1 text-muted-foreground transition hover:text-foreground"
          >
            <X className="size-4" strokeWidth={1.75} />
          </button>
        </header>

        <div className="grid flex-1 grid-cols-1 overflow-hidden md:grid-cols-[1fr_360px]">
          <div className="flex items-center justify-center overflow-hidden bg-background p-4">
            <img
              src={url}
              alt={String(record.promptSnapshot.type ?? "image")}
              className="max-h-full max-w-full rounded-sm object-contain shadow-(--shadow-paper)"
            />
          </div>

          <aside className="flex flex-col border-t border-border/60 md:border-l md:border-t-0">
            <div className="flex items-center justify-between border-b border-border/60 px-5 py-3">
              <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                prompt
              </h3>
              <button
                onClick={copyJson}
                className={cn(
                  "inline-flex items-center gap-1 rounded-sm border border-border/60 bg-background px-2 py-0.5 text-xs text-muted-foreground transition",
                  "hover:text-foreground hover:shadow-(--shadow-paper)",
                )}
              >
                {copied ? (
                  <>
                    <Check className="size-3" strokeWidth={2.5} />
                    已复制
                  </>
                ) : (
                  <>
                    <Copy className="size-3" strokeWidth={1.75} />
                    复制 JSON
                  </>
                )}
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <JsonTreeView data={record.promptSnapshot} />
            </div>
          </aside>
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border/60 px-6 py-3">
          {onReuse && (
            <button
              onClick={() => {
                onReuse(record);
                onClose();
              }}
              className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-card px-3 py-1.5 text-sm text-muted-foreground transition hover:text-foreground hover:shadow-(--shadow-paper)"
            >
              <RefreshCw className="size-3.5" strokeWidth={1.75} />
              复用 prompt
            </button>
          )}
          <a
            href={url}
            download={`inkast-${record.id}.${record.imageFormat}`}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow-(--shadow-paper) transition hover:shadow-(--shadow-paper-lifted)"
          >
            <Download className="size-3.5" strokeWidth={1.75} />
            下载图片
          </a>
        </footer>
      </div>
    </div>
  );
}
