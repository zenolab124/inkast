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

export type ImageSize = "1024x1024" | "1024x1536" | "1536x1024";
export type ImageQuality = "low" | "medium" | "high";

export interface ImageGenInput {
  /** Prompt text the provider sees. We typically pass JSON.stringify(prompt). */
  promptText: string;
  size?: ImageSize;
  quality?: ImageQuality;
  n?: number;
  bypassModeration?: boolean;
  signal?: AbortSignal;
}

export type AttemptErrorCode =
  | "network"
  | "moderation"
  | "rate_limit"
  | "auth"
  | "server"
  | "aborted"
  | "unknown";

export interface ImageGenAttempt {
  providerId: string;
  providerName: string;
  ok: boolean;
  errorCode?: AttemptErrorCode;
  errorMessage?: string;
  durationMs: number;
}

export interface ImageGenOutcome {
  /** Base64-encoded image bytes. Caller decides format / file path. */
  imageB64: string;
  format: "png" | "jpeg" | "webp";
  providerId: string;
  providerName: string;
  attempts: ImageGenAttempt[];
  totalDurationMs: number;
}

export type ImageGenErrorCode =
  | "no_providers"             // pool is empty
  | "all_providers_failed"     // exhausted pool, none worked
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
  ) {
    super(message);
  }
}
