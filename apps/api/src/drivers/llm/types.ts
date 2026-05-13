/**
 * LLM driver contract.
 *
 * Inkast's diff-erentiator: the default driver is the user's local ClaudeCode
 * (no API key). OpenAI-compatible Chat is a fallback. Both must satisfy the
 * same minimal contract — single-turn JSON generation — so callers don't
 * care which backend produced the result.
 */

export type LlmBackend = "claude-code" | "openai-compatible";

export interface CompleteJsonOptions {
  /** System prompt — methodology + output schema. */
  systemPrompt: string;
  /** User input — the prose the model should structure. */
  userPrompt: string;
  /**
   * JSON Schema enforced on the model's output by the backend (when supported).
   * Drivers that support structured output (e.g. claude-code) will pass this
   * through; drivers that don't will fall back to prompt-only constraints.
   * Omit to use the driver's default schema (caller-shape-agnostic).
   */
  schema?: Record<string, unknown>;
  /** Hard timeout in ms. Aborts the call when exceeded. */
  timeoutMs?: number;
  /** Optional caller-provided abort signal. */
  signal?: AbortSignal;
}

export interface CompleteJsonResult<T = unknown> {
  /** Parsed JSON object. Driver guarantees JSON.parse succeeded. */
  data: T;
  /** Raw text returned by the model (for debugging / logging). */
  raw: string;
  /** Backend that produced this. */
  backend: LlmBackend;
  /** Wall-clock ms spent. */
  durationMs: number;
}

export type LlmDriverErrorCode =
  | "not_authenticated"      // no usable credentials
  | "rate_limited"
  | "timeout"
  | "aborted"
  | "invalid_json"           // model returned non-JSON despite prompt
  | "backend_unavailable"
  | "unknown";

export class LlmDriverError extends Error {
  override readonly name = "LlmDriverError";
  constructor(
    public readonly code: LlmDriverErrorCode,
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
  }
}

export interface LlmDriver {
  readonly backend: LlmBackend;
  /** Run a single-turn JSON generation. Throws LlmDriverError on failure. */
  completeJson<T = unknown>(opts: CompleteJsonOptions): Promise<CompleteJsonResult<T>>;
}
