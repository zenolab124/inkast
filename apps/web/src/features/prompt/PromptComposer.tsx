import { type FormEvent } from "react";
import { ImagePlus, Loader2, Sparkles } from "lucide-react";
import type { ReferenceImage } from "@inkast/shared";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useLanguage } from "@/i18n/LanguageContext";
import { ReferencePicker } from "./ReferencePicker.js";

interface PromptComposerProps {
  value: string;
  onChange: (next: string) => void;
  pending: boolean;
  hasFilled: boolean;
  onSubmit: () => void;
  onCancel?: () => void;
  onGenerateRaw?: () => void;
  generatingRaw?: boolean;
  referenceImage: ReferenceImage | null;
  onReferenceImageChange: (next: ReferenceImage | null) => void;
}

export function PromptComposer({
  value,
  onChange,
  pending,
  hasFilled,
  onSubmit,
  onCancel,
  onGenerateRaw,
  generatingRaw,
  referenceImage,
  onReferenceImageChange,
}: PromptComposerProps) {
  const { t } = useLanguage();
  const busy = pending || generatingRaw;
  const handle = (e: FormEvent) => {
    e.preventDefault();
    if (!value.trim() || pending) return;
    onSubmit();
  };

  return (
    <form onSubmit={handle} className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t.composer.label} · {t.composer.optional}
        </Label>
        <span className="text-[11px] text-muted-foreground">{t.composer.hint}</span>
      </div>
      <Textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={4}
        placeholder={t.composer.placeholder}
        disabled={busy}
        className="resize-y leading-relaxed"
      />

      <div className="flex items-center justify-start">
        <ReferencePicker value={referenceImage} onChange={onReferenceImageChange} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {t.composer.samples.map((s, i) => (
          <Button
            key={i}
            type="button"
            variant="outline"
            size="xs"
            disabled={busy}
            onClick={() => onChange(s)}
            className="text-muted-foreground hover:text-foreground"
          >
            {t.composer.sample} {i + 1}
          </Button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          {pending && onCancel && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onCancel}
              className="text-muted-foreground"
            >
              {t.composer.cancel}
            </Button>
          )}
          {onGenerateRaw && (
            <Button
              type="button"
              variant="outline"
              onClick={onGenerateRaw}
              disabled={busy || !value.trim()}
              title={t.composer.generateRawHint}
              className="border-accent/40 text-accent hover:bg-accent/10 hover:text-accent"
            >
              {generatingRaw ? (
                <>
                  <Loader2 className="animate-spin" strokeWidth={1.75} />
                  {t.composer.generateRawPending}
                </>
              ) : (
                <>
                  <ImagePlus strokeWidth={1.75} />
                  {t.composer.generateRaw}
                </>
              )}
            </Button>
          )}
          <Button
            type="submit"
            disabled={busy || !value.trim()}
            title={hasFilled ? t.composer.titleHintOverride : t.composer.titleHintFresh}
          >
            {pending ? (
              <>
                <Loader2 className="animate-spin" strokeWidth={1.75} />
                {t.composer.aiFilling}
              </>
            ) : (
              <>
                <Sparkles strokeWidth={1.75} />
                {hasFilled ? t.composer.aiFillAgain : t.composer.aiFill}
              </>
            )}
          </Button>
        </div>
      </div>
    </form>
  );
}
