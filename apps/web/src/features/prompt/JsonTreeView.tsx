/**
 * Compact JSON tree view, tailored for image-prompt drafts.
 *
 * Renders key-value rows for objects, indexed rows for arrays, and shows
 * primitives inline. Colors are sourced from theme tokens (no literals).
 */

interface JsonTreeViewProps {
  data: unknown;
  level?: number;
}

export function JsonTreeView({ data, level = 0 }: JsonTreeViewProps) {
  if (data === null || data === undefined) {
    return <span className="text-muted-foreground">∅</span>;
  }

  if (typeof data === "string") {
    return <span className="text-foreground">{data}</span>;
  }
  if (typeof data === "number" || typeof data === "boolean") {
    return <span className="text-primary">{String(data)}</span>;
  }

  if (Array.isArray(data)) {
    if (data.length === 0) {
      return <span className="text-muted-foreground">[ ]</span>;
    }
    // Hex color palette renders nicely as inline swatches.
    if (data.every(it => typeof it === "string" && /^#[0-9a-f]{3,8}$/i.test(it))) {
      return (
        <div className="flex flex-wrap items-center gap-1.5">
          {(data as string[]).map(hex => (
            <span
              key={hex}
              className="inline-flex items-center gap-1 rounded-sm border border-border/60 px-1.5 py-0.5 text-xs"
            >
              <span
                className="size-3 rounded-xs border border-border/60"
                style={{ backgroundColor: hex }}
              />
              <code className="text-muted-foreground">{hex}</code>
            </span>
          ))}
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-1">
        {data.map((item, i) => (
          <div key={i} className="flex gap-2">
            <span className="shrink-0 select-none text-xs text-muted-foreground">
              [{i}]
            </span>
            <div className="flex-1">
              <JsonTreeView data={item} level={level + 1} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (typeof data === "object") {
    const entries = Object.entries(data as Record<string, unknown>);
    if (entries.length === 0) {
      return <span className="text-muted-foreground">{"{ }"}</span>;
    }
    return (
      <div className={level === 0 ? "flex flex-col gap-3" : "flex flex-col gap-1.5"}>
        {entries.map(([key, value]) => (
          <JsonRow key={key} fieldKey={key} value={value} level={level} />
        ))}
      </div>
    );
  }

  return <span>{String(data)}</span>;
}

function JsonRow({
  fieldKey,
  value,
  level,
}: {
  fieldKey: string;
  value: unknown;
  level: number;
}) {
  const isComplex =
    value !== null &&
    typeof value === "object" &&
    (Array.isArray(value) ? value.length > 0 : Object.keys(value).length > 0);

  if (isComplex) {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {fieldKey}
        </div>
        <div className="border-l border-border/60 pl-3">
          <JsonTreeView data={value} level={level + 1} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span className="shrink-0 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {fieldKey}
      </span>
      <span className="text-sm leading-snug">
        <JsonTreeView data={value} level={level + 1} />
      </span>
    </div>
  );
}
