import type {
  AmbiguityHint,
  ImagePrompt,
  LlmBackend,
  LlmBackendDescriptor,
  OutputLang,
  PromptDraft,
  TextElement,
} from "@inkast/shared";
import { getLlmDriver } from "../../drivers/llm/index.js";
import { getPromptEngineSystemPrompt } from "./system-prompt.js";

export interface DraftPromptInput {
  input: string;
  backend?: LlmBackendDescriptor;
  lang?: OutputLang;
  /**
   * Optional system prompt suffix appended after the engine's base instructions.
   * Used by the plugin channel to inject per-caller business constraints
   * (e.g. snapub's "no text / no frame / SFW" patch). Web UI callers do not
   * pass this — they get the unmodified imagegen methodology prompt.
   */
  systemPromptSuffix?: string;
  signal?: AbortSignal;
}

export interface DraftPromptOutcome {
  draft: PromptDraft;
  raw: string;
  backend: LlmBackend;
  durationMs: number;
}

/**
 * Run the prose → structured JSON prompt engine.
 *
 * The model is instructed to return strict JSON matching { prompt, hints }.
 * We validate the shape minimally — type/style/subject must be present —
 * but otherwise pass the model's structure through, since the schema is
 * intentionally open (callers and the LLM may invent new fields per the
 * imagegen methodology).
 */
export async function draftPrompt(input: DraftPromptInput): Promise<DraftPromptOutcome> {
  const trimmed = input.input.trim();
  if (!trimmed) {
    throw new Error("input is empty");
  }

  const backend: LlmBackendDescriptor = input.backend ?? "claude-code";
  const lang = input.lang ?? "zh";
  const driver = getLlmDriver(backend);

  const baseSystemPrompt = getPromptEngineSystemPrompt(lang);
  const systemPrompt = input.systemPromptSuffix
    ? `${baseSystemPrompt}\n\n${input.systemPromptSuffix}`
    : baseSystemPrompt;

  const result = await driver.completeJson({
    systemPrompt,
    userPrompt: trimmed,
    timeoutMs: 60_000,
    signal: input.signal,
  });

  const draft = normalizePromptDraft(result.data);

  return {
    draft,
    raw: result.raw,
    backend: result.backend,
    durationMs: result.durationMs,
  };
}

const OPTIONAL_STRING_FIELDS = [
  "background",
  "layout",
  "lighting",
  "mood",
  "camera",
  "environment_effects",
  "negative_constraints",
] as const;

/**
 * Enforce the same closed contract locally even when an OpenAI-compatible
 * proxy ignores `response_format.json_schema`. Null is the wire-level marker
 * for an unused optional field; it never escapes into persisted prompt JSON.
 */
export function normalizePromptDraft(value: unknown): PromptDraft {
  if (!isRecord(value) || !isRecord(value.prompt)) {
    throw new Error("model output missing required 'prompt' object");
  }

  const rawPrompt = value.prompt;
  const type = requiredString(rawPrompt.type);
  const style = requiredString(rawPrompt.style);
  const subject = requiredString(rawPrompt.subject);
  if (!type || !style || !subject) {
    throw new Error(
      "model output missing required prompt fields (type / style / subject)",
    );
  }

  const prompt: ImagePrompt = { type, style, subject };
  for (const field of OPTIONAL_STRING_FIELDS) {
    const fieldValue = optionalString(rawPrompt[field]);
    if (fieldValue !== undefined) prompt[field] = fieldValue;
  }

  if (Array.isArray(rawPrompt.color_palette)) {
    const palette = rawPrompt.color_palette.filter(
      (item): item is string => typeof item === "string" && item.trim().length > 0,
    );
    if (palette.length > 0) prompt.color_palette = palette;
  }

  if (Number.isInteger(rawPrompt.count) && (rawPrompt.count as number) > 0) {
    prompt.count = rawPrompt.count as number;
  }

  if (Array.isArray(rawPrompt.text_elements)) {
    const elements = rawPrompt.text_elements
      .map(normalizeTextElement)
      .filter((item): item is TextElement => item !== null);
    if (elements.length > 0) prompt.text_elements = elements;
  }

  const hints: AmbiguityHint[] = Array.isArray(value.hints)
    ? value.hints
        .filter(isRecord)
        .map(item => ({
          field: optionalString(item.field) ?? "",
          suggestion: optionalString(item.suggestion) ?? "",
        }))
        .filter(item => item.field.length > 0 && item.suggestion.length > 0)
    : [];

  return { prompt, hints };
}

function normalizeTextElement(value: unknown): TextElement | null {
  if (!isRecord(value)) return null;
  const content = requiredString(value.content);
  if (!content) return null;
  const out: TextElement = { content };
  for (const field of ["position", "font", "color", "size"] as const) {
    const fieldValue = optionalString(value[field]);
    if (fieldValue !== undefined) out[field] = fieldValue;
  }
  return out;
}

function requiredString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
