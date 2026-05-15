import { Download, RefreshCw, Copy, Check } from "lucide-react";
import { useState } from "react";
import type { GenerationRecord, ImagePrompt } from "@inkast/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useLanguage } from "@/i18n/LanguageContext";
import { PromptFieldEditor } from "../prompt/PromptFieldEditor.js";
import { generationImageUrl } from "./api.js";

interface Props {
  record: GenerationRecord | null;
  onClose: () => void;
  onReuse?: (record: GenerationRecord) => void;
}

export function GalleryDetailDialog({ record, onClose, onReuse }: Props) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);

  async function copyJson() {
    if (!record) return;
    await navigator.clipboard.writeText(JSON.stringify(record.promptSnapshot, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (!record) return null;

  const url = generationImageUrl(record.id);
  const createdAt = new Date(record.createdAt).toLocaleString();
  const durationLabel = record.durationMs
    ? `${(record.durationMs / 1000).toFixed(1)}s`
    : "—";

  return (
    <Dialog open={!!record} onOpenChange={open => !open && onClose()}>
      <DialogContent
        className="flex max-h-[88vh] w-full max-w-5xl flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl"
      >
        <header className="flex items-center justify-between border-b border-border/60 px-6 py-3.5 pr-12">
          <div className="flex items-baseline gap-3 text-sm">
            <DialogTitle className="text-sm font-medium">{t.detail.title}</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {createdAt} · {record.size} · {record.quality} · {durationLabel}
            </DialogDescription>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden md:grid-cols-[1fr_380px]">
          <div className="flex min-h-0 min-w-0 items-center justify-center overflow-hidden bg-background p-4">
            <img
              src={url}
              alt={String(record.promptSnapshot.type ?? "image")}
              className="max-h-full max-w-full object-contain rounded-sm shadow-(--shadow-paper)"
            />
          </div>

          <aside className="flex min-h-0 flex-col overflow-hidden border-t border-border/60 md:border-l md:border-t-0">
            <div className="flex items-center justify-between border-b border-border/60 px-5 py-3">
              <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t.detail.prompt}
              </h3>
              <Button
                variant="outline"
                size="xs"
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
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <PromptFieldEditor
                value={record.promptSnapshot as ImagePrompt}
                onChange={() => {}}
                readOnly
              />
            </div>
          </aside>
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border/60 px-6 py-3">
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
        </footer>
      </DialogContent>
    </Dialog>
  );
}
