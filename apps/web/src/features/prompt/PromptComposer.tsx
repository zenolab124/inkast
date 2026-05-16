import { type FormEvent, type ReactNode } from "react";
import { ArrowRight, ImagePlus, Loader2, Lock, Sparkles, Unlock } from "lucide-react";
import type { ReferenceImage } from "@inkast/shared";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useLanguage } from "@/i18n/LanguageContext";
import { cn } from "@/lib/utils";
import { ReferencePicker } from "./ReferencePicker.js";
import { SizeSelector } from "./SizeSelector.js";

export type LockMode = null | "ai-filled" | "m2";

interface PromptComposerProps {
  value: string;
  onChange: (next: string) => void;
  pending: boolean;
  onExpand: () => void;
  onCancel?: () => void;
  onGenerateRaw?: () => void;
  generatingRaw?: boolean;
  onSkipText: () => void;
  lockMode: LockMode;
  onUnlock: () => void;
  referenceImage: ReferenceImage | null;
  onReferenceImageChange: (next: ReferenceImage | null) => void;
  size: string;
  onSizeChange: (next: string) => void;
  /** Rendered next to the "AI expand" button — typically a "via X" status chip. */
  backendStatus?: ReactNode;
}

export function PromptComposer({
  value,
  onChange,
  pending,
  onExpand,
  onCancel,
  onGenerateRaw,
  generatingRaw,
  onSkipText,
  lockMode,
  onUnlock,
  referenceImage,
  onReferenceImageChange,
  size,
  onSizeChange,
  backendStatus,
}: PromptComposerProps) {
  const { t } = useLanguage();
  const busy = pending || generatingRaw;
  const locked = lockMode !== null;
  const hasText = value.trim().length > 0;

  const handle = (e: FormEvent) => {
    e.preventDefault();
    if (!hasText || busy || locked) return;
    onExpand();
  };

  const paramsBlock = (
    <ParamsBlock
      referenceImage={referenceImage}
      onReferenceImageChange={onReferenceImageChange}
      size={size}
      onSizeChange={onSizeChange}
      disabled={busy}
    />
  );

  if (locked) {
    return (
      <div className="flex h-full flex-col gap-3">
        <LockBar lockMode={lockMode} onUnlock={onUnlock} />

        <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t.composer.label}
        </Label>

        {lockMode === "ai-filled" ? (
          <>
            <div className="rounded-md border border-input bg-background/70 px-3 py-2 text-sm leading-relaxed text-foreground/80">
              {value || (
                <span className="italic text-muted-foreground">—</span>
              )}
            </div>
            <div className="flex flex-col items-start gap-1.5">
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={onExpand}
                disabled={busy || !hasText}
                className="h-auto px-1 py-0 text-xs text-muted-foreground hover:bg-transparent hover:text-foreground"
              >
                <Sparkles strokeWidth={1.5} />
                {t.composer.reExpand}
              </Button>
              {onGenerateRaw && (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={onGenerateRaw}
                  disabled={busy || !hasText}
                  className="h-auto px-1 py-0 text-xs text-muted-foreground hover:bg-transparent hover:text-foreground"
                >
                  <ImagePlus strokeWidth={1.5} />
                  {t.composer.rawAfterLock}
                </Button>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="rounded-md border border-dashed border-border/60 bg-background/40 px-3 py-2 text-xs italic text-muted-foreground">
              — {t.composer.lockedNoProse} —
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {t.composer.m2Hint}
            </p>
          </>
        )}

        {paramsBlock}
      </div>
    );
  }

  return (
    <form onSubmit={handle} className="flex h-full min-h-0 flex-col gap-3">
      {/* 起草区:占纵向 60% */}
      <div className="flex min-h-0 flex-[3] flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t.composer.label}
          </Label>
          <SkipTextButton onClick={onSkipText} disabled={busy} />
        </div>

        <Textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={t.composer.placeholder}
          disabled={busy}
          className="min-h-0 flex-1 resize-none leading-relaxed"
        />

        <div className="flex flex-wrap items-center gap-2">
          {onGenerateRaw && (
            <Button
              type="button"
              variant="outline"
              onClick={onGenerateRaw}
              disabled={busy || !hasText}
              title={t.composer.generateNowHint}
              className="border-accent/40 text-accent hover:bg-accent/10 hover:text-accent"
            >
              {generatingRaw ? (
                <>
                  <Loader2 className="animate-spin" strokeWidth={1.75} />
                  {t.composer.generateNowPending}
                </>
              ) : (
                <>
                  <ImagePlus strokeWidth={1.75} />
                  {t.composer.generateNow}
                </>
              )}
            </Button>
          )}
          <Button
            type="submit"
            disabled={busy || !hasText}
          >
            {pending ? (
              <>
                <Loader2 className="animate-spin" strokeWidth={1.75} />
                {t.composer.aiFilling}
              </>
            ) : (
              <>
                <Sparkles strokeWidth={1.75} />
                {t.composer.aiFill}
              </>
            )}
          </Button>
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
          {backendStatus && (
            <div className="ml-auto text-xs text-muted-foreground">{backendStatus}</div>
          )}
        </div>
      </div>

      {/* 全局参数:占纵向 40%,内容超出可滚动 */}
      <div className="flex min-h-0 flex-[2] flex-col overflow-y-auto">
        {paramsBlock}
      </div>
    </form>
  );
}

function SkipTextButton({
  onClick,
  disabled,
}: {
  onClick: () => void;
  disabled?: boolean;
}) {
  const { t } = useLanguage();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={t.composer.generateNowHint}
      className={cn(
        "group inline-flex items-center gap-1.5 rounded-md border border-border/50 bg-transparent px-2.5 py-1 text-[11px] text-muted-foreground transition",
        "hover:bg-secondary hover:text-foreground",
        "disabled:cursor-not-allowed disabled:opacity-50",
      )}
    >
      <span>{t.composer.skipText}</span>
      <ArrowRight
        className="size-3 transition-transform group-hover:translate-x-0.5"
        strokeWidth={1.75}
      />
      <kbd className="ml-0.5 rounded border border-border/60 bg-secondary px-1 py-0 font-mono text-[9.5px] text-muted-foreground">
        {t.composer.skipTextKbd}
      </kbd>
    </button>
  );
}

function ParamsBlock({
  referenceImage,
  onReferenceImageChange,
  size,
  onSizeChange,
  disabled,
}: {
  referenceImage: ReferenceImage | null;
  onReferenceImageChange: (next: ReferenceImage | null) => void;
  size: string;
  onSizeChange: (next: string) => void;
  disabled?: boolean;
}) {
  const { t } = useLanguage();
  return (
    <div className="mt-1 flex flex-col gap-3">
      <ParamsDivider label={t.composer.paramsDivider} />
      <div className="grid grid-cols-[48px_1fr] items-center gap-x-3">
        <Label className="pt-0 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t.composer.reference}
        </Label>
        <div className="min-w-0">
          <ReferencePicker value={referenceImage} onChange={onReferenceImageChange} />
        </div>
      </div>
      <SizeSelector value={size} onChange={onSizeChange} disabled={disabled} />
    </div>
  );
}

function ParamsDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
      <span className="h-px flex-1 bg-border/40" />
      <span>{label}</span>
      <span className="h-px flex-1 bg-border/40" />
    </div>
  );
}

function LockBar({
  lockMode,
  onUnlock,
}: {
  lockMode: LockMode;
  onUnlock: () => void;
}) {
  const { t } = useLanguage();
  const label = lockMode === "m2" ? t.composer.lockedNoProse : t.composer.locked;
  const linkText =
    lockMode === "m2" ? t.composer.backToDraft : t.composer.unlock;
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-[10.5px]",
        "border-accent/30 bg-accent/8 text-accent",
      )}
    >
      <Lock className="size-3" strokeWidth={1.75} />
      <span>{label}</span>
      <button
        type="button"
        onClick={onUnlock}
        className="ml-auto inline-flex items-center gap-1 font-medium underline hover:no-underline"
      >
        <Unlock className="size-3" strokeWidth={1.75} />
        {linkText}
      </button>
    </div>
  );
}
