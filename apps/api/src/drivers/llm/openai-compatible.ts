import OpenAI, { APIError } from "openai";
import { getProviderCapability } from "../../storage/providers.js";
import { resolveExtraHeaders } from "../codex-header.js";
import {
  LlmDriverError,
  type CompleteJsonOptions,
  type CompleteJsonResult,
  type LlmDriver,
  type WarmupResult,
} from "./types.js";
import { PROMPT_DRAFT_SCHEMA } from "./prompt-draft-schema.js";

const WARMUP_FRESHNESS_MS = 5 * 60 * 1000;

/**
 * OpenAI-compatible LLM driver — uses any /v1/chat/completions endpoint with
 * `response_format: { type: "json_schema" }` for structured output. Reads the
 * configured provider record fresh on each call so that key/model edits in the
 * config dialog take effect immediately without restart.
 *
 * `extras` JSON on the provider may carry:
 *   - temperature: number
 *   - top_p: number
 *   - max_tokens: number
 *   - reasoning_effort: 'low' | 'medium' | 'high' (for o1-like models)
 *
 * Unknown keys are silently ignored to keep the door open for future params.
 */
export class OpenAiCompatibleDriver implements LlmDriver {
  readonly backend = "openai-compatible" as const;

  private lastRoundTripAt = 0;
  private warmupInFlight: Promise<WarmupResult> | null = null;

  constructor(private readonly providerId: string) {}

  async warmup(): Promise<WarmupResult> {
    if (Date.now() - this.lastRoundTripAt < WARMUP_FRESHNESS_MS) {
      return { durationMs: 0, cached: true, backend: this.backend };
    }
    if (this.warmupInFlight) return this.warmupInFlight;

    this.warmupInFlight = (async (): Promise<WarmupResult> => {
      const started = Date.now();
      try {
        await this.completeJson({
          systemPrompt: 'Respond with exactly the JSON {"ok":true}. Nothing else.',
          userPrompt: "ping",
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["ok"],
            properties: { ok: { type: "boolean" } },
          },
          timeoutMs: 60_000,
        });
        return { durationMs: Date.now() - started, cached: false, backend: this.backend };
      } finally {
        this.warmupInFlight = null;
      }
    })();

    return this.warmupInFlight;
  }

  async completeJson<T = unknown>(opts: CompleteJsonOptions): Promise<CompleteJsonResult<T>> {
    const started = Date.now();
    const record = getProviderCapability(this.providerId, "llm");
    if (!record) {
      throw new LlmDriverError(
        "not_authenticated",
        `LLM provider ${this.providerId} not found or has no llm capability — check the config dialog`,
      );
    }
    if (record.capability.disabled) {
      throw new LlmDriverError(
        "backend_unavailable",
        `provider ${record.provider.name} llm capability is disabled`,
      );
    }

    const extras = (record.capability.extras ?? {}) as Record<string, unknown>;
    const schema = opts.schema ?? PROMPT_DRAFT_SCHEMA;
    const extraHeaders = resolveExtraHeaders(record.capability);

    const client = new OpenAI({
      apiKey: record.apiKey,
      baseURL: record.provider.baseUrl,
      timeout: opts.timeoutMs ?? 120_000,
      ...(extraHeaders ? { defaultHeaders: extraHeaders } : {}),
    });

    try {
      const userContent = opts.images && opts.images.length > 0
        ? [
            { type: "text" as const, text: opts.userPrompt },
            ...opts.images.map(img => ({
              type: "image_url" as const,
              image_url: { url: img.url },
            })),
          ]
        : opts.userPrompt;
      const completion = await client.chat.completions.create(
        {
          model: record.capability.model,
          messages: [
            { role: "system", content: opts.systemPrompt },
            { role: "user", content: userContent },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "inkast_structured_output",
              strict: true,
              schema,
            },
          },
          ...(typeof extras.temperature === "number" ? { temperature: extras.temperature } : {}),
          ...(typeof extras.top_p === "number" ? { top_p: extras.top_p } : {}),
          ...(typeof extras.max_tokens === "number" ? { max_tokens: extras.max_tokens } : {}),
          ...(typeof extras.reasoning_effort === "string"
            ? { reasoning_effort: extras.reasoning_effort as "low" | "medium" | "high" }
            : {}),
        },
        { signal: opts.signal },
      );

      const message = completion.choices[0]?.message;
      const raw = message?.content ?? "";
      if (!raw) {
        throw new LlmDriverError(
          "invalid_json",
          `model returned empty content. finish_reason=${completion.choices[0]?.finish_reason}`,
        );
      }

      let data: T;
      try {
        data = JSON.parse(raw) as T;
      } catch (err) {
        throw new LlmDriverError(
          "invalid_json",
          `JSON.parse failed on model output: ${(err as Error).message}`,
          err,
        );
      }

      this.lastRoundTripAt = Date.now();

      return {
        data,
        raw,
        backend: this.backend,
        durationMs: Date.now() - started,
      };
    } catch (err) {
      if (err instanceof LlmDriverError) throw err;
      throw classifyOpenAiError(err);
    }
  }
}

function classifyOpenAiError(err: unknown): LlmDriverError {
  if (err instanceof APIError) {
    const status = err.status;
    if (status === 401 || status === 403) {
      return new LlmDriverError("not_authenticated", `${status}: ${err.message}`, err);
    }
    if (status === 429) {
      return new LlmDriverError("rate_limited", err.message, err);
    }
    if (status === 408 || status === 504) {
      return new LlmDriverError("timeout", err.message, err);
    }
    return new LlmDriverError("backend_unavailable", `HTTP ${status}: ${err.message}`, err);
  }
  const msg = (err as Error)?.message ?? String(err);
  if ((err as { name?: string })?.name === "AbortError") {
    return new LlmDriverError("aborted", msg, err);
  }
  return new LlmDriverError("backend_unavailable", msg, err);
}
