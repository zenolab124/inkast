import { useEffect, useMemo, useRef, useState } from "react";
import { Image as ImageIcon, Loader2, Plus, Upload, X } from "lucide-react";
import {
  MAX_REFERENCE_IMAGES,
  type GenerationRecord,
  type ReferenceImage,
} from "@inkast/shared";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useLanguage } from "@/i18n/LanguageContext";
import { cn } from "@/lib/utils";
import { generationImageUrl, listGenerations } from "../gallery/api.js";

interface ReferencePickerProps {
  value: ReferenceImage[];
  onChange: (next: ReferenceImage[]) => void;
}

export function ReferencePicker({ value, onChange }: ReferencePickerProps) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const remaining = MAX_REFERENCE_IMAGES - value.length;

  function appendRefs(next: ReferenceImage[]) {
    if (next.length === 0) return;
    const merged = [...value, ...next].slice(0, MAX_REFERENCE_IMAGES);
    onChange(merged);
  }

  function removeAt(i: number) {
    onChange(value.filter((_, idx) => idx !== i));
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        {value.map((ref, i) => (
          <ReferenceChip key={refKey(ref, i)} value={ref} onRemove={() => removeAt(i)} />
        ))}
        {remaining > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => setOpen(true)}
            className="h-auto px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            {value.length === 0 ? (
              <>
                <ImageIcon strokeWidth={1.5} className="size-3.5" />
                {t.composer.referenceAdd}
              </>
            ) : (
              <>
                <Plus strokeWidth={1.75} className="size-3.5" />
                <span className="text-[11px] tabular-nums text-muted-foreground/90">
                  {value.length}/{MAX_REFERENCE_IMAGES}
                </span>
              </>
            )}
          </Button>
        ) : (
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {value.length}/{MAX_REFERENCE_IMAGES}
          </span>
        )}
      </div>
      <ReferencePickerDialog
        open={open}
        onClose={() => setOpen(false)}
        remaining={remaining}
        existing={value}
        onAppend={refs => {
          appendRefs(refs);
          setOpen(false);
        }}
      />
    </>
  );
}

function ReferenceChip({
  value,
  onRemove,
}: {
  value: ReferenceImage;
  onRemove: () => void;
}) {
  const { t } = useLanguage();
  return (
    <span
      className="group relative inline-flex items-center gap-1 rounded-sm border border-border/60 bg-card pl-0.5 pr-1.5 py-0.5"
    >
      <ReferenceThumbnail value={value} size={20} />
      <button
        type="button"
        onClick={onRemove}
        title={t.composer.referenceRemove}
        className="cursor-pointer rounded-sm p-0.5 text-muted-foreground hover:bg-secondary hover:text-accent"
      >
        <X strokeWidth={2} className="size-3" />
      </button>
    </span>
  );
}

function refKey(ref: ReferenceImage, fallbackIdx: number): string {
  if (ref.kind === "generation") return `gen:${ref.generationId}`;
  // Uploads have no stable id; use a hash of the first/last few bytes plus
  // the position so React reconciles them stably across re-renders without
  // re-keying every image when the array shifts.
  const head = ref.dataBase64.slice(0, 24);
  const tail = ref.dataBase64.slice(-12);
  return `up:${head}:${tail}:${fallbackIdx}`;
}

export function ReferenceThumbnail({
  value,
  size = 32,
}: {
  value: ReferenceImage;
  size?: number;
}) {
  const src =
    value.kind === "generation"
      ? generationImageUrl(value.generationId)
      : `data:${value.mimeType};base64,${value.dataBase64}`;
  return (
    <img
      src={src}
      alt="reference"
      className="shrink-0 rounded-sm border border-border/60 object-cover"
      style={{ width: size, height: size }}
    />
  );
}

function ReferencePickerDialog({
  open,
  onClose,
  remaining,
  existing,
  onAppend,
}: {
  open: boolean;
  onClose: () => void;
  remaining: number;
  existing: ReferenceImage[];
  onAppend: (refs: ReferenceImage[]) => void;
}) {
  const { t } = useLanguage();
  const [tab, setTab] = useState<"gallery" | "upload">("gallery");

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="flex max-h-[80vh] w-full max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <header className="flex items-center gap-3 border-b border-border/60 px-6 py-4 pr-12">
          <DialogTitle className="text-base font-medium">
            {t.composer.referencePickTitle}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {t.composer.referencePickTitle}
          </DialogDescription>
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {t.composer.referenceRemaining.replace("{n}", String(remaining))}
          </span>
          <div className="ml-auto flex gap-1">
            <Button
              variant={tab === "gallery" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setTab("gallery")}
            >
              {t.composer.referenceFromGallery}
            </Button>
            <Button
              variant={tab === "upload" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setTab("upload")}
            >
              {t.composer.referenceUpload}
            </Button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {tab === "gallery" ? (
            <GalleryGrid
              remaining={remaining}
              existing={existing}
              onAppend={onAppend}
            />
          ) : (
            <UploadPane remaining={remaining} onAppend={onAppend} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function GalleryGrid({
  remaining,
  existing,
  onAppend,
}: {
  remaining: number;
  existing: ReferenceImage[];
  onAppend: (refs: ReferenceImage[]) => void;
}) {
  const { t } = useLanguage();
  const [items, setItems] = useState<GenerationRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const existingGenIds = useMemo(
    () =>
      new Set(
        existing
          .filter((r): r is Extract<ReferenceImage, { kind: "generation" }> => r.kind === "generation")
          .map(r => r.generationId),
      ),
    [existing],
  );

  useEffect(() => {
    let cancelled = false;
    listGenerations(100)
      .then(list => {
        if (!cancelled) setItems(list);
      })
      .catch(err => {
        if (!cancelled) setError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else if (next.size < remaining) next.add(id);
    setSelected(next);
  }

  if (error) {
    return (
      <p className="py-12 text-center text-sm text-destructive">{error}</p>
    );
  }
  if (items === null) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" strokeWidth={1.75} />
        {t.gallery.loading}
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        {t.composer.referenceEmpty}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
        {items.map(it => {
          const isSelected = selected.has(it.id);
          const alreadyAdded = existingGenIds.has(it.id);
          const disabled = alreadyAdded || (!isSelected && selected.size >= remaining);
          return (
            <li key={it.id}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => toggle(it.id)}
                className={cn(
                  "group relative block w-full overflow-hidden rounded-md border bg-card transition",
                  isSelected
                    ? "border-primary shadow-(--shadow-paper)"
                    : "border-border/60 hover:border-ring/60",
                  disabled && !isSelected && "cursor-not-allowed opacity-40",
                )}
                title={alreadyAdded ? t.composer.referenceAlreadyAdded : undefined}
              >
                <img
                  src={generationImageUrl(it.id)}
                  alt={String(it.promptSnapshot.type ?? "")}
                  loading="lazy"
                  className="aspect-square w-full object-cover"
                />
                <span
                  className={cn(
                    "absolute left-1.5 top-1.5 flex size-5 items-center justify-center rounded-sm border bg-card/95 shadow-(--shadow-paper)",
                    isSelected ? "border-primary" : "border-border/60",
                  )}
                >
                  <Checkbox
                    checked={isSelected}
                    disabled={disabled}
                    aria-label="select"
                    className="pointer-events-none size-3.5 rounded-sm"
                  />
                </span>
                {alreadyAdded && (
                  <span className="absolute right-1.5 top-1.5 rounded-sm bg-card/90 px-1 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">
                    {t.composer.referenceAlreadyAddedBadge}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="sticky bottom-0 -mx-6 -mb-5 flex items-center justify-between border-t border-border/60 bg-card/95 px-6 py-3">
        <span className="text-xs tabular-nums text-muted-foreground">
          {t.composer.referenceSelected
            .replace("{n}", String(selected.size))
            .replace("{cap}", String(remaining))}
        </span>
        <Button
          type="button"
          size="sm"
          disabled={selected.size === 0}
          onClick={() =>
            onAppend(
              Array.from(selected).map(id => ({
                kind: "generation" as const,
                generationId: id,
              })),
            )
          }
        >
          {t.composer.referenceAddSelected}
        </Button>
      </div>
    </div>
  );
}

function UploadPane({
  remaining,
  onAppend,
}: {
  remaining: number;
  onAppend: (refs: ReferenceImage[]) => void;
}) {
  const { t } = useLanguage();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFiles(files: FileList | File[]) {
    setError(null);
    const arr = Array.from(files);
    const refs: ReferenceImage[] = [];
    for (const file of arr) {
      if (refs.length >= remaining) break;
      if (!file.type.startsWith("image/")) {
        setError(t.composer.referenceUploadErrType);
        continue;
      }
      if (file.size > 8 * 1024 * 1024) {
        setError(t.composer.referenceUploadErrSize);
        continue;
      }
      const dataBase64 = await fileToBase64(file);
      refs.push({ kind: "upload", mimeType: file.type, dataBase64 });
    }
    if (refs.length > 0) onAppend(refs);
  }

  return (
    <div
      onDragOver={e => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => {
        e.preventDefault();
        setDragging(false);
        const files = e.dataTransfer.files;
        if (files?.length) void handleFiles(files);
      }}
      onClick={() => inputRef.current?.click()}
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-md border-2 border-dashed py-16 transition",
        dragging
          ? "border-primary/60 bg-primary/5"
          : "border-border/60 hover:border-ring/60",
      )}
    >
      <Upload className="size-8 text-muted-foreground" strokeWidth={1.5} />
      <p className="text-sm text-muted-foreground">
        {t.composer.referenceUploadHint}
      </p>
      <p className="text-[11px] text-muted-foreground/80">
        {t.composer.referenceRemaining.replace("{n}", String(remaining))}
      </p>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={e => {
          const files = e.target.files;
          if (files?.length) void handleFiles(files);
          // reset so re-selecting the same file fires the change event
          e.target.value = "";
        }}
      />
    </div>
  );
}

export async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}
