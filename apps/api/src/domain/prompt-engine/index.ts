import type { LlmBackend, LlmBackendDescriptor, OutputLang, PromptDraft } from "@inkast/shared";
import { getLlmDriver } from "../../drivers/llm/index.js";
import { getPromptEngineSystemPrompt } from "./system-prompt.js";

export interface DraftPromptInput {
  input: string;
  backend?: LlmBackendDescriptor;
  lang?: OutputLang;
  /**
   * Optional system prompt suffix appended after the engine's base instructions.
   * Used by the plugin channel to inject per-caller business constraints
   * (e.g. snapub's "no text / no frame" patch). Web UI callers do not
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

  const result = await driver.completeJson<PromptDraft>({
    systemPrompt,
    userPrompt: trimmed,
    timeoutMs: 60_000,
    signal: input.signal,
  });

  const draft = result.data;
  if (!draft?.prompt) {
    throw new Error("model output missing required 'prompt' object");
  }
  if (!draft.prompt.type || !draft.prompt.style || !draft.prompt.subject) {
    throw new Error(
      "model output missing required prompt fields (type / style / subject)",
    );
  }
  if (!Array.isArray(draft.hints)) {
    draft.hints = [];
  }

  return {
    draft,
    raw: result.raw,
    backend: result.backend,
    durationMs: result.durationMs,
  };
}
