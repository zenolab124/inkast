import { useState } from "react";
import {
  ChevronDown,
  CircleDot,
  Image as ImageIcon,
  ImagePlus,
  Loader2,
  Palette,
  Sun,
  Type,
} from "lucide-react";
import type { ImagePrompt, TextElement } from "@inkast/shared";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/i18n/LanguageContext";
import { cn } from "@/lib/utils";
import { FieldLabel, FieldPicker, FieldTextarea } from "./FieldCombobox.js";
import { ColorPaletteEditor } from "./ColorPaletteEditor.js";
import { TextElementsEditor } from "./TextElementsEditor.js";
import {
  CAMERA_OPTIONS,
  LAYOUT_OPTIONS,
  LIGHTING_OPTIONS,
  MOOD_OPTIONS,
  STYLE_OPTIONS,
  TYPE_OPTIONS,
} from "./field-dict.js";

const KNOWN_KEYS = new Set([
  "type",
  "style",
  "subject",
  "background",
  "layout",
  "lighting",
  "mood",
  "camera",
  "color_palette",
  "text_elements",
  "count",
]);

interface PromptFieldEditorProps {
  value: ImagePrompt;
  onChange: (next: ImagePrompt) => void;
  aiSuggestedFields?: Set<string>;
  meta?: { backend?: string; durationMs?: number };
  pending?: boolean;
  generating?: boolean;
  onGenerate?: () => void;
  readOnly?: boolean;
  /** Collapsed = narrow stub mode (accordion not yet expanded). */
  collapsed?: boolean;
}

export function PromptFieldEditor({
  value,
  onChange,
  aiSuggestedFields,
  meta,
  pending,
  generating,
  onGenerate,
  readOnly,
  collapsed,
}: PromptFieldEditorProps) {
  const { t } = useLanguage();
  const ai = (key: string) =>
    !readOnly && aiSuggestedFields?.has(key) === true;

  const setStr = (key: string, next: string) => {
    const cleaned = { ...value };
    if (next === "") {
      delete cleaned[key as keyof ImagePrompt];
    } else {
      (cleaned as Record<string, unknown>)[key] = next;
    }
    onChange(cleaned);
  };

  const setPalette = (next: string[]) => {
    const cleaned = { ...value };
    if (next.length === 0) {
      delete cleaned.color_palette;
    } else {
      cleaned.color_palette = next;
    }
    onChange(cleaned);
  };

  const setTextElements = (next: TextElement[]) => {
    const cleaned = { ...value };
    if (next.length === 0) {
      delete cleaned.text_elements;
    } else {
      cleaned.text_elements = next;
    }
    onChange(cleaned);
  };

  const extras = Object.entries(value).filter(([k]) => !KNOWN_KEYS.has(k));

  if (collapsed) {
    return <CollapsedStub />;
  }

  return (
    <div
      className={cn(
        "relative flex flex-col gap-4",
        pending && "opacity-60 pointer-events-none",
      )}
    >
      {pending && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <div className="inline-flex items-center gap-2 rounded-md border border-border/60 bg-card px-3 py-1.5 text-sm text-muted-foreground shadow-(--shadow-paper-lifted)">
            <Loader2 className="size-4 animate-spin" strokeWidth={1.75} />
            {t.composer.aiFilling}
          </div>
        </div>
      )}

      {/* 基本 + 氛围 同行(宽屏 2:3,窄屏堆叠) */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_3fr]">
        <Group icon={<CircleDot />} title={t.editor.groups.basic.title} hint={t.editor.groups.basic.hint}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FieldPicker
              label={t.editor.fields.type}
              value={normalizeStringField(value.type)}
              onChange={v => setStr("type", v)}
              field="type"
              options={TYPE_OPTIONS}
              aiSuggested={ai("type")}
              readOnly={readOnly}
              placeholder={t.editor.placeholders.type}
            />
            <FieldPicker
              label={t.editor.fields.style}
              value={normalizeStringField(value.style)}
              onChange={v => setStr("style", v)}
              field="style"
              options={STYLE_OPTIONS}
              aiSuggested={ai("style")}
              readOnly={readOnly}
              placeholder={t.editor.placeholders.style}
            />
          </div>
        </Group>

        <Group icon={<Sun />} title={t.editor.groups.mood.title} hint={t.editor.groups.mood.hint}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <FieldPicker
              label={t.editor.fields.mood}
              value={normalizeStringField(value.mood)}
              onChange={v => setStr("mood", v)}
              field="mood"
              options={MOOD_OPTIONS}
              aiSuggested={ai("mood")}
              readOnly={readOnly}
              placeholder={t.editor.placeholders.empty}
            />
            <FieldPicker
              label={t.editor.fields.lighting}
              value={normalizeStringField(value.lighting)}
              onChange={v => setStr("lighting", v)}
              field="lighting"
              options={LIGHTING_OPTIONS}
              aiSuggested={ai("lighting")}
              readOnly={readOnly}
              placeholder={t.editor.placeholders.empty}
            />
            <FieldPicker
              label={t.editor.fields.camera}
              value={normalizeStringField(value.camera)}
              onChange={v => setStr("camera", v)}
              field="camera"
              options={CAMERA_OPTIONS}
              aiSuggested={ai("camera")}
              readOnly={readOnly}
              placeholder={t.editor.placeholders.empty}
            />
          </div>
        </Group>
      </div>

      {/* 画面 */}
      <Group icon={<ImageIcon />} title={t.editor.groups.scene.title} hint={t.editor.groups.scene.hint}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <FieldTextarea
            label={t.editor.fields.subject}
            value={normalizeStringField(value.subject)}
            onChange={v => setStr("subject", v)}
            aiSuggested={ai("subject")}
            readOnly={readOnly}
            placeholder={t.editor.placeholders.subject}
            className="md:col-span-2"
            rows={2}
          />
          <FieldPicker
            label={t.editor.fields.layout}
            value={normalizeStringField(value.layout)}
            onChange={v => setStr("layout", v)}
            field="layout"
            options={LAYOUT_OPTIONS}
            aiSuggested={ai("layout")}
            readOnly={readOnly}
            placeholder={t.editor.placeholders.layout}
          />
          <FieldTextarea
            label={t.editor.fields.background}
            value={normalizeStringField(value.background)}
            onChange={v => setStr("background", v)}
            aiSuggested={ai("background")}
            readOnly={readOnly}
            placeholder={t.editor.placeholders.background}
            className="md:col-span-3"
            rows={2}
          />
        </div>
      </Group>

      {/* 色彩 */}
      <Group
        icon={<Palette />}
        title={t.editor.groups.colors.title}
        hint={t.editor.groups.colors.hint}
      >
        <ColorPaletteEditor
          label={t.editor.fields.colorPalette}
          value={Array.isArray(value.color_palette) ? value.color_palette : []}
          onChange={setPalette}
          aiSuggested={ai("color_palette")}
          readOnly={readOnly}
        />
      </Group>

      {/* 文字 */}
      <Group
        icon={<Type />}
        title={t.editor.groups.text.title}
        hint={t.editor.groups.text.hint}
      >
        <TextElementsEditor
          value={Array.isArray(value.text_elements) ? value.text_elements : []}
          onChange={setTextElements}
          readOnly={readOnly}
        />
      </Group>

      {/* 其他 / 开放字段兜底 */}
      {extras.length > 0 && (
        <Group icon={<ChevronDown />} title={t.editor.groups.others.title} hint={t.editor.groups.others.hint}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {extras.map(([key, val]) => (
              <div key={key} className="flex flex-col gap-1.5">
                <FieldLabel text={key} />
                <div className="rounded-md border border-input bg-background/70 px-3 py-1.5 text-sm text-muted-foreground">
                  {formatExtra(val)}
                </div>
              </div>
            ))}
          </div>
        </Group>
      )}

      {/* 底部操作区 */}
      {onGenerate && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4">
          <JsonPreview value={value} meta={meta} />
          <Button
            type="button"
            onClick={onGenerate}
            disabled={generating || pending || !canGenerate(value)}
            className="bg-accent text-accent-foreground shadow-(--shadow-paper) hover:bg-accent/90 hover:shadow-(--shadow-paper-lifted)"
          >
            {generating ? (
              <>
                <Loader2 className="animate-spin" strokeWidth={1.75} />
                {t.editor.generate.pending}
              </>
            ) : (
              <>
                <ImagePlus strokeWidth={1.75} />
                {t.editor.generate.ready}
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

function Group({
  icon,
  title,
  hint,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-md border border-border/60 bg-card p-5 shadow-(--shadow-paper)">
      <header className="mb-3.5 flex items-center justify-between gap-2 border-b border-border/50 pb-2.5">
        <div className="flex items-center gap-2">
          <span className="text-primary [&_svg]:size-4 [&_svg]:stroke-[1.5]">
            {icon}
          </span>
          <h3 className="text-[13px] font-medium tracking-wide">{title}</h3>
        </div>
        {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
      </header>
      {children}
    </section>
  );
}

function JsonPreview({
  value,
  meta,
}: {
  value: ImagePrompt;
  meta?: { backend?: string; durationMs?: number };
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const json = JSON.stringify(value, null, 2);

  return (
    <div className="flex flex-1 flex-col gap-2">
      <div className="flex items-center gap-3 text-[11.5px] text-muted-foreground">
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => setOpen(o => !o)}
          className="h-auto gap-1 px-1 py-0 font-normal text-muted-foreground hover:bg-transparent hover:text-foreground"
        >
          <ChevronDown
            className={cn("size-3 transition", open && "rotate-180")}
            strokeWidth={2}
          />
          {open ? t.editor.json.hide : t.editor.json.show}
        </Button>
        {meta && (
          <span>
            {meta.backend}
            {meta.durationMs ? ` · ${(meta.durationMs / 1000).toFixed(1)}s` : ""}
          </span>
        )}
      </div>
      {open && (
        <div className="relative">
          <pre className="max-h-64 overflow-auto rounded-md border border-border/60 bg-background/70 p-3 font-mono text-[11.5px] leading-relaxed text-muted-foreground">
            {json}
          </pre>
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={async () => {
              await navigator.clipboard.writeText(json);
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            }}
            className="absolute right-2 top-2 text-muted-foreground"
          >
            {copied ? t.editor.json.copied : t.editor.json.copy}
          </Button>
        </div>
      )}
    </div>
  );
}

function canGenerate(p: ImagePrompt): boolean {
  return Boolean(
    normalizeStringField(p.type) &&
      normalizeStringField(p.style) &&
      normalizeStringField(p.subject),
  );
}

function formatExtra(val: unknown): string {
  if (val == null) return "∅";
  if (typeof val === "string") return val;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  return JSON.stringify(val);
}

function CollapsedStub() {
  const { t } = useLanguage();
  return (
    <div className="flex h-full flex-col gap-2">
      <span className="px-1 text-center text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
        {t.editor.collapsed.title}
      </span>
      <div className="flex flex-1 flex-col gap-2">
        {t.editor.collapsed.groupNames.map((name, i) => (
          <div
            key={name}
            className="flex flex-1 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border/50 bg-background/50 px-2 py-3"
          >
            <span className="text-[9px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
              {i + 1}
            </span>
            <span className="text-xs font-medium text-foreground/65">{name}</span>
          </div>
        ))}
      </div>
      <div className="rounded-md border border-dashed border-primary/30 bg-primary/5 px-2.5 py-2 text-center text-[10.5px] leading-relaxed text-primary">
        {t.editor.collapsed.tipExpand}
      </div>
    </div>
  );
}

function normalizeStringField(val: unknown): string {
  if (val == null) return "";
  if (typeof val === "string") return val;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  if (typeof val === "object") {
    const obj = val as Record<string, unknown>;
    for (const k of ["description", "text", "value", "content", "name"]) {
      if (typeof obj[k] === "string") return obj[k] as string;
    }
    try {
      return JSON.stringify(val);
    } catch {
      return "";
    }
  }
  return "";
}
