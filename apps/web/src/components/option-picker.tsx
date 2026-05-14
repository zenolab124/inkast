import * as React from "react";
import { ChevronDown, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useLanguage } from "@/i18n/LanguageContext";
import { cn } from "@/lib/utils";
import {
  findOptionKey,
  localizedDesc,
  localizedLabel,
  type FieldId,
  type FieldOption,
} from "@/features/prompt/field-dict";
import { PreviewIcon } from "@/features/prompt/PreviewIcon";

interface OptionPickerProps {
  field: FieldId;
  options: readonly FieldOption[];
  value: string;
  onValueChange: (next: string) => void;
  /** Free-text label to show in the dialog title (e.g. "Style", "Type"). */
  fieldLabel: string;
  placeholder?: string;
  readOnly?: boolean;
}

export function OptionPicker({
  field,
  options,
  value,
  onValueChange,
  fieldLabel,
  placeholder,
  readOnly,
}: OptionPickerProps) {
  const { t, lang } = useLanguage();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [custom, setCustom] = React.useState("");

  React.useEffect(() => {
    if (open) {
      setQuery("");
      setCustom(matchesAny(options, value, lang) ? "" : value);
    }
  }, [open, value, options, lang]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(o => {
      return (
        o.zh.toLowerCase().includes(q) ||
        o.en.toLowerCase().includes(q) ||
        (o.descZh?.toLowerCase().includes(q) ?? false) ||
        (o.descEn?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [query, options]);

  const pick = (next: string) => {
    onValueChange(next);
    setOpen(false);
  };

  const confirmCustom = () => {
    const v = custom.trim();
    if (v) pick(v);
  };

  const currentKey = findOptionKey(options as FieldOption[], value);

  return (
    <>
      <button
        type="button"
        disabled={readOnly}
        onClick={() => !readOnly && setOpen(true)}
        className={cn(
          "flex w-full items-center gap-2 rounded-md border border-input bg-background/70 px-2 py-1 text-left text-sm",
          "outline-none transition focus-visible:border-ring focus-visible:shadow-(--shadow-paper)",
          "hover:border-ring/60",
          "disabled:cursor-default disabled:opacity-90",
        )}
      >
        <PreviewIcon
          field={field}
          optionKey={currentKey}
          size={32}
          aspect={
            currentKey
              ? options.find(o => o.key === currentKey)?.aspect
              : undefined
          }
          className="shrink-0"
        />
        <span
          className={cn(
            "flex-1 truncate",
            value ? "text-foreground" : "text-muted-foreground/70",
          )}
        >
          {value || placeholder || t.picker.titlePrefix}
        </span>
        {!readOnly && (
          <ChevronDown
            className="size-3.5 shrink-0 text-muted-foreground"
            strokeWidth={1.75}
          />
        )}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[85vh] w-full max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
          <header className="flex items-center gap-2 border-b border-border/60 px-6 py-4 pr-12">
            <DialogTitle className="text-base font-medium">
              {t.picker.titlePrefix} {fieldLabel}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {t.picker.titlePrefix} {fieldLabel}
            </DialogDescription>
          </header>

          <div className="border-b border-border/60 px-6 py-3">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                strokeWidth={1.75}
              />
              <Input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={t.picker.search}
                autoFocus
                className="pl-8"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-4">
            {filtered.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                {t.picker.noMatch}
              </p>
            ) : (
              <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {filtered.map(opt => {
                  const selected = opt[lang] === value || opt.zh === value || opt.en === value;
                  return (
                    <li key={opt.key}>
                      <button
                        type="button"
                        onClick={() => pick(localizedLabel(opt, lang))}
                        className={cn(
                          "group flex w-full flex-col gap-2.5 rounded-md border bg-background/70 p-3 text-left transition",
                          "hover:border-ring/60 hover:shadow-(--shadow-paper)",
                          selected
                            ? "border-primary/60 ring-2 ring-primary/20"
                            : "border-border/60",
                        )}
                      >
                        <div className="flex w-full items-center justify-center">
                          <PreviewIcon
                            field={field}
                            optionKey={opt.key}
                            size={140}
                            aspect={opt.aspect}
                          />
                        </div>
                        <div className="w-full">
                          <div className="text-sm font-medium leading-tight">
                            {localizedLabel(opt, lang)}
                          </div>
                          {localizedDesc(opt, lang) && (
                            <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                              {localizedDesc(opt, lang)}
                            </div>
                          )}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <footer className="flex items-center gap-2 border-t border-border/60 px-6 py-3">
            <Input
              value={custom}
              onChange={e => setCustom(e.target.value)}
              placeholder={t.picker.customPlaceholder}
              className="flex-1"
              onKeyDown={e => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  confirmCustom();
                }
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              {t.picker.cancel}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={confirmCustom}
              disabled={!custom.trim()}
            >
              {t.picker.confirm}
            </Button>
          </footer>
        </DialogContent>
      </Dialog>
    </>
  );
}

function matchesAny(
  options: readonly FieldOption[],
  value: string,
  lang: "zh" | "en",
): boolean {
  if (!value) return true;
  return options.some(
    o => o[lang] === value || o.zh === value || o.en === value,
  );
}
