import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/i18n/LanguageContext";
import { PALETTE_PRESETS } from "./field-dict.js";
import { FieldLabel } from "./FieldCombobox.js";

interface ColorPaletteEditorProps {
  label: string;
  value: string[];
  onChange: (next: string[]) => void;
  aiSuggested?: boolean;
  readOnly?: boolean;
  showPresets?: boolean;
}

export function ColorPaletteEditor({
  label,
  value,
  onChange,
  aiSuggested,
  readOnly,
  showPresets = true,
}: ColorPaletteEditorProps) {
  const { t, lang } = useLanguage();

  const updateAt = (index: number, hex: string) => {
    const next = [...value];
    next[index] = hex;
    onChange(next);
  };

  const removeAt = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  const addColor = () => {
    onChange([...value, "#888888"]);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel text={label} aiSuggested={aiSuggested} />
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-input bg-background/70 px-2.5 py-2">
        {value.length === 0 && !readOnly && (
          <span className="text-xs text-muted-foreground">{t.palette.emptyEditable}</span>
        )}
        {value.length === 0 && readOnly && (
          <span className="text-xs text-muted-foreground">{t.palette.emptyReadonly}</span>
        )}
        {value.map((hex, i) => (
          <Swatch
            key={i}
            hex={hex}
            readOnly={readOnly}
            deleteTitle={t.palette.delete}
            onChange={next => updateAt(i, next)}
            onRemove={() => removeAt(i)}
          />
        ))}
        {!readOnly && (
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={addColor}
            className="h-6 border-dashed text-muted-foreground hover:border-solid hover:text-foreground"
          >
            <Plus strokeWidth={2} />
            {t.palette.add}
          </Button>
        )}
      </div>

      {!readOnly && showPresets && (
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <span>{t.palette.presetLabel}</span>
          {PALETTE_PRESETS.map(p => (
            <Button
              key={p.key}
              type="button"
              variant="outline"
              size="xs"
              onClick={() => onChange([...p.colors])}
              className="h-auto gap-1.5 rounded-full bg-card px-2 py-0.5 text-[11px] font-normal text-foreground"
            >
              <span className="inline-flex gap-px">
                {p.colors.map(c => (
                  <i
                    key={c}
                    className="inline-block size-2 rounded-full border border-border/70"
                    style={{ backgroundColor: c }}
                  />
                ))}
              </span>
              {p[lang]}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

function Swatch({
  hex,
  readOnly,
  deleteTitle,
  onChange,
  onRemove,
}: {
  hex: string;
  readOnly?: boolean;
  deleteTitle: string;
  onChange: (next: string) => void;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-card py-0.5 pl-0.5 pr-1.5 font-mono text-[11px] text-muted-foreground">
      <span
        className="relative inline-block size-4 overflow-hidden rounded-[3px] border border-border/70"
        style={{ backgroundColor: hex }}
      >
        {!readOnly && (
          // Native color picker — no shadcn equivalent; intentionally raw.
          <input
            type="color"
            value={normalizeHex(hex)}
            onChange={e => onChange(e.target.value)}
            className="absolute -inset-1 cursor-pointer opacity-0"
            aria-label="color"
          />
        )}
      </span>
      {hex}
      {!readOnly && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={onRemove}
          title={deleteTitle}
          className="size-3.5 rounded-sm text-muted-foreground hover:bg-accent/15 hover:text-accent"
        >
          <X className="size-2.5" strokeWidth={2.25} />
        </Button>
      )}
    </span>
  );
}

function normalizeHex(hex: string): string {
  if (/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  if (/^#[0-9a-f]{3}$/i.test(hex)) {
    const [, r, g, b] = hex;
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return "#888888";
}
