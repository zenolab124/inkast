import type { PromptDraft } from "@inkast/shared";
import { getLlmDriver, type LlmBackend } from "../../drivers/llm/index.js";
import { PROMPT_ENGINE_SYSTEM_PROMPT } from "./system-prompt.js";

export interface DraftPromptInput {
  input: string;
  backend?: LlmBackend;
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

  const backend = input.backend ?? "claude-code";
  const driver = getLlmDriver(backend);

  const result = await driver.completeJson<PromptDraft>({
    systemPrompt: PROMPT_ENGINE_SYSTEM_PROMPT,
    userPrompt: trimmed,
    timeoutMs: 60_000,
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
    backend,
    durationMs: result.durationMs,
  };
}
