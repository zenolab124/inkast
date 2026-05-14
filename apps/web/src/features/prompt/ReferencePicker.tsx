import { useEffect, useRef, useState } from "react";
import { Image as ImageIcon, Loader2, Upload, X } from "lucide-react";
import type { GenerationRecord, ReferenceImage } from "@inkast/shared";
import { Button } from "@/components/ui/button";
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
  value: ReferenceImage | null;
  onChange: (next: ReferenceImage | null) => void;
}

export function ReferencePicker({ value, onChange }: ReferencePickerProps) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);

  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border/60 bg-card px-2 py-1.5 shadow-(--shadow-paper)">
        <ReferenceThumbnail value={value} size={40} />
        <div className="flex flex-1 flex-col text-[11px]">
          <span className="font-medium uppercase tracking-wider text-muted-foreground">
            {t.composer.reference}
          </span>
          <span className="text-foreground/80">
            {value.kind === "generation"
              ? t.composer.referenceSourceGallery
              : t.composer.referenceSourceUpload}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => onChange(null)}
          title={t.composer.referenceRemove}
          className="text-muted-foreground hover:text-accent"
        >
          <X strokeWidth={1.75} />
        </Button>
      </div>
    );
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="text-muted-foreground hover:text-foreground"
      >
        <ImageIcon strokeWidth={1.5} />
        {t.composer.referenceAdd}
      </Button>
      <ReferencePickerDialog
        open={open}
        onClose={() => setOpen(false)}
        onSelect={ref => {
          onChange(ref);
          setOpen(false);
        }}
      />
    </>
  );
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
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (ref: ReferenceImage) => void;
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
            <GalleryGrid onSelect={onSelect} />
          ) : (
            <UploadPane onSelect={onSelect} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function GalleryGrid({
  onSelect,
}: {
  onSelect: (ref: ReferenceImage) => void;
}) {
  const { t } = useLanguage();
  const [items, setItems] = useState<GenerationRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
      {items.map(it => (
        <li key={it.id}>
          <button
            type="button"
            onClick={() =>
              onSelect({ kind: "generation", generationId: it.id })
            }
            className={cn(
              "group block w-full overflow-hidden rounded-md border border-border/60 bg-card transition",
              "hover:border-ring/60 hover:shadow-(--shadow-paper)",
            )}
          >
            <img
              src={generationImageUrl(it.id)}
              alt={String(it.promptSnapshot.type ?? "")}
              loading="lazy"
              className="aspect-square w-full object-cover"
            />
          </button>
        </li>
      ))}
    </ul>
  );
}

function UploadPane({
  onSelect,
}: {
  onSelect: (ref: ReferenceImage) => void;
}) {
  const { t } = useLanguage();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    if (!file.type.startsWith("image/")) {
      setError("Only image files are accepted");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setError("File too large (max 8 MB)");
      return;
    }
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]!);
    }
    const dataBase64 = btoa(binary);
    onSelect({ kind: "upload", mimeType: file.type, dataBase64 });
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
        const file = e.dataTransfer.files?.[0];
        if (file) handleFile(file);
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
      {error && <p className="text-xs text-destructive">{error}</p>}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />
    </div>
  );
}
