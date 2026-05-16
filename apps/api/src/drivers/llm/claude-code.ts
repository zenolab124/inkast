import { query, AbortError } from "@anthropic-ai/claude-agent-sdk";
import type { SDKMessage, SDKResultSuccess } from "@anthropic-ai/claude-agent-sdk";
import {
  LlmDriverError,
  type CompleteJsonOptions,
  type CompleteJsonResult,
  type LlmDriver,
  type WarmupResult,
} from "./types.js";

/** A driver is considered "still warm" if a real call happened within this window. */
const WARMUP_FRESHNESS_MS = 5 * 60 * 1000;

/**
 * JSON Schema enforced by the SDK on the model's structured output.
 *
 * We intentionally only constrain the OUTER shape ({ prompt, hints }), not
 * the inner prompt fields — the imagegen methodology says the prompt schema
 * is open (the model is allowed to invent new fields). type/style/subject
 * being required is enforced by the system prompt and by the service layer.
 */
const PROMPT_DRAFT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["prompt", "hints"],
  properties: {
    prompt: {
      type: "object",
      additionalProperties: true,
    },
    hints: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["field", "suggestion"],
        properties: {
          field: { type: "string" },
          suggestion: { type: "string" },
        },
      },
    },
  },
};

/**
 * ClaudeCode-backed LLM driver.
 *
 * Reuses the user's local `claude` OAuth credentials (the SDK is the same
 * engine as the Claude Code CLI). We explicitly DO NOT pass ANTHROPIC_API_KEY
 * — if it's set in the parent env, it could route through the API instead of
 * the OAuth flow. We blank it for the child process to force OAuth.
 *
 * Tools are fully disabled: this driver does single-turn JSON generation
 * only. No file reads, no bash, no web — purely "model in, JSON out".
 */
export class ClaudeCodeDriver implements LlmDriver {
  readonly backend = "claude-code" as const;

  /** Timestamp of the last successful round-trip — used to dedupe warmups. */
  private lastRoundTripAt = 0;
  /** In-flight warmup promise so concurrent callers share one round-trip. */
  private warmupInFlight: Promise<WarmupResult> | null = null;

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
    const abortController = new AbortController();

    const timeoutHandle = opts.timeoutMs
      ? setTimeout(() => abortController.abort(new Error("timeout")), opts.timeoutMs)
      : null;

    const onExternalAbort = () => abortController.abort(opts.signal?.reason);
    opts.signal?.addEventListener("abort", onExternalAbort, { once: true });

    try {
      const q = query({
        prompt: opts.userPrompt,
        options: {
          systemPrompt: opts.systemPrompt,
          tools: [],
          maxTurns: 5,
          outputFormat: { type: "json_schema", schema: opts.schema ?? PROMPT_DRAFT_SCHEMA },
          abortController,
          env: {
            ...process.env,
            ANTHROPIC_API_KEY: "",
          },
        },
      });

      let result: SDKResultSuccess | null = null;
      let errorMessage: string | null = null;

      for await (const msg of q as AsyncIterable<SDKMessage>) {
        if (msg.type === "result") {
          if (msg.subtype === "success") {
            result = msg;
            break;
          }
          errorMessage = `result subtype ${msg.subtype}: ${msg.errors.join("; ") || "(no detail)"}`;
          break;
        }
        if (msg.type === "assistant" && msg.error) {
          errorMessage = `assistant error: ${msg.error}`;
        }
      }

      if (!result) {
        throw classifySdkError(errorMessage ?? "no result message from SDK");
      }

      // With outputFormat: json_schema, the SDK populates structured_output
      // with the parsed object. Fall back to tolerant text parsing if the
      // SDK didn't return structured data (defensive — shouldn't happen).
      const structured = result.structured_output;
      const data = structured !== undefined
        ? (structured as T)
        : parseTolerantJson<T>(result.result);

      this.lastRoundTripAt = Date.now();

      return {
        data,
        raw: result.result,
        backend: this.backend,
        durationMs: Date.now() - started,
      };
    } catch (err) {
      if (err instanceof AbortError) {
        const reason = abortController.signal.reason as Error | undefined;
        if (reason?.message === "timeout") {
          throw new LlmDriverError("timeout", `LLM call exceeded ${opts.timeoutMs}ms`, err);
        }
        throw new LlmDriverError("aborted", "LLM call aborted by caller", err);
      }
      if (err instanceof LlmDriverError) throw err;
      throw classifySdkError(err);
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      opts.signal?.removeEventListener("abort", onExternalAbort);
    }
  }
}

/**
 * The model occasionally wraps JSON in ```json fences or adds prose around
 * it despite explicit instructions. Strip fences and locate the outermost
 * { ... } block before parsing.
 */
function parseTolerantJson<T>(raw: string): T {
  let text = raw.trim();

  const fenceMatch = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenceMatch) text = fenceMatch[1]!.trim();

  if (!text.startsWith("{")) {
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      throw new LlmDriverError(
        "invalid_json",
        `model output did not contain a JSON object. raw: ${truncate(raw, 200)}`,
      );
    }
    text = text.slice(firstBrace, lastBrace + 1);
  }

  try {
    return JSON.parse(text) as T;
  } catch (err) {
    const msg = (err as Error).message;
    const posMatch = msg.match(/position (\d+)/);
    const context = posMatch
      ? text.slice(Math.max(0, Number(posMatch[1]) - 80), Number(posMatch[1]) + 80)
      : truncate(text, 400);
    console.error("[llm] JSON.parse failed. ctx near error:", JSON.stringify(context));
    console.error("[llm] full raw:", text);
    throw new LlmDriverError(
      "invalid_json",
      `JSON.parse failed: ${msg}. ctx: …${context}…`,
      err,
    );
  }
}

function classifySdkError(err: unknown): LlmDriverError {
  const message =
    typeof err === "string"
      ? err
      : err instanceof Error
        ? err.message
        : JSON.stringify(err);

  const lower = message.toLowerCase();
  if (lower.includes("authentication") || lower.includes("oauth") || lower.includes("login")) {
    return new LlmDriverError(
      "not_authenticated",
      "ClaudeCode is not authenticated locally — run `claude login` first.",
      err,
    );
  }
  if (lower.includes("rate") || lower.includes("quota") || lower.includes("billing")) {
    return new LlmDriverError("rate_limited", message, err);
  }
  return new LlmDriverError("backend_unavailable", message, err);
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
