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
 * Inkast-private wire prefix for "fixed aspect ratio, auto pixels". Form is
 * `"ratio:W:H"` (e.g. `"ratio:9:16"`). NOT a standard OpenAI value — image
 * drivers must translate before sending upstream:
 *   - images.generate: drop `size` entirely → server picks pixels under the
 *     hint (works on most compat proxies; gpt-image-2 official is okay too)
 *   - responses + image_generation tool: rewrite the size hint in the prompt
 *     from `"Target size: 1024x1024"` to `"Target aspect ratio: 9:16"`
 *
 * Persisted on `GenerationRecord.size` and accepted by the same field on
 * `GenerateImageRequest.size`. Round-tripping through SQLite is safe — it's
 * just a string.
 */
export const SIZE_RATIO_PREFIX = "ratio:";

export function isRatioSize(value: string | undefined | null): boolean {
  return typeof value === "string" && value.startsWith(SIZE_RATIO_PREFIX);
}

/** Returns the `W:H` part of a `ratio:W:H` wire value, or null if not a
 *  ratio-form value. The returned string is NOT validated beyond the prefix. */
export function extractRatio(value: string | undefined | null): string | null {
  if (!isRatioSize(value)) return null;
  return (value as string).slice(SIZE_RATIO_PREFIX.length) || null;
}

export function makeRatioSize(ratio: string): string {
  return `${SIZE_RATIO_PREFIX}${ratio}`;
}

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

/**
 * How an image capability calls upstream:
 *
 * - `"images"` — POST /v1/images/generations. Classic, accepts size/quality/n
 *   as discrete params. Default. Required for gpt-image-2 and family.
 * - `"responses"` — POST /v1/responses with `tools: [{type:"image_generation"}]`.
 *   Lets a general chat model (gpt-5.3-codex etc.) call the image tool. Does
 *   NOT accept size/quality params — driver injects them into the prompt text.
 * - `"seedream"` — POST /api/v3/images/generations using the Volcengine Ark
 *   Seedream JSON contract. Text-to-image and reference-image generation share
 *   the same endpoint; references travel in the `image` field.
 *
 * Persisted in `ProviderCapability.extras.mode` (image kind only).
 */
export type ImageGenerationMode = "images" | "responses" | "c2i-tasks" | "seedream";

export const IMAGE_GENERATION_MODE_DEFAULT: ImageGenerationMode = "images";

/**
 * Output file format the user *requests*. The actual on-disk format is decided
 * by sniffing the returned base64 bytes (magic number), because third-party
 * OpenAI-compatible proxies frequently ignore `output_format` and return PNG
 * regardless. Stored on `GenerationRecord.imageFormat`.
 */
export type ImageFormat = "png" | "jpeg" | "webp";

export const IMAGE_FORMAT_VALUES: readonly ImageFormat[] = ["png", "jpeg", "webp"];

export const IMAGE_FORMAT_DEFAULT: ImageFormat = "png";

export function isImageFormat(v: unknown): v is ImageFormat {
  return v === "png" || v === "jpeg" || v === "webp";
}

export interface ProviderCapability {
  kind: ProviderKind;
  model: string;
  priority: number;
  disabled: boolean;
  /**
   * Driver-specific options (effort, thinking, temperature, ...). Null when empty.
   *
   * Reserved keys:
   *   - `mode` (image kind only): `ImageGenerationMode` — selects the upstream
   *     dispatch path. Absent = "images".
   *   - `explicitAllowlistOnly` (image kind only): when true, this provider is
   *     eligible only for callers whose explicit provider allowlist names it.
   */
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
  /**
   * R2 public URL when the image lives on R2 (Web UI channel with R2 enabled).
   * `null` for local-only rows (dev) and pre-R2 historical rows — the frontend
   * keeps calling the `/api/generations/:id/image` serve endpoint either way,
   * which 302-redirects to this URL when present and streams from disk when not.
   */
  imageUrl: string | null;
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
 * `images.generate` (text-only) to `images.edit` / responses-mode multimodal
 * so the model preserves visual style/composition from the reference(s).
 *
 * Two source modes:
 *   - `generation` — points at an existing inkast Generation by ID. The API
 *     reads the file from disk; no payload over the wire.
 *   - `upload`     — base64-encoded bytes uploaded fresh by the client.
 *
 * Multi-reference: callers pass an array (see `referenceImages` on
 * `GenerateImageRequest`). Hard cap is `MAX_REFERENCE_IMAGES`. The
 * responses-mode driver pushes each as a separate `input_image` content
 * part; the legacy `images.edit` driver only accepts a single reference
 * (callers must switch to a responses-mode capability for >1).
 */
export type ReferenceImage =
  | { kind: "generation"; generationId: string }
  | { kind: "upload"; mimeType: string; dataBase64: string };

/** Hard cap on the number of reference images per generation request. */
export const MAX_REFERENCE_IMAGES = 16;

export interface GenerateImageRequest {
  prompt: ImagePrompt;
  size?: ImageSize;
  quality?: ImageQuality;
  /**
   * Requested output file format. Sent to the provider as a hint; the actual
   * on-disk format is decided by magic-number sniffing the returned bytes
   * (third-party proxies frequently ignore this and return PNG).
   */
  format?: ImageFormat;
  bypassModeration?: boolean;
  /**
   * If set, the image driver feeds this raw text directly to the upstream
   * model instead of JSON.stringify-ing the structured prompt. Used by the
   * "generate from prose" path that bypasses the prompt engine and field
   * editor entirely. The structured `prompt` is still stored as
   * `promptSnapshot` for history display.
   */
  rawPrompt?: string;
  /**
   * Zero or more reference images. Order is preserved when handed to the
   * upstream model. Hard-capped at MAX_REFERENCE_IMAGES.
   */
  referenceImages?: ReferenceImage[];
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
  /** Upstream HTTP status when the attempt was an APIError (4xx/5xx). */
  httpStatus?: number;
  /** Upstream request id, when available (e.g. `x-request-id` header). */
  requestId?: string;
  /**
   * Raw response body the upstream returned for this attempt. Object when the
   * upstream sent valid JSON (e.g. APIError parsed body); string when it sent
   * HTML / plaintext / unparseable JSON. Truncated to ~4KB before persisting
   * to keep the attempts column bounded. Empty / undefined when the attempt
   * succeeded or the error was purely client-side (e.g. AbortError) with no
   * upstream payload.
   */
  errorBody?: unknown;
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
  /** Final image provider id that succeeded. Null when the job failed. */
  providerId: string | null;
  /** Cached display name (provider row may be deleted later). */
  providerName: string | null;
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

/**
 * Single row of the plugin-channel gallery view served at
 * `GET /admin/plugin-gallery.json`. One row per succeeded plugin task that has
 * an R2-hosted image. Used by the loopback-only admin gallery page (a Tab in
 * the main web UI) — not exposed publicly.
 *
 * Backed by the long-lived `plugin_gallery_items` table — survives the 24h
 * GC on `plugin_tasks`. b64-mode tasks never land here (transient bytes only).
 */
export interface PluginGalleryItem {
  /** plugin_tasks.id (e.g. `ink-<uuid>`). */
  id: string;
  pluginId: string;
  providerName: string | null;
  /** Public R2 URL — `aivariants.124213.xyz/aiVariants/ink-…png` etc. */
  imageUrl: string;
  /** `image/png` / `image/jpeg`. */
  mime: string | null;
  /** Original caller prompt (free-form prose; never truncated). */
  prompt: string;
  /** LLM-expanded prompt JSON when available; null for skip-LLM plugins. */
  promptJson: unknown | null;
  /**
   * One entry per LLM rewrite round actually performed. Empty array when the
   * original prompt succeeded round-0 directly.
   */
  rewrittenPrompts: string[];
  /**
   * Which round produced the final image.
   *   0 = original prompt, no rewrite
   *   1 = LLM vision rewrite
   *   2 = fingerprint-degrade
   *   3 = color-only anchor
   */
  successRound: 0 | 1 | 2 | 3;
  /** True iff the post-review edit step replaced the image bytes. */
  postReviewEdited: boolean;
  llmDurationMs: number | null;
  imageDurationMs: number | null;
  createdAt: number;
}

export interface PluginGalleryPluginCount {
  pluginId: string;
  count: number;
}

export interface ListPluginGalleryResponse {
  items: PluginGalleryItem[];
  /** Pagination cursor for the next page; null when no more rows. */
  nextCursor: string | null;
  /** Total row count across the entire gallery (after pluginId filter). */
  total: number;
  /** Per-plugin counts across the ENTIRE gallery (ignores cursor + filter). */
  pluginCounts: PluginGalleryPluginCount[];
}
