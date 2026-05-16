import { useEffect, useMemo, useState } from "react";
import {
  Cpu,
  GripVertical,
  ImageIcon,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash2,
} from "lucide-react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  BUILTIN_CLAUDE_CODE_PROVIDER_ID,
  type CapabilityInput,
  type ProviderCapability,
  type ProviderKind,
  type ProviderSummary,
} from "@inkast/shared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Combobox } from "@/components/combobox";
import { useLanguage } from "@/i18n/LanguageContext";
import { cn } from "@/lib/utils";
import {
  createProvider,
  deleteProvider,
  listProviders,
  patchCapability,
  probeModels,
  reorderProviders,
  updateProvider,
} from "./api.js";

interface Props {
  open: boolean;
  onClose: () => void;
  onChange?: (providers: ProviderSummary[]) => void;
}

interface FormState {
  id: string | null;
  name: string;
  baseUrl: string;
  apiKey: string;
  // Per-kind model fields. Empty string means the kind is not selected.
  imageModel: string;
  llmModel: string;
}

const DEFAULT_MODEL: Record<ProviderKind, string> = {
  image: "gpt-image-2",
  llm: "gpt-4o-mini",
};

function emptyForm(): FormState {
  return {
    id: null,
    name: "",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    imageModel: DEFAULT_MODEL.image,
    llmModel: "",
  };
}

function buildFormFromProvider(p: ProviderSummary): FormState {
  const image = p.capabilities.find(c => c.kind === "image");
  const llm = p.capabilities.find(c => c.kind === "llm");
  return {
    id: p.id,
    name: p.name,
    baseUrl: p.baseUrl,
    apiKey: "",
    imageModel: image?.model ?? "",
    llmModel: llm?.model ?? "",
  };
}

function formToCapabilities(form: FormState): CapabilityInput[] {
  const caps: CapabilityInput[] = [];
  if (form.imageModel.trim()) {
    caps.push({ kind: "image", model: form.imageModel.trim() });
  }
  if (form.llmModel.trim()) {
    caps.push({ kind: "llm", model: form.llmModel.trim() });
  }
  return caps;
}

function capabilityOf(p: ProviderSummary, kind: ProviderKind): ProviderCapability | undefined {
  return p.capabilities.find(c => c.kind === kind);
}

export function ProviderConfigDialog({ open, onClose, onChange }: Props) {
  const { t } = useLanguage();
  const [providers, setProviders] = useState<ProviderSummary[] | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<ProviderKind>("image");
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [probing, setProbing] = useState(false);

  useEffect(() => {
    if (!open) return;
    refresh();
  }, [open]);

  // Probed model list is form-scoped — switching to a different provider edit
  // session, opening a fresh add form, or closing the form should drop the
  // list so we don't show one provider's models under another's form.
  useEffect(() => {
    setModelOptions([]);
  }, [form?.id, form === null]);

  const providersForTab = useMemo(() => {
    if (providers === null) return null;
    return providers
      .filter(p => capabilityOf(p, tab) !== undefined)
      .sort(
        (a, b) =>
          (capabilityOf(a, tab)?.priority ?? 0) - (capabilityOf(b, tab)?.priority ?? 0),
      );
  }, [providers, tab]);

  async function refresh() {
    setError(null);
    try {
      const list = await listProviders();
      setProviders(list);
      onChange?.(list);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function save() {
    if (!form) return;
    setError(null);
    const capabilities = formToCapabilities(form);
    if (capabilities.length === 0) {
      setError(t.config.errors.needsKind);
      return;
    }
    setPending(true);
    try {
      const baseUrl = form.baseUrl.trim();
      const name = form.name.trim();
      if (form.id) {
        await updateProvider(form.id, {
          name,
          baseUrl,
          capabilities,
          apiKey: form.apiKey.trim() || undefined,
        });
      } else {
        if (!form.apiKey.trim()) throw new Error(t.config.errors.apiKeyRequired);
        await createProvider({
          name,
          baseUrl,
          apiKey: form.apiKey.trim(),
          capabilities,
        });
      }
      setForm(null);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  async function remove(id: string) {
    if (!confirm(t.config.confirmDelete)) return;
    setError(null);
    try {
      await deleteProvider(id);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  /**
   * Hit /api/probe-models with the form's current baseUrl/apiKey (or the
   * existing provider's stored creds if the user hasn't typed a new key).
   * Populates `modelOptions` so the model Comboboxes light up with real
   * choices. The same options list is reused across both kinds — the model
   * names already encode which kind they belong to (gpt-4o vs gpt-image-2),
   * and any ambiguity is fine since user can still type freely.
   */
  async function refreshModels() {
    if (!form) return;
    setError(null);
    setProbing(true);
    try {
      const baseUrl = form.baseUrl.trim();
      const apiKey = form.apiKey.trim();
      let list: string[];
      if (form.id && !apiKey) {
        // Editing existing provider, user didn't re-type key — let server use stored key
        list = await probeModels({ providerId: form.id });
      } else {
        if (!baseUrl || !apiKey) throw new Error(t.config.errors.probeNeedsBoth);
        list = await probeModels({ baseUrl, apiKey });
      }
      setModelOptions(list);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setProbing(false);
    }
  }

  async function toggleDisabled(providerId: string, kind: ProviderKind, disabled: boolean) {
    setError(null);
    try {
      await patchCapability(providerId, kind, { disabled });
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id || providersForTab === null) return;

    const oldIndex = providersForTab.findIndex(p => p.id === active.id);
    const newIndex = providersForTab.findIndex(p => p.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const reordered = arrayMove(providersForTab, oldIndex, newIndex);
    const reorderedIds = new Set(reordered.map(p => p.id));
    // Optimistic UI: compute final priorities locally and update in ONE shot.
    // dnd-kit plays a drop animation right after handleDragEnd returns; a
    // second setProviders after the server response would interrupt that
    // animation mid-flight and cause a visible "jump" / flicker. Since the
    // server just confirms what we already computed (priority = index+1 in
    // the new order), we don't need its response to update local state.
    const newPriorityFor = new Map(
      reordered.map((p, idx) => [p.id, idx + 1]),
    );
    const optimistic = (providers ?? []).map(p => {
      if (!reorderedIds.has(p.id)) return p;
      return {
        ...p,
        capabilities: p.capabilities.map(c =>
          c.kind === tab ? { ...c, priority: newPriorityFor.get(p.id)! } : c,
        ),
      };
    });
    setProviders(optimistic);
    onChange?.(optimistic);

    try {
      await reorderProviders(tab, reordered.map(p => p.id));
    } catch (err) {
      setError((err as Error).message);
      // Roll back by refetching authoritative state.
      refresh();
    }
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="flex max-h-[80vh] w-full max-w-2xl flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <header className="flex items-center gap-2 border-b border-border/60 px-6 py-4 pr-12">
          <KeyRound className="size-4 text-primary" strokeWidth={1.5} />
          <DialogTitle className="text-base font-medium">{t.config.title}</DialogTitle>
          <DialogDescription className="sr-only">{t.config.description}</DialogDescription>
        </header>

        <Tabs
          value={tab}
          onValueChange={v => {
            setTab(v as ProviderKind);
            setForm(null);
          }}
          className="flex flex-1 flex-col overflow-hidden"
        >
          <div className="border-b border-border/60 px-6 py-2">
            <TabsList>
              <TabsTrigger value="image">
                <ImageIcon strokeWidth={1.5} />
                {t.config.tabs.image}
              </TabsTrigger>
              <TabsTrigger value="llm">
                <Cpu strokeWidth={1.5} />
                {t.config.tabs.llm}
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-5">
            {error && (
              <Alert variant="destructive" className="mb-4 rounded-md">
                <AlertTitle>{t.config.error}</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <TabsContent value={tab} className="mt-0 space-y-3">
              {providersForTab === null ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" strokeWidth={1.75} />
                  {t.config.loading}
                </div>
              ) : providersForTab.length === 0 ? (
                <div className="rounded-sm border border-dashed border-border bg-background px-4 py-6 text-center text-sm text-muted-foreground">
                  {tab === "llm" ? t.config.noneLlm : t.config.none}
                </div>
              ) : (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext items={providersForTab.map(p => p.id)} strategy={verticalListSortingStrategy}>
                    <ul className="flex flex-col gap-2">
                      {providersForTab.map((p, idx) => (
                        <SortableRow
                          key={p.id}
                          provider={p}
                          kind={tab}
                          rank={idx + 1}
                          isTop={idx === 0}
                          onEdit={() => setForm(buildFormFromProvider(p))}
                          onDelete={() => remove(p.id)}
                          onToggleDisabled={d => toggleDisabled(p.id, tab, d)}
                        />
                      ))}
                    </ul>
                  </SortableContext>
                </DndContext>
              )}

            </TabsContent>

            {form && (
              <div className="mt-4 rounded-sm border border-primary/30 bg-primary/5 p-4">
                <h3 className="mb-3 text-sm font-medium">
                  {form.id ? t.config.edit : t.config.addNew}
                </h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field
                    label={t.config.fields.name}
                    value={form.name}
                    onChange={v => setForm({ ...form, name: v })}
                    placeholder="OpenAI"
                  />
                  <Field
                    label={form.id ? t.config.fields.apiKeyEdit : t.config.fields.apiKey}
                    value={form.apiKey}
                    onChange={v => setForm({ ...form, apiKey: v })}
                    placeholder="sk-…"
                    type="password"
                  />
                  <Field
                    label={t.config.fields.baseUrl}
                    value={form.baseUrl}
                    onChange={v => setForm({ ...form, baseUrl: v })}
                    placeholder="https://api.openai.com/v1"
                    className="sm:col-span-2"
                  />
                </div>

                <div className="mt-4 flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      {t.config.capabilities}
                    </Label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      onClick={refreshModels}
                      disabled={probing}
                      className="h-auto px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                      title={t.config.probeHint}
                    >
                      {probing ? (
                        <Loader2 className="animate-spin" strokeWidth={1.75} />
                      ) : (
                        <RefreshCw strokeWidth={1.75} />
                      )}
                      {t.config.probeModels}
                      {modelOptions.length > 0 && (
                        <span className="text-muted-foreground">({modelOptions.length})</span>
                      )}
                    </Button>
                  </div>
                  <KindRow
                    label={t.config.tabs.image}
                    icon={<ImageIcon strokeWidth={1.5} className="size-4" />}
                    enabled={form.imageModel.trim().length > 0}
                    onToggle={on =>
                      setForm({
                        ...form,
                        imageModel: on ? DEFAULT_MODEL.image : "",
                      })
                    }
                    model={form.imageModel}
                    onModelChange={v => setForm({ ...form, imageModel: v })}
                    options={modelOptions}
                  />
                  <KindRow
                    label={t.config.tabs.llm}
                    icon={<Cpu strokeWidth={1.5} className="size-4" />}
                    enabled={form.llmModel.trim().length > 0}
                    onToggle={on =>
                      setForm({
                        ...form,
                        llmModel: on ? DEFAULT_MODEL.llm : "",
                      })
                    }
                    model={form.llmModel}
                    onModelChange={v => setForm({ ...form, llmModel: v })}
                    options={modelOptions}
                  />
                </div>

                <div className="mt-4 flex justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setForm(null)}
                    disabled={pending}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    {t.config.cancel}
                  </Button>
                  <Button
                    size="sm"
                    onClick={save}
                    disabled={pending || !form.name.trim() || !form.baseUrl.trim()}
                  >
                    {pending ? (
                      <Loader2 className="animate-spin" strokeWidth={1.75} />
                    ) : (
                      <Save strokeWidth={1.75} />
                    )}
                    {t.config.save}
                  </Button>
                </div>
              </div>
            )}
          </div>

          <footer className="border-t border-border/60 px-6 py-3">
            {!form && (
              <Button size="sm" onClick={() => setForm(emptyForm())}>
                <Plus strokeWidth={1.75} />
                {t.config.addNew}
              </Button>
            )}
          </footer>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function SortableRow({
  provider,
  kind,
  rank,
  isTop,
  onEdit,
  onDelete,
  onToggleDisabled,
}: {
  provider: ProviderSummary;
  kind: ProviderKind;
  rank: number;
  isTop: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onToggleDisabled: (next: boolean) => void;
}) {
  const { t } = useLanguage();
  const cap = capabilityOf(provider, kind)!;
  const isBuiltin = provider.id === BUILTIN_CLAUDE_CODE_PROVIDER_ID;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: provider.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const effectiveDefault = isTop && !cap.disabled && kind === "llm";

  return (
    <li
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        "flex items-start gap-2 rounded-sm border bg-background px-3 py-3 transition-shadow cursor-grab touch-none active:cursor-grabbing",
        cap.disabled ? "border-border/40 opacity-60" : "border-border/70",
        effectiveDefault && "border-primary/60",
        isDragging && "z-10 shadow-(--shadow-paper-lifted)",
      )}
      title={t.config.dragToReorder}
    >
      <GripVertical
        strokeWidth={1.5}
        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
        aria-hidden
      />
      <div className="flex-1 space-y-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground">#{rank}</span>
          <span className="text-sm font-medium">{provider.name}</span>
          {isBuiltin && (
            <span className="rounded-sm bg-secondary px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              {t.config.builtinTag}
            </span>
          )}
          {effectiveDefault && (
            <span className="rounded-sm bg-primary/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-primary">
              {t.config.activeDefault}
            </span>
          )}
          {!isBuiltin && (
            <span className="text-xs text-muted-foreground">· {cap.model}</span>
          )}
        </div>
        {isBuiltin ? (
          <div className="text-xs text-muted-foreground">{t.config.builtin.claudeCodeDesc}</div>
        ) : (
          <>
            <div className="text-xs text-muted-foreground">{provider.baseUrl}</div>
            <div className="font-mono text-xs text-muted-foreground">
              key {provider.keyMasked}
            </div>
          </>
        )}
      </div>
      <div
        className="flex shrink-0 items-center gap-2 cursor-auto"
        onPointerDown={e => e.stopPropagation()}
      >
        <Switch
          checked={!cap.disabled}
          onCheckedChange={on => onToggleDisabled(!on)}
          aria-label={t.config.enable}
        />
        {!isBuiltin && (
          <>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={onEdit}
              className="text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <Pencil strokeWidth={1.75} />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={onDelete}
              className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 strokeWidth={1.75} />
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

function KindRow({
  label,
  icon,
  enabled,
  onToggle,
  model,
  onModelChange,
  options,
}: {
  label: string;
  icon: React.ReactNode;
  enabled: boolean;
  onToggle: (next: boolean) => void;
  model: string;
  onModelChange: (next: string) => void;
  options: string[];
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-sm border bg-background px-3 py-2.5",
        enabled ? "border-border/70" : "border-border/40 opacity-70",
      )}
    >
      <Checkbox checked={enabled} onCheckedChange={v => onToggle(v === true)} />
      <div className="flex items-center gap-1.5 text-sm">
        {icon}
        <span>{label}</span>
      </div>
      <div className="ml-auto w-56">
        <Combobox
          value={model}
          onValueChange={onModelChange}
          options={options}
          placeholder="model id"
          readOnly={!enabled}
        />
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  className,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  type?: "text" | "password";
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </Label>
      <Input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}
