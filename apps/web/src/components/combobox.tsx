import * as React from "react";
import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface ComboboxProps {
  value: string;
  onValueChange: (next: string) => void;
  options: readonly string[];
  placeholder?: string;
  readOnly?: boolean;
  className?: string;
  emptyText?: string;
}

/**
 * Free-typing combobox built on shadcn Popover + Command.
 * Input drives both the value and the candidate filter — users can either
 * pick from the dropdown or enter a custom value the options list doesn't
 * cover. Matches Inkast's "preset suggestions + free input" pattern.
 */
export function Combobox({
  value,
  onValueChange,
  options,
  placeholder,
  readOnly,
  className,
  emptyText = "无匹配,可直接输入自定义值",
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  // After picking, we refocus the input — but that triggers onFocus which would
  // re-open the popover mid close-animation. This flag skips the next onFocus
  // re-open.
  const skipNextFocusOpenRef = React.useRef(false);

  const filtered = React.useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return options;
    return options.filter(o => o.toLowerCase().includes(q));
  }, [value, options]);

  const pick = (next: string) => {
    onValueChange(next);
    setOpen(false);
    skipNextFocusOpenRef.current = true;
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      requestAnimationFrame(() => {
        skipNextFocusOpenRef.current = false;
      });
    });
  };

  return (
    <Popover open={open && !readOnly} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className={cn("relative", className)}>
          <Input
            ref={inputRef}
            value={value}
            onChange={e => {
              onValueChange(e.target.value);
              if (!open && !readOnly) setOpen(true);
            }}
            onFocus={() => {
              if (readOnly) return;
              if (skipNextFocusOpenRef.current) return;
              setOpen(true);
            }}
            onKeyDown={e => {
              if (e.key === "Escape" && open) {
                e.preventDefault();
                setOpen(false);
              }
            }}
            readOnly={readOnly}
            placeholder={placeholder}
            autoComplete="off"
            className="pr-8"
          />
          {!readOnly && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              tabIndex={-1}
              onMouseDown={e => {
                e.preventDefault();
                setOpen(o => !o);
                inputRef.current?.focus();
              }}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:bg-transparent hover:text-foreground"
            >
              <ChevronDown
                className={cn("transition", open && "rotate-180")}
                strokeWidth={1.75}
              />
            </Button>
          )}
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-(--radix-popover-trigger-width) p-0"
        onOpenAutoFocus={e => e.preventDefault()}
      >
        <Command shouldFilter={false}>
          <CommandList>
            {filtered.length === 0 ? (
              <CommandEmpty>{emptyText}</CommandEmpty>
            ) : (
              <CommandGroup>
                {filtered.map(opt => (
                  <CommandItem
                    key={opt}
                    value={opt}
                    onSelect={() => pick(opt)}
                    className="cursor-pointer"
                  >
                    <span className="flex-1 truncate">{opt}</span>
                    {opt === value && (
                      <Check className="size-3.5 text-primary" strokeWidth={2} />
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
