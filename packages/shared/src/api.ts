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

/**
 * Image output size as the upstream API consumes it. Either `<width>x<height>`
 * (concrete pixels) or `"auto"` (tells the upstream model to pick whatever
 * fits the prompt). The literal `"auto"` matches OpenAI's gpt-image-2 API.
 *
 * Typed as `string` (not a literal union) so the UI can let users type
 * arbitrary sizes — different OpenAI-compatible providers support different
 * sets, so Inkast guarantees the *ratio* but not the *resolution*.
 */
export type ImageSize = string;

/** Value sentinel meaning "let the upstream decide everything". */
export const SIZE_AUTO = "auto";

/**
 * The four orientations exposed in the SizeSelector. `"auto"` is the no-op
 * (we don't send `size` to the provider — it picks freely). `"custom"` lets
 * the user type an arbitrary ratio.
 */
export type SizeOrientation = "auto" | "square" | "wide" | "tall" | "custom";

export interface SizePreset {
  /** "<W>x<H>" wire value */
  value: string;
  /** True if widely supported by OpenAI-compatible providers (drives the ★). */
  widelyCompatible?: boolean;
}

/**
 * Per-ratio size presets. Keys like `"3:2"` map to a small list of common
 * pixel dimensions. The first entry is the default when a ratio is chosen.
 * Marked `widelyCompatible` are the ones almost every provider accepts; the
 * rest are popular but may be rejected by stricter compatibility layers.
 */
export const RATIO_SIZE_PRESETS: Record<string, readonly SizePreset[]> = {
  "1:1":  [
    { value: "1024x1024", widelyCompatible: true },
    { value: "512x512" },
    { value: "2048x2048" },
  ],
  "3:2":  [
    { value: "1536x1024", widelyCompatible: true },
    { value: "1200x800" },
  ],
  "16:9": [
    { value: "1920x1080" },
    { value: "2560x1440" },
    { value: "1280x720" },
  ],
  "4:3":  [
    { value: "1280x960" },
    { value: "2048x1536" },
  ],
  "21:9": [
    { value: "2520x1080" },
  ],
  "2:3":  [
    { value: "1024x1536", widelyCompatible: true },
    { value: "800x1200" },
  ],
  "9:16": [
    { value: "1080x1920" },
    { value: "1440x2560" },
    { value: "720x1280" },
  ],
  "3:4":  [
    { value: "960x1280" },
    { value: "1536x2048" },
  ],
  "4:5":  [
    { value: "1024x1280" },
  ],
};

/**
 * Which ratios belong to each orientation. Used to filter the ratio chip
 * row when the user picks an orientation. `"auto"` and `"custom"` have no
 * ratio list — they take over the ratio row themselves.
 */
export const ORIENTATION_RATIOS: Record<Exclude<SizeOrientation, "auto" | "custom">, readonly string[]> = {
  square: ["1:1"],
  wide:   ["3:2", "16:9", "4:3", "21:9"],
  tall:   ["2:3", "9:16", "3:4", "4:5"],
};

/**
 * Backward-compat: a flat list of widely-compatible sizes, in case anything
 * else in the codebase still imports it. Derived from RATIO_SIZE_PRESETS.
 */
export const STANDARD_IMAGE_SIZES = [
  { value: "1024x1024", ratio: "1:1" },
  { value: "1024x1536", ratio: "2:3" },
  { value: "1536x1024", ratio: "3:2" },
] as const;

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
  /**
   * Original prose the user typed before LLM expansion. `null` when the user
   * entered the structured editor directly (skip-text / M2 path) without
   * writing any prose. Persisted from this point forward — historical rows
   * created before this column existed return `null`.
   */
  prose: string | null;
  /**
   * Names of `promptSnapshot` fields that were populated by the LLM expansion
   * (i.e. AI-suggested rather than user-typed). Used by the detail view to
   * mark each row with an "+ AI" badge. `null` for raw-prose generations and
   * for historical rows created before this column existed.
   */
  aiFilledFields: string[] | null;
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
  /**
   * The original prose the user wrote in the composer textarea, captured
   * verbatim. Persisted on the Generation row so the detail view can show
   * "what the user originally said" next to the structured prompt that the
   * LLM produced. Omit when there is no prose (skip-text / M2 path).
   */
  prose?: string;
  /**
   * Names of `prompt` fields that came from the LLM (vs. typed by the user).
   * The detail view marks each with a "+ AI" badge. Should be the snapshot
   * at submit time — i.e. excluding fields the user has since edited.
   */
  aiFilledFields?: string[];
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
