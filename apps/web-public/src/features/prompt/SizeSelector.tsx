import { useEffect, useMemo, useState } from "react";
import {
  ORIENTATION_RATIOS,
  RATIO_SIZE_PRESETS,
  SIZE_AUTO,
  extractRatio,
  isRatioSize,
  makeRatioSize,
  type SizeOrientation,
} from "@inkast/shared";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLanguage } from "@/i18n/LanguageContext";
import { cn } from "@/lib/utils";

interface Props {
  /** Wire value: `"auto"`, `"<W>x<H>"`, or `"ratio:<W>:<H>"`. */
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}

const SIZE_RE = /^(\d{2,4})x(\d{2,4})$/;
const RATIO_RE = /^(\d{1,3}):(\d{1,3})$/;

function parseSize(value: string): { w: number; h: number } | null {
  if (value === SIZE_AUTO || isRatioSize(value)) return null;
  const m = SIZE_RE.exec(value);
  if (!m) return null;
  return { w: Number(m[1]), h: Number(m[2]) };
}

/**
 * Reverse-derive (orientation, ratio) from a wire size value by scanning the
 * preset table. Used only on mount, to populate the initial chip selection
 * when the parent passes a non-auto initial size. Returns null when the value
 * isn't a known preset — the caller falls back to "custom".
 */
function lookupPreset(value: string): { orientation: SizeOrientation; ratio: string } | null {
  for (const [orientation, ratios] of Object.entries(ORIENTATION_RATIOS) as [
    Exclude<SizeOrientation, "auto" | "custom">,
    readonly string[],
  ][]) {
    for (const ratio of ratios) {
      const presets = RATIO_SIZE_PRESETS[ratio];
      if (presets?.some(p => p.value === value)) {
        return { orientation, ratio };
      }
    }
  }
  return null;
}

/** Find which orientation a known `W:H` ratio belongs to, or null if it's a
 *  user-defined ratio that's not in the preset table. */
function orientationForRatio(ratio: string): Exclude<SizeOrientation, "auto" | "custom"> | null {
  for (const [orientation, ratios] of Object.entries(ORIENTATION_RATIOS) as [
    Exclude<SizeOrientation, "auto" | "custom">,
    readonly string[],
  ][]) {
    if (ratios.includes(ratio)) return orientation;
  }
  return null;
}

function defaultRatioFor(orientation: Exclude<SizeOrientation, "auto" | "custom">): string {
  return ORIENTATION_RATIOS[orientation][0] ?? "1:1";
}

function defaultSizeFor(ratio: string): string {
  return RATIO_SIZE_PRESETS[ratio]?.[0]?.value ?? "1024x1024";
}

/** Size row mode within a known orientation/ratio context:
 *  - "preset" → wire is the picked pixel preset (e.g. "1024x1024")
 *  - "auto"   → wire is `ratio:W:H` — pixels left to the upstream */
type SizeMode = "preset" | "auto";

export function SizeSelector({ value, onChange, disabled }: Props) {
  const { t } = useLanguage();

  // Initial state derivation — all three pieces (orientation/ratio/sizeMode)
  // are computed from `value` once on mount. Subsequent changes go through
  // handlers below, so the wire format is reconstituted by `computedValue`.
  const init = deriveInitialState(value);

  const [orientation, setOrientation] = useState<SizeOrientation>(init.orientation);
  const [ratio, setRatio] = useState<string>(init.ratio);
  const [sizePreset, setSizePreset] = useState<string>(init.sizePreset);
  const [sizeMode, setSizeMode] = useState<SizeMode>(init.sizeMode);

  // Custom-ratio inputs (only used when orientation === "custom"). When both
  // are filled the wire value flips to `ratio:W:H` — that's the default for
  // custom orientation. Filling customW/customH below overrides that with
  // explicit pixels.
  const [customRatioW, setCustomRatioW] = useState(init.customRatioW);
  const [customRatioH, setCustomRatioH] = useState(init.customRatioH);

  // Free-form size inputs. When BOTH parse as positive numbers, they override
  // orientation/ratio (the "manual pixels" path).
  const [customW, setCustomW] = useState("");
  const [customH, setCustomH] = useState("");

  const customWNum = Number(customW);
  const customHNum = Number(customH);
  const customSizeActive =
    customW.length > 0 &&
    customH.length > 0 &&
    Number.isFinite(customWNum) &&
    Number.isFinite(customHNum) &&
    customWNum > 0 &&
    customHNum > 0;

  const customRatioActive =
    orientation === "custom" &&
    customRatioW.length > 0 &&
    customRatioH.length > 0 &&
    Number(customRatioW) > 0 &&
    Number(customRatioH) > 0;

  // Single source of truth for what gets submitted. Each branch produces one
  // of: SIZE_AUTO / "ratio:W:H" / "WxH".
  const computedValue = useMemo<string>(() => {
    if (orientation === "auto") return SIZE_AUTO;
    if (customSizeActive) return `${customWNum}x${customHNum}`;
    if (orientation === "custom") {
      // No explicit pixels — fall back to "ratio:W:H" once both ratio inputs
      // are filled. Before that we have no usable wire value, so emit auto.
      return customRatioActive ? makeRatioSize(`${customRatioW}:${customRatioH}`) : SIZE_AUTO;
    }
    if (sizeMode === "auto") return makeRatioSize(ratio);
    return sizePreset;
  }, [
    orientation,
    customSizeActive,
    customWNum,
    customHNum,
    customRatioActive,
    customRatioW,
    customRatioH,
    sizeMode,
    ratio,
    sizePreset,
  ]);

  // Propagate the computed value upward whenever it changes. Skip when the
  // parent already has this value (avoids ping-pong with the useEffect below).
  useEffect(() => {
    if (computedValue !== value) onChange(computedValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [computedValue]);

  const ratiosForOrientation = useMemo(() => {
    if (orientation === "auto" || orientation === "custom") return [];
    return ORIENTATION_RATIOS[orientation];
  }, [orientation]);

  const sizePresetsForRatio = useMemo(() => {
    if (orientation === "custom") return [];
    return RATIO_SIZE_PRESETS[ratio] ?? [];
  }, [orientation, ratio]);

  // === handlers =============================================================

  function selectOrientation(next: SizeOrientation) {
    if (next === orientation) return;
    setOrientation(next);
    if (next === "auto" || next === "custom") {
      // No-op: ratio/sizeMode/sizePreset are irrelevant in those modes.
      // (computedValue reads orientation first, so stale values don't leak.)
      return;
    }
    const r = defaultRatioFor(next);
    setRatio(r);
    setSizePreset(defaultSizeFor(r));
    setSizeMode("auto");
    setCustomW("");
    setCustomH("");
  }

  function selectRatio(next: string) {
    setRatio(next);
    setSizePreset(defaultSizeFor(next));
    // Keep the user's sizeMode preference — if they had picked "auto", a new
    // ratio still means "auto under this ratio". Otherwise stay on "preset".
    setCustomW("");
    setCustomH("");
  }

  function selectSizePreset(next: string) {
    setSizeMode("preset");
    setSizePreset(next);
    setCustomW("");
    setCustomH("");
  }

  function selectSizeAuto() {
    setSizeMode("auto");
    setCustomW("");
    setCustomH("");
  }

  function onCustomWChange(next: string) {
    setCustomW(next.replace(/\D/g, "").slice(0, 4));
  }
  function onCustomHChange(next: string) {
    setCustomH(next.replace(/\D/g, "").slice(0, 4));
  }

  function clearCustomSize() {
    setCustomW("");
    setCustomH("");
  }

  // When the manual-size override is active, the orientation + ratio rows are
  // visually locked. Clicking inside them is suppressed at the button level
  // (the chips themselves are disabled), but we leave the DOM intact so the
  // user sees what's being overridden.
  const overridden = orientation !== "auto" && customSizeActive;
  const autoMode = orientation === "auto";

  // === render ===============================================================

  return (
    <div className="flex flex-col gap-3">
      {/* === Row 1: orientation === */}
      <Row label={t.size.orientationLabel}>
        <div className="flex flex-wrap gap-1.5">
          <Chip
            active={orientation === "auto"}
            onClick={() => selectOrientation("auto")}
            disabled={disabled}
            tone="auto"
          >
            <AutoDot />
            {t.size.orientationAuto}
          </Chip>
          <Chip
            active={orientation === "square"}
            onClick={() => selectOrientation("square")}
            disabled={disabled || overridden}
          >
            <ShapeBox kind="square" />
            {t.size.orientationSquare}
          </Chip>
          <Chip
            active={orientation === "wide"}
            onClick={() => selectOrientation("wide")}
            disabled={disabled || overridden}
          >
            <ShapeBox kind="wide" />
            {t.size.orientationWide}
          </Chip>
          <Chip
            active={orientation === "tall"}
            onClick={() => selectOrientation("tall")}
            disabled={disabled || overridden}
          >
            <ShapeBox kind="tall" />
            {t.size.orientationTall}
          </Chip>
          <Chip
            active={orientation === "custom"}
            onClick={() => selectOrientation("custom")}
            disabled={disabled || overridden}
            tone="accent"
          >
            <ShapeBox kind="custom" />
            {t.size.orientationCustom}
          </Chip>
        </div>
      </Row>

      {/* === Row 2: ratio (or custom WxH inputs) === */}
      {!autoMode && (
        <Row label={t.size.ratioLabel} dim={overridden}>
          {orientation === "custom" ? (
            <div className="flex items-center gap-1.5">
              <Input
                type="text"
                inputMode="numeric"
                value={customRatioW}
                onChange={e => setCustomRatioW(e.target.value.replace(/\D/g, "").slice(0, 3))}
                disabled={disabled || overridden}
                aria-label={t.size.width}
                className="h-7 w-12 text-[12px] tabular-nums text-center px-1.5"
              />
              <span className="text-muted-foreground">:</span>
              <Input
                type="text"
                inputMode="numeric"
                value={customRatioH}
                onChange={e => setCustomRatioH(e.target.value.replace(/\D/g, "").slice(0, 3))}
                disabled={disabled || overridden}
                aria-label={t.size.height}
                className="h-7 w-12 text-[12px] tabular-nums text-center px-1.5"
              />
              <span className="ml-2 text-[10.5px] text-muted-foreground">
                {t.size.customRatioHint}
                {customRatioW && customRatioH ? ` ${customRatioW}:${customRatioH}` : ""}
              </span>
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {ratiosForOrientation.map(r => (
                <Chip
                  key={r}
                  active={ratio === r}
                  onClick={() => selectRatio(r)}
                  disabled={disabled || overridden}
                >
                  {r}
                </Chip>
              ))}
            </div>
          )}
          {overridden && <OverrideNote text={t.size.overrideNote} />}
        </Row>
      )}

      {/* === Row 3: size (auto chip + presets + free-form inputs) === */}
      <Row label={t.size.sizeLabel}>
        {autoMode ? (
          <AutoNote text={t.size.autoNote} />
        ) : (
          <div className="flex flex-col gap-1.5">
            {orientation === "custom" ? (
              <div className="text-[11px] italic text-muted-foreground py-0.5">
                — {t.size.customRatioNoSize} —
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {/* "Auto" chip: pixels free, ratio honored upstream. */}
                <Chip
                  active={!customSizeActive && sizeMode === "auto"}
                  onClick={selectSizeAuto}
                  disabled={disabled}
                  tone="auto"
                >
                  <AutoDot />
                  {t.size.sizeAuto}
                </Chip>
                {sizePresetsForRatio.map(p => (
                  <Chip
                    key={p.value}
                    active={!customSizeActive && sizeMode === "preset" && sizePreset === p.value}
                    onClick={() => selectSizePreset(p.value)}
                    disabled={disabled}
                    mono
                  >
                    {p.value.replace("x", "×")}
                    {p.widelyCompatible && (
                      <span className="ml-0.5 text-accent" aria-hidden="true">
                        ★
                      </span>
                    )}
                  </Chip>
                ))}
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <Input
                type="text"
                inputMode="numeric"
                value={customW}
                onChange={e => onCustomWChange(e.target.value)}
                disabled={disabled}
                aria-label={t.size.width}
                placeholder={t.size.width}
                className="h-7 w-16 text-[12px] tabular-nums text-center px-1.5"
              />
              <span className="text-muted-foreground">×</span>
              <Input
                type="text"
                inputMode="numeric"
                value={customH}
                onChange={e => onCustomHChange(e.target.value)}
                disabled={disabled}
                aria-label={t.size.height}
                placeholder={t.size.height}
                className="h-7 w-16 text-[12px] tabular-nums text-center px-1.5"
              />
              <span className="text-[10.5px] text-muted-foreground">px</span>
              {customSizeActive && (
                <button
                  type="button"
                  onClick={clearCustomSize}
                  disabled={disabled}
                  className="ml-auto inline-flex items-center gap-1 rounded-md border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10.5px] text-accent hover:bg-accent/20"
                >
                  {t.size.clear}
                </button>
              )}
            </div>
            <div className="text-[10.5px] text-muted-foreground">
              {t.size.disclaimer}
              {sizePresetsForRatio.some(p => p.widelyCompatible) && (
                <span className="ml-3 text-muted-foreground/80">
                  {t.size.widelyCompatibleLegend}
                </span>
              )}
            </div>
          </div>
        )}
      </Row>
    </div>
  );
}

interface InitialState {
  orientation: SizeOrientation;
  ratio: string;
  sizePreset: string;
  sizeMode: SizeMode;
  customRatioW: string;
  customRatioH: string;
}

/**
 * One-time wire→state mapping for the initial render. Handles all three wire
 * shapes (auto / pixels / ratio) plus the edge cases (custom-orientation
 * ratios that aren't in the preset table).
 */
function deriveInitialState(value: string): InitialState {
  if (value === SIZE_AUTO) {
    return {
      orientation: "auto",
      ratio: "1:1",
      sizePreset: defaultSizeFor("1:1"),
      sizeMode: "preset",
      customRatioW: "",
      customRatioH: "",
    };
  }
  // `ratio:W:H` — fixed aspect, pixels free.
  if (isRatioSize(value)) {
    const r = extractRatio(value) ?? "";
    const orientation = orientationForRatio(r);
    if (orientation) {
      return {
        orientation,
        ratio: r,
        sizePreset: defaultSizeFor(r),
        sizeMode: "auto",
        customRatioW: "",
        customRatioH: "",
      };
    }
    // Unknown ratio → treat as user-defined custom ratio.
    const m = RATIO_RE.exec(r);
    return {
      orientation: "custom",
      ratio: "1:1",
      sizePreset: defaultSizeFor("1:1"),
      sizeMode: "auto",
      customRatioW: m?.[1] ?? "",
      customRatioH: m?.[2] ?? "",
    };
  }
  // `WxH` — explicit pixels. Try to locate the preset; fall back to custom.
  const hit = lookupPreset(value);
  if (hit) {
    return {
      orientation: hit.orientation,
      ratio: hit.ratio,
      sizePreset: value,
      sizeMode: "preset",
      customRatioW: "",
      customRatioH: "",
    };
  }
  return {
    orientation: "custom",
    ratio: "1:1",
    sizePreset: defaultSizeFor("1:1"),
    sizeMode: "preset",
    customRatioW: "",
    customRatioH: "",
  };
}

// === presentational helpers ==============================================

function Row({
  label,
  children,
  dim,
}: {
  label: string;
  children: React.ReactNode;
  dim?: boolean;
}) {
  return (
    <div className="grid grid-cols-[48px_1fr] items-start gap-x-3">
      <Label
        className={cn(
          "pt-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground",
          dim && "opacity-60",
        )}
      >
        {label}
      </Label>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  disabled,
  tone = "primary",
  mono,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  tone?: "primary" | "accent" | "auto";
  mono?: boolean;
  children: React.ReactNode;
}) {
  const activeStyles =
    tone === "accent"
      ? "bg-accent/12 border-accent/50 text-accent shadow-(--shadow-paper)"
      : tone === "auto"
        ? "bg-primary/10 border-primary/40 text-primary shadow-(--shadow-paper)"
        : "bg-primary/14 border-primary/50 text-primary shadow-(--shadow-paper)";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11.5px] transition disabled:cursor-not-allowed disabled:opacity-40",
        mono && "font-mono tabular-nums",
        active
          ? activeStyles
          : "border-border/60 bg-secondary text-foreground/80 hover:bg-secondary/80",
      )}
    >
      {children}
    </button>
  );
}

function ShapeBox({ kind }: { kind: "square" | "wide" | "tall" | "custom" }) {
  const sz =
    kind === "square"
      ? { w: 10, h: 10 }
      : kind === "wide"
        ? { w: 13, h: 8 }
        : kind === "tall"
          ? { w: 8, h: 13 }
          : { w: 10, h: 10 };
  return (
    <span
      className={cn(
        "inline-block rounded-[1px] border-[1.5px] border-current opacity-70",
        kind === "custom" && "border-dashed",
      )}
      style={{ width: sz.w, height: sz.h }}
      aria-hidden="true"
    />
  );
}

function AutoDot() {
  return (
    <span
      className="inline-block size-2.5 rounded-full"
      style={{
        background: "conic-gradient(from 0deg, var(--primary), var(--accent), var(--primary))",
      }}
      aria-hidden="true"
    />
  );
}

function AutoNote({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-dashed border-primary/35 bg-primary/[0.06] px-2.5 py-1.5 text-[11px] text-muted-foreground">
      <AutoDot />
      <span>{text}</span>
    </div>
  );
}

function OverrideNote({ text }: { text: string }) {
  return (
    <div className="mt-1 flex items-center gap-1 text-[10.5px] text-accent">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="size-3" strokeWidth={1.75}>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 8v4M12 16h.01" />
      </svg>
      <span>{text}</span>
    </div>
  );
}
