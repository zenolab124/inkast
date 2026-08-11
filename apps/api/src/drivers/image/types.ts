/**
 * Image generation driver contract.
 *
 * Phase 1 ships one implementation — OpenAI-compatible /v1/images/generations
 * — but the driver interface is here so future providers (Replicate, Recraft,
 * etc.) can slot in without disturbing the call sites.
 *
 * Pool semantics (sourced from imagegen/scripts/generate.py):
 *   - Walk providers in priority order (lowest = tried first)
 *   - On transient failure (network / 5xx / quota) → fall over to next
 *   - On content-moderation rejection → DO NOT fall over (prevents abusing
 *     the pool to launder banned content). Caller can pass `bypassModeration`
 *     to override, but the UI should require explicit confirmation.
 */

import type {
  ImageSize as SharedImageSize,
  ImageQuality as SharedImageQuality,
  ImageFormat,
} from "@inkast/shared";

export type ImageSize = SharedImageSize;
export type ImageQuality = SharedImageQuality;

export interface ImageGenInput {
  /** Prompt text the provider sees. We typically pass JSON.stringify(prompt). */
  promptText: string;
  size?: ImageSize;
  quality?: ImageQuality;
  /**
   * Requested output format. Passed to upstream as `output_format`; many
   * proxies ignore it. Callers must sniff the returned bytes to learn the
   * actual format — `ImageGenOutcome.format` is the driver's best guess but
   * domain layer re-sniffs before persisting.
   */
  format?: ImageFormat;
  n?: number;
  bypassModeration?: boolean;
  signal?: AbortSignal;
  /**
   * Zero or more reference image bytes. When non-empty, the driver switches
   * from `images.generate` (text-only) to `images.edit` (image + text) on
   * the legacy `images` endpoint, or pushes multiple `input_image` content
   * parts on the responses endpoint. Buffer ownership: caller decodes from
   * generation file or base64 upload.
   *
   * Note: the legacy `images.edit` endpoint only supports a single reference
   * image on most upstream models — the openai-compatible driver rejects
   * arrays of length > 1 with a helpful error pointing at responses mode.
   */
  referenceImages?: Array<{
    buffer: Buffer;
    /** "image/png" | "image/jpeg" | "image/webp" */
    mimeType: string;
    /** Filename hint passed to OpenAI SDK toFile (extension matters). */
    filename: string;
  }>;
  /**
   * Optional provider allowlist. `undefined` keeps the legacy full-pool
   * behavior; an explicit empty array matches no providers and must never be
   * treated as an absent restriction. Plugin callers use this to pin all
   * original/rewrite/edit requests to approved image channels.
   */
  allowedProviderIds?: readonly string[];
  /**
   * Provider IDs to skip on this run. Used by the rewrite-on-block retry path
   * to avoid burning more time on a provider that already rejected the prompt
   * with `provider_blocked_content`.
   */
  excludeProviderIds?: string[];
  /**
   * Restrict the pool walk to providers whose effective mode matches this
   * value. Used by the post-review edit flow, which uses `images.edit` SDK
   * route — only available on images-mode providers (responses-mode
   * providers don't accept reference-based edits the same way).
   */
  requireMode?: "images" | "responses" | "c2i-tasks";
  /**
   * Progress hook: invoked once per provider attempt the moment the driver
   * records it (both successes and failures), BEFORE the overall call
   * resolves. Lets the plugin channel persist live progress (which channel,
   * how far) to plugin_tasks so the admin dashboard can show in-flight tasks
   * instead of only terminal ones. Optional — the Web UI channel doesn't pass
   * it. Implementations must not throw.
   */
  onAttempt?: (attempt: ImageGenAttempt) => void;
}

export type AttemptErrorCode =
  | "network"
  | "moderation"
  | "provider_blocked_content"
  | "upstream_safety_rejected"
  | "rate_limit"
  | "auth"
  | "server"
  | "quota_exhausted"
  | "aborted"
  | "unknown";

export interface ImageGenAttempt {
  providerId: string;
  providerName: string;
  ok: boolean;
  errorCode?: AttemptErrorCode;
  errorMessage?: string;
  durationMs: number;
  /** HTTP status when the upstream returned an APIError (4xx/5xx). */
  httpStatus?: number;
  /** Upstream request id (`x-request-id` header etc.), when SDK exposes it. */
  requestId?: string;
  /**
   * Full upstream response body for the attempt. See GenerateImageAttempt
   * (shared) for the truncation + shape contract. Persisted to plugin_tasks
   * and jobs `attempts` JSON column for dashboard inspection.
   */
  errorBody?: unknown;
}

export interface ImageGenOutcome {
  /** Base64-encoded image bytes. Empty string when imageUrl is set (bytes not downloaded). */
  imageB64: string;
  /**
   * Direct URL to the generated image. Set when the upstream already persisted
   * the image (e.g. c2i-tasks writing to R2) and the URL is the final artifact.
   * When set, imageB64 may be empty — consumers that need bytes should download
   * from this URL; consumers whose storage matches can skip the round-trip.
   */
  imageUrl?: string;
  format: "png" | "jpeg" | "webp";
  providerId: string;
  providerName: string;
  attempts: ImageGenAttempt[];
  totalDurationMs: number;
}

export type ImageGenErrorCode =
  | "no_providers"             // pool is empty
  | "all_providers_failed"     // exhausted pool, none worked
  | "all_providers_failed_after_rewrite" // even after LLM-rewriting the prompt, no provider worked
  | "rewrite_llm_failed"       // LLM rewrite step itself failed (not image provider)
  | "moderation_rejected"      // pool stopped on a moderation rejection
  | "aborted"
  | "unknown";

export class ImageGenError extends Error {
  override readonly name = "ImageGenError";
  constructor(
    public readonly code: ImageGenErrorCode,
    message: string,
    public readonly attempts: ImageGenAttempt[] = [],
    override readonly cause?: unknown,
    /**
     * One entry per LLM rewrite round actually performed before this error
     * was thrown. Empty unless this error came from driveWithRewriteFallback.
     * Persisted on plugin_tasks so the dashboard can show each round's
     * output even on failure.
     */
    public readonly rewrittenPromptHistory: string[] = [],
  ) {
    super(message);
  }
}
