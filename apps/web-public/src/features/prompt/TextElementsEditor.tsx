import { Plus, Trash2 } from "lucide-react";
import type { TextElement } from "@inkast/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLanguage } from "@/i18n/LanguageContext";
import { FieldCombobox, FieldLabel } from "./FieldCombobox.js";
import { ColorPaletteEditor } from "./ColorPaletteEditor.js";
import {
  TEXT_FONT_OPTIONS,
  TEXT_POSITION_OPTIONS,
  TEXT_SIZE_OPTIONS,
} from "./field-dict.js";

interface TextElementsEditorProps {
  value: TextElement[];
  onChange: (next: TextElement[]) => void;
  readOnly?: boolean;
}

export function TextElementsEditor({
  value,
  onChange,
  readOnly,
}: TextElementsEditorProps) {
  const { t } = useLanguage();

  const updateAt = (index: number, patch: Partial<TextElement>) => {
    const next = value.map((item, i) => (i === index ? { ...item, ...patch } : item));
    onChange(next);
  };

  const removeAt = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };

  const addElement = () => {
    onChange([...value, { content: "" }]);
  };

  if (readOnly && value.length === 0) {
    return <p className="text-xs text-muted-foreground">{t.textElems.emptyReadonly}</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {value.length === 0 && !readOnly && (
        <p className="text-xs text-muted-foreground">{t.textElems.emptyEditable}</p>
      )}

      {value.map((item, i) => (
        <article
          key={i}
          className="rounded-md border border-border/50 bg-background/50 p-3"
        >
          <header className="mb-2.5 flex items-center justify-between">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              {t.textElems.itemPrefix} · {String(i + 1).padStart(2, "0")}
            </span>
            {!readOnly && (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => removeAt(i)}
                title={t.palette.delete}
                className="text-muted-foreground hover:bg-accent/15 hover:text-accent"
              >
                <Trash2 strokeWidth={1.75} />
              </Button>
            )}
          </header>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-4">
            <div className="sm:col-span-4">
              <FieldLabel text={t.textElems.content} />
              <Input
                value={item.content}
                onChange={e => updateAt(i, { content: e.target.value })}
                readOnly={readOnly}
                placeholder={t.textElems.contentPlaceholder}
                className="mt-1.5"
              />
            </div>

            <FieldCombobox
              label={t.textElems.position}
              value={item.position ?? ""}
              onChange={v => updateAt(i, { position: v || undefined })}
              options={TEXT_POSITION_OPTIONS}
              readOnly={readOnly}
              placeholder={t.editor.placeholders.empty}
            />
            <FieldCombobox
              label={t.textElems.font}
              value={item.font ?? ""}
              onChange={v => updateAt(i, { font: v || undefined })}
              options={TEXT_FONT_OPTIONS}
              readOnly={readOnly}
              placeholder={t.editor.placeholders.empty}
            />
            <FieldCombobox
              label={t.textElems.size}
              value={item.size ?? ""}
              onChange={v => updateAt(i, { size: v || undefined })}
              options={TEXT_SIZE_OPTIONS}
              readOnly={readOnly}
              placeholder={t.editor.placeholders.empty}
            />
            <ColorPaletteEditor
              label={t.textElems.color}
              value={item.color ? [item.color] : []}
              onChange={colors =>
                updateAt(i, { color: colors[0] ?? undefined })
              }
              readOnly={readOnly}
              showPresets={false}
            />
          </div>
        </article>
      ))}

      {!readOnly && (
        <Button
          type="button"
          variant="outline"
          onClick={addElement}
          className="justify-center border-dashed text-muted-foreground hover:border-solid hover:text-foreground"
        >
          <Plus strokeWidth={2} />
          {t.textElems.add}
        </Button>
      )}
    </div>
  );
}
