import type { ImagePrompt, PromptDraft } from "./prompt.js";

export type LlmBackend = "claude-code" | "openai-compatible";

export type ProviderKind = "image" | "llm";

/**
 * Reserved provider id for the built-in ClaudeCode LLM driver. Its row lives
 * in the providers table so it participates in priority/disable/reorder, but
 * the backend driver factory routes calls to ClaudeCodeDriver instead of
 * OpenAiCompatibleDriver. Treat as opaque elsewhere — never expose to users.
 */
export const BUILTIN_CLAUDE_CODE_PROVIDER_ID = "__builtin_claude_code__";

/**
 * Identifies which driver to use for an LLM call.
 *
 * - `'claude-code'` — use the local ClaudeCode SDK (OAuth-backed, no key needed).
 * - `{ kind: 'openai-compatible', providerId }` — use a user-configured LLM
 *   provider record (OpenAI-compatible /v1/chat/completions endpoint).
 */
export type LlmBackendDescriptor =
  | "claude-code"
  | { kind: "openai-compatible"; providerId: string };

export type OutputLang = "zh" | "en";

export interface DraftPromptRequest {
  input: string;
  /**
   * Which LLM driver to use. Defaults to `'claude-code'` (local SDK).
   * Pass `{ kind: 'openai-compatible', providerId }` to route through a
   * user-configured LLM provider instead.
   */
  backend?: LlmBackendDescriptor;
  /** Output language for all string-valued fields in the prompt. Defaults to zh. */
  lang?: OutputLang;
}

export interface WarmupRequest {
  backend?: LlmBackendDescriptor;
}

export interface WarmupResponse {
  durationMs: number;
  cached: boolean;
  backend: LlmBackend;
}

export type DraftPromptResponse = PromptDraft;

export type ImageSize = "1024x1024" | "1024x1536" | "1536x1024";
export type ImageQuality = "low" | "medium" | "high";

export interface ProviderCapability {
  kind: ProviderKind;
  model: string;
  priority: number;
  disabled: boolean;
  /** Driver-specific options (effort, thinking, temperature, ...). Null when empty. */
  extras: Record<string, unknown> | null;
}

export interface ProviderSummary {
  id: string;
  name: string;
  baseUrl: string;
  capabilities: ProviderCapability[];
  keyMasked: string;
  createdAt: number;
  updatedAt: number;
}

export interface CapabilityInput {
  kind: ProviderKind;
  model?: string;
  disabled?: boolean;
  extras?: Record<string, unknown> | null;
}

export interface ProviderCreateRequest {
  name: string;
  baseUrl: string;
  apiKey: string;
  capabilities: CapabilityInput[];
}

export interface ProviderUpdateRequest {
  name?: string;
  baseUrl?: string;
  apiKey?: string;
  /** When provided, replaces the capability set. To preserve priority order
   *  for kept rows, send the existing kinds back; new kinds are appended. */
  capabilities?: CapabilityInput[];
}

export interface CapabilityPatchRequest {
  model?: string;
  disabled?: boolean;
  extras?: Record<string, unknown> | null;
}

export interface ReorderCapabilitiesRequest {
  kind: ProviderKind;
  /** Provider IDs in their new priority order — must cover all existing
   *  providers that have a capability of this kind. */
  orderedProviderIds: string[];
}

export interface GenerationRecord {
  id: string;
  promptSnapshot: ImagePrompt;
  promptText: string;
  imagePath: string;
  imageFormat: string;
  size: string;
  quality: string;
  providerId: string | null;
  durationMs: number | null;
  createdAt: number;
}

/**
 * Reference image input. When present, the image driver switches from
 * `images.generate` (text-only) to `images.edit` (image + text) so the model
 * preserves visual style/composition from the reference.
 *
 * Two source modes:
 *   - `generation` — points at an existing inkast Generation by ID. The API
 *     reads the file from disk; no payload over the wire.
 *   - `upload`     — base64-encoded bytes uploaded fresh by the client.
 */
export type ReferenceImage =
  | { kind: "generation"; generationId: string }
  | { kind: "upload"; mimeType: string; dataBase64: string };

export interface GenerateImageRequest {
  prompt: ImagePrompt;
  size?: ImageSize;
  quality?: ImageQuality;
  bypassModeration?: boolean;
  /**
   * If set, the image driver feeds this raw text directly to the upstream
   * model instead of JSON.stringify-ing the structured prompt. Used by the
   * "generate from prose" path that bypasses the prompt engine and field
   * editor entirely. The structured `prompt` is still stored as
   * `promptSnapshot` for history display.
   */
  rawPrompt?: string;
  referenceImage?: ReferenceImage;
}

export interface GenerateImageAttempt {
  providerId: string;
  providerName: string;
  ok: boolean;
  errorCode?: string;
  errorMessage?: string;
  durationMs: number;
}

export interface GenerateImageResponse {
  generation: GenerationRecord;
  driver: {
    providerName: string;
    providerId: string;
    attempts: GenerateImageAttempt[];
    totalDurationMs: number;
  };
}

// === Async job-based generation ============================================

export type JobStatus = "pending" | "running" | "succeeded" | "failed";

export interface JobRecord {
  id: string;
  kind: "image_generate";
  status: JobStatus;
  /** Snapshot of the structured prompt (always stored, even for raw-prose). */
  promptSnapshot: ImagePrompt;
  /** Truncated prompt text for display in active-job cards. */
  promptText: string;
  /** True when the user used the "generate from prose" path. */
  isRaw: boolean;
  size: string;
  quality: string;
  /** Generation row ID once status=succeeded. */
  generationId: string | null;
  /** Provider failover trail (filled progressively). */
  attempts: GenerateImageAttempt[];
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
}

export type SubmitJobRequest = GenerateImageRequest;

export interface SubmitJobResponse {
  jobId: string;
  status: JobStatus;
}

export interface ListJobsResponse {
  jobs: JobRecord[];
}
