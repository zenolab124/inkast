import OpenAI, { APIError } from "openai";
import { getProviderCapability } from "../../storage/providers.js";
import { resolveExtraHeaders } from "../codex-header.js";
import {
  LlmDriverError,
  type CompleteJsonOptions,
  type CompleteJsonResult,
  type LlmDriver,
  type WarmupResult,
  type LlmCallReceipt,
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
 *   - reasoning_effort: configured reasoning effort, overridden by trusted callers
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
    if (opts.requireVision && (!opts.images?.length || extras.supportsVision === false)) {
      throw new LlmDriverError("backend_unavailable", "Vision input is required by this task");
    }
    const reasoningEffort = opts.reasoningEffort ?? (
      typeof extras.reasoning_effort === "string" ? extras.reasoning_effort : undefined
    );
    const receipt: LlmCallReceipt = {
      providerId: this.providerId, model: record.capability.model,
      reasoningEffort: reasoningEffort ?? null, durationMs: 0, usage: null, outcome: "failed",
    };
    const schema = opts.schema ?? PROMPT_DRAFT_SCHEMA;
    const extraHeaders = resolveExtraHeaders(record.capability);

    const client = new OpenAI({
      apiKey: record.apiKey,
      baseURL: opts.requireVision && opts.endpointOverride?.providerId === this.providerId
        ? opts.endpointOverride.baseUrl : record.provider.baseUrl,
      timeout: opts.timeoutMs ?? 120_000,
      // Vision jobs account for retries explicitly in the caller's bounded pool.
      ...(opts.requireVision ? { maxRetries: 0 } : {}),
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
      const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
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
          ...(reasoningEffort
            ? { reasoning_effort: reasoningEffort as "low" | "medium" | "high" }
            : {}),
        };
      const captureUsage = (usage: OpenAI.Completions.CompletionUsage | null | undefined) => {
        if (!usage) return;
        const detailed = usage as typeof usage & {
          prompt_tokens_details?: { cached_tokens?: number };
          completion_tokens_details?: { reasoning_tokens?: number };
        };
        receipt.usage = {
          inputTokens: detailed.prompt_tokens,
          cachedInputTokens: detailed.prompt_tokens_details?.cached_tokens ?? null,
          outputTokens: detailed.completion_tokens,
          reasoningOutputTokens: detailed.completion_tokens_details?.reasoning_tokens ?? null,
          totalTokens: detailed.total_tokens,
        };
      };
      let raw = "";
      let finishReason: string | null = null;
      if (opts.requireVision) {
        // Consume upstream SSE so long reasoning calls can receive gateway heartbeats
        // instead of waiting for a single buffered response through a public proxy.
        const { data: stream, response } = await client.chat.completions.create(
          { ...params, stream: true, stream_options: { include_usage: true } },
          { signal: opts.signal },
        ).withResponse();
        receipt.requestId = response.headers.get("x-request-id");
        receipt.upstreamStatus = response.status;
        for await (const chunk of stream) {
          receipt.completionId = chunk.id ?? receipt.completionId ?? null;
          captureUsage(chunk.usage);
          const choice = chunk.choices[0];
          raw += choice?.delta.content ?? "";
          if (raw.length > 1_000_000) throw new LlmDriverError("invalid_json", "Vision output exceeded its size bound");
          if (choice?.finish_reason) finishReason = choice.finish_reason;
        }
        if (finishReason !== "stop") throw new LlmDriverError("invalid_json", "Vision stream ended without a complete response");
      } else {
        const completion = await client.chat.completions.create(params, { signal: opts.signal });
        receipt.requestId = (completion as typeof completion & { _request_id?: string })._request_id ?? null;
        receipt.completionId = completion.id ?? null;
        captureUsage(completion.usage);
        raw = completion.choices[0]?.message.content ?? "";
        finishReason = completion.choices[0]?.finish_reason ?? null;
      }
      receipt.durationMs = Date.now() - started;
      receipt.outcome = "invalid_json";
      if (!raw) {
        throw new LlmDriverError(
          "invalid_json",
          `model returned empty content. finish_reason=${finishReason}`,
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
      receipt.outcome = "succeeded";

      return {
        data,
        raw,
        backend: this.backend,
        durationMs: Date.now() - started,
        receipt,
      };
    } catch (err) {
      receipt.durationMs = Date.now() - started;
      if (err instanceof APIError) {
        receipt.upstreamStatus = err.status ?? null;
        receipt.requestId = err.headers?.["x-request-id"] ?? receipt.requestId ?? null;
      }
      const classified = opts.signal?.aborted
        ? new LlmDriverError(opts.signal.reason?.name === "TimeoutError" ? "timeout" : "aborted", "LLM call aborted")
        : err instanceof LlmDriverError ? err : classifyOpenAiError(err);
      throw new LlmDriverError(classified.code, classified.message, classified, receipt);
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
