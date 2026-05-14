import { useMemo } from "react";
import { Combobox } from "@/components/combobox";
import { OptionPicker } from "@/components/option-picker";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useLanguage } from "@/i18n/LanguageContext";
import { cn } from "@/lib/utils";
import type { FieldId, FieldOption } from "./field-dict.js";

interface FieldComboboxProps {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: readonly FieldOption[];
  placeholder?: string;
  aiSuggested?: boolean;
  readOnly?: boolean;
  className?: string;
}

export function FieldCombobox({
  label,
  value,
  onChange,
  options,
  placeholder,
  aiSuggested,
  readOnly,
  className,
}: FieldComboboxProps) {
  const { lang } = useLanguage();
  const localized = useMemo(() => options.map(o => o[lang]), [options, lang]);
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <FieldLabel text={label} aiSuggested={aiSuggested} />
      <Combobox
        value={value}
        onValueChange={onChange}
        options={localized}
        placeholder={placeholder}
        readOnly={readOnly}
      />
    </div>
  );
}

interface FieldPickerProps {
  label: string;
  value: string;
  onChange: (next: string) => void;
  field: FieldId;
  options: readonly FieldOption[];
  placeholder?: string;
  aiSuggested?: boolean;
  readOnly?: boolean;
  className?: string;
}

export function FieldPicker({
  label,
  value,
  onChange,
  field,
  options,
  placeholder,
  aiSuggested,
  readOnly,
  className,
}: FieldPickerProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <FieldLabel text={label} aiSuggested={aiSuggested} />
      <OptionPicker
        field={field}
        options={options}
        value={value}
        onValueChange={onChange}
        fieldLabel={label}
        placeholder={placeholder}
        readOnly={readOnly}
      />
    </div>
  );
}

export function FieldTextarea({
  label,
  value,
  onChange,
  placeholder,
  aiSuggested,
  readOnly,
  rows = 2,
  className,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  aiSuggested?: boolean;
  readOnly?: boolean;
  rows?: number;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <FieldLabel text={label} aiSuggested={aiSuggested} />
      <Textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        readOnly={readOnly}
        rows={rows}
        className="resize-y leading-relaxed"
      />
    </div>
  );
}

export function FieldLabel({
  text,
  aiSuggested,
}: {
  text: string;
  aiSuggested?: boolean;
}) {
  const { t } = useLanguage();
  return (
    <div className="flex items-center justify-between gap-2">
      <Label className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
        {text}
      </Label>
      {aiSuggested && (
        <Badge
          variant="secondary"
          className="h-4 bg-primary/15 px-1.5 py-0 text-[9.5px] font-medium tracking-[0.05em] text-primary"
        >
          {t.editor.aiBadge}
        </Badge>
      )}
    </div>
  );
}
