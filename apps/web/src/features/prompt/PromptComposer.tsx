import { useEffect, useRef, type FormEvent } from "react";
import { Feather, Loader2, RotateCcw } from "lucide-react";
import { cn } from "../../lib/utils.js";

interface PromptComposerProps {
  value: string;
  onChange: (next: string) => void;
  pending: boolean;
  hasDraft: boolean;
  onSubmit: () => void;
  onCancel?: () => void;
  /**
   * Bumps when an external action (e.g. adopting a hint) appends text to the
   * textarea. The composer scrolls the input into view and focuses it so the
   * user sees the append happen.
   */
  appendNonce?: number;
}

const SAMPLES = [
  "一张电影感的照片:二十多岁的亚洲女人坐在咖啡馆窗边,外面下着小雨,她穿米色针织毛衣,双手捧着冒热气的拿铁,目光看向窗外,午后柔和的光从左侧洒进来",
  "信息图:6 种常见鸟类的喙形状与对应食物,扁平插画风格",
  "复古海报:1950 年代美式漫画风,一只戴眼镜的橘猫坐在打字机前",
];

export function PromptComposer({
  value,
  onChange,
  pending,
  hasDraft,
  onSubmit,
  onCancel,
  appendNonce,
}: PromptComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (appendNonce === undefined) return;
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    // Move caret to end so the user can immediately continue typing.
    requestAnimationFrame(() => {
      el.selectionStart = el.selectionEnd = el.value.length;
    });
  }, [appendNonce]);

  const handle = (e: FormEvent) => {
    e.preventDefault();
    if (!value.trim() || pending) return;
    onSubmit();
  };

  return (
    <form onSubmit={handle} className="flex flex-col gap-3">
      <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        把想法写下来
      </label>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={5}
        placeholder="一张电影感的照片,二十多岁的亚洲女人坐在咖啡馆窗边……"
        disabled={pending}
        className={cn(
          "w-full resize-y rounded-md border border-input bg-card px-4 py-3 text-sm leading-relaxed",
          "shadow-(--shadow-paper) outline-none transition",
          "placeholder:text-muted-foreground/70",
          "focus:border-ring focus:shadow-(--shadow-paper-lifted)",
          "disabled:opacity-60",
        )}
      />

      <div className="flex flex-wrap items-center gap-2">
        {!hasDraft &&
          SAMPLES.map((s, i) => (
            <button
              key={i}
              type="button"
              disabled={pending}
              onClick={() => onChange(s)}
              className={cn(
                "rounded-sm border border-border/60 bg-card px-2 py-1 text-xs text-muted-foreground transition",
                "hover:text-foreground hover:shadow-(--shadow-paper)",
                "disabled:opacity-50",
              )}
            >
              示例 {i + 1}
            </button>
          ))}
        <div className="ml-auto flex items-center gap-2">
          {pending && onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md border border-border/70 bg-card px-3 py-1.5 text-sm text-muted-foreground transition hover:text-foreground"
            >
              取消
            </button>
          )}
          <button
            type="submit"
            disabled={pending || !value.trim()}
            className={cn(
              "inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground",
              "shadow-(--shadow-paper) transition",
              "hover:shadow-(--shadow-paper-lifted)",
              "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:shadow-(--shadow-paper)",
            )}
          >
            {pending ? (
              <>
                <Loader2 className="size-4 animate-spin" strokeWidth={1.75} />
                {hasDraft ? "重新起草中…" : "起草中…"}
              </>
            ) : hasDraft ? (
              <>
                <RotateCcw className="size-4" strokeWidth={1.75} />
                重新起草
              </>
            ) : (
              <>
                <Feather className="size-4" strokeWidth={1.75} />
                起草 prompt
              </>
            )}
          </button>
        </div>
      </div>
    </form>
  );
}
