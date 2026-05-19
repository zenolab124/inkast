import OpenAI, { APIError, toFile } from "openai";
import type {
  ImageEditParams,
  ImageGenerateParams,
} from "openai/resources/images";
import {
  IMAGE_FORMAT_DEFAULT,
  IMAGE_GENERATION_MODE_DEFAULT,
  extractRatio,
  isRatioSize,
  type ImageGenerationMode,
} from "@inkast/shared";
import {
  listEnabledCapabilities,
  type Provider,
  type ProviderCapability,
} from "../../storage/providers.js";
import { callImageGenerationTool } from "./openai-responses.js";
import {
  ImageGenError,
  type AttemptErrorCode,
  type ImageGenAttempt,
  type ImageGenInput,
  type ImageGenOutcome,
} from "./types.js";

/** Read `extras.mode` off an image capability, with a safe default. */
function resolveMode(capability: ProviderCapability): ImageGenerationMode {
  const raw = capability.extras?.mode;
  return raw === "responses" || raw === "images" ? raw : IMAGE_GENERATION_MODE_DEFAULT;
}

// gpt-image-2 high-quality jobs commonly take 1-5 minutes via third-party
// proxies. 10 minutes mirrors gpt-image-canvas's 1_200_000 ms ceiling cut
// roughly in half; still long enough to survive realistic spikes.
const DEFAULT_TIMEOUT_MS = 600_000;

/**
 * Per-provider transient-failure retry budget. Empirically the anyrouter
 * proxy goes through brief windows where the image_generation tool fires but
 * never emits a partial — the stream ends with 0 done items. These are not
 * deterministic failures; a retry 5-10s later typically lands in a different
 * upstream queue slot and succeeds. We retry up to this many times PER
 * provider before falling over to the next one in the pool.
 *
 * Moderation, auth, and abort errors are NEVER retried — those are
 * deterministic and a retry would just waste time.
 */
const PROVIDER_RETRY_LIMIT = 2;
const PROVIDER_RETRY_BACKOFF_MS = 5_000;

/**
 * OpenAI-compatible image generation, via the official `openai` SDK.
 *
 * Why SDK instead of raw fetch: third-party OpenAI-compatible proxies
 * (CF-fronted aggregators etc.) often bot-detect requests without a real
 * User-Agent and reject with a CDN-edge 403 HTML page. The SDK ships with
 * `User-Agent: OpenAI/JS x.y.z` plus standard fetch defaults that consistently
 * pass these checks. We also get free retries, AbortSignal plumbing, and
 * uniform error shapes (APIError) across providers.
 *
 * Pool semantics match imagegen/scripts/generate.py — see types.ts header.
 */
export async function generateImage(input: ImageGenInput): Promise<ImageGenOutcome> {
  const pool = listEnabledCapabilities("image");
  if (pool.length === 0) {
    throw new ImageGenError(
      "no_providers",
      "no providers configured — add one in the provider config dialog",
    );
  }

  const overallStart = Date.now();
  const attempts: ImageGenAttempt[] = [];

  for (const [idx, { provider, capability, apiKey }] of pool.entries()) {
    if (input.signal?.aborted) {
      throw new ImageGenError("aborted", "image generation aborted by caller", attempts);
    }

    const mode = resolveMode(capability);
    const refsCount = (input.referenceImages ?? []).length;
    let lastClassified: ClassifiedError | undefined;

    for (let retry = 0; retry <= PROVIDER_RETRY_LIMIT; retry++) {
      if (input.signal?.aborted) {
        throw new ImageGenError("aborted", "image generation aborted by caller", attempts);
      }
      const started = Date.now();
      const tryLabel =
        retry === 0
          ? `attempt ${idx + 1}/${pool.length}`
          : `retry ${retry}/${PROVIDER_RETRY_LIMIT} on ${idx + 1}/${pool.length}`;
      console.log(
        `[image] ▶ ${tryLabel}: ${provider.name} (priority=${capability.priority}, mode=${mode}) → ${provider.baseUrl} · model=${capability.model}`,
      );
      console.log(
        `[image]   size=${input.size ?? "1024x1024"} quality=${input.quality ?? "high"} prompt-bytes=${input.promptText.length}`,
      );
      // Heartbeat so the operator can see the request is still alive while
      // the upstream model is working. Every 15s. Include mode + refs count
      // so grepping logs from concurrent jobs stays sane.
      const heartbeat = setInterval(() => {
        const elapsedSec = Math.floor((Date.now() - started) / 1000);
        console.log(
          `[image]   …still waiting on ${provider.name} (mode=${mode}, refs=${refsCount}, ${elapsedSec}s elapsed)`,
        );
      }, 15_000);
      try {
        const b64 =
          mode === "responses"
            ? await callImageGenerationTool(provider, capability, apiKey, input)
            : await callProvider(provider, capability, apiKey, input);
        clearInterval(heartbeat);
        attempts.push({
          providerId: provider.id,
          providerName: provider.name,
          ok: true,
          durationMs: Date.now() - started,
        });
        console.log(
          `[image] ✓ ${provider.name} succeeded in ${Date.now() - started}ms (image-b64-bytes=${b64.length})`,
        );
        return {
          imageB64: b64,
          format: "png",
          providerId: provider.id,
          providerName: provider.name,
          attempts,
          totalDurationMs: Date.now() - overallStart,
        };
      } catch (err) {
        clearInterval(heartbeat);
        const classified = classifyError(err);
        lastClassified = classified;
        attempts.push({
          providerId: provider.id,
          providerName: provider.name,
          ok: false,
          errorCode: classified.code,
          errorMessage: classified.message,
          durationMs: Date.now() - started,
        });
        console.log(
          `[image] ✗ ${provider.name} failed (${classified.code}) in ${Date.now() - started}ms`,
        );
        if (classified.message) {
          console.log(`[image]   reason: ${classified.message}`);
        }

        // Hard-stop errors — never retry these.
        if (classified.code === "moderation" && !input.bypassModeration) {
          throw new ImageGenError(
            "moderation_rejected",
            `provider "${provider.name}" rejected on content moderation: ${classified.message}. Set bypassModeration to retry remaining providers.`,
            attempts,
            err,
          );
        }
        if (classified.code === "aborted") {
          throw new ImageGenError("aborted", "image generation aborted by caller", attempts, err);
        }
        if (classified.code === "auth") {
          // Wrong API key won't get better on retry. Fall over to next provider.
          break;
        }
        // Transient — back off briefly, then retry on the same provider.
        if (retry < PROVIDER_RETRY_LIMIT) {
          console.log(
            `[image]   …retrying ${provider.name} in ${PROVIDER_RETRY_BACKOFF_MS}ms (transient: ${classified.code})`,
          );
          await new Promise(rs => setTimeout(rs, PROVIDER_RETRY_BACKOFF_MS));
        }
      }
    }

    console.log(
      `[image] ⤵ ${provider.name} exhausted ${PROVIDER_RETRY_LIMIT + 1} attempts (last: ${lastClassified?.code ?? "unknown"}), falling over`,
    );
    continue;
  }

  throw new ImageGenError(
    "all_providers_failed",
    `exhausted all ${pool.length} providers — see attempts for details`,
    attempts,
  );
}

async function callProvider(
  provider: Provider,
  capability: ProviderCapability,
  apiKey: string,
  input: ImageGenInput,
): Promise<string> {
  const client = new OpenAI({
    apiKey,
    baseURL: provider.baseUrl.replace(/\/+$/, ""),
    timeout: DEFAULT_TIMEOUT_MS,
    // Disable SDK-internal retries (was default 2). Retries are invisible in
    // logs and stack — one "failed" attempt can secretly be 3 round-trips of
    // 5-10 minutes each. We already retry at the pool-walker layer with full
    // visibility, so let the SDK fail loudly on the first attempt.
    maxRetries: 0,
  });

  // gpt-image-2 accepts size values the openai SDK's TypeScript union does
  // not yet enumerate; same for output_format. Pass through via an unchecked
  // cast — mirrors gpt-image-canvas's approach in image-provider.ts.
  //
  // `output_format: "png"` is important: some OpenAI-compatible proxies
  // default to returning a URL (not b64_json) when this field is absent,
  // adding an extra download hop and making timing flakier.
  //
  // Wire `ratio:W:H` means "lock aspect ratio, let upstream pick pixels" —
  // we translate that to "no size param at all"; OpenAI's gpt-image-2 then
  // returns its default-sized output. Compat proxies follow the same rule.
  // The ratio hint travels with the prompt text (caller embeds it) rather
  // than as a discrete param the upstream API doesn't have.
  const useRatio = isRatioSize(input.size);
  const ratioHint = useRatio ? extractRatio(input.size) : null;
  const promptForUpstream = ratioHint
    ? `${input.promptText}\n\nTarget aspect ratio: ${ratioHint}.`
    : input.promptText;
  const requestedFormat = input.format ?? IMAGE_FORMAT_DEFAULT;
  const body = {
    model: capability.model,
    prompt: promptForUpstream,
    ...(useRatio ? {} : { size: input.size ?? "1024x1024" }),
    quality: input.quality ?? "high",
    output_format: requestedFormat,
    n: input.n ?? 1,
  } as unknown as ImageGenerateParams;

  const refs = input.referenceImages ?? [];
  if (refs.length > 1) {
    // The legacy /v1/images/edits endpoint only takes a single reference on
    // most upstreams (gpt-image-1 ships multi-image edit but compat proxies
    // rarely forward it). Fail loudly with a hint pointing operators at the
    // responses-mode capability, which natively supports multi-reference.
    throw new Error(
      `this provider's images.edit endpoint supports only a single reference image (got ${refs.length}); switch to a responses-mode capability for multi-reference, or reduce to 1`,
    );
  }
  const useEdit = refs.length === 1;
  console.log(
    `[image]   → POST ${provider.baseUrl.replace(/\/+$/, "")}/images/${useEdit ? "edits" : "generations"}`,
  );
  if (useEdit) {
    console.log(
      `[image]   reference: ${refs[0]!.mimeType} · ${refs[0]!.buffer.length} bytes`,
    );
  }
  const reqStart = Date.now();
  const response = useEdit
    ? await client.images.edit(await buildEditBody(capability, input), {
        signal: input.signal,
      })
    : await client.images.generate(body, { signal: input.signal });
  console.log(`[image]   ← response in ${Date.now() - reqStart}ms`);

  const first = response.data?.[0];
  // gpt-image-2 returns b64_json by default. Some compat endpoints might
  // return url instead — fall back to fetching and base64-encoding.
  if (first?.b64_json) {
    console.log(`[image]   ← b64_json received (${first.b64_json.length} chars)`);
    return first.b64_json;
  }
  if (first?.url) {
    console.log(`[image]   ← url received (${first.url}), fetching bytes…`);
    const fetchStart = Date.now();
    const res = await fetch(first.url, { signal: input.signal });
    if (!res.ok) throw new Error(`download image url failed: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    console.log(`[image]   ← url download done in ${Date.now() - fetchStart}ms (${buf.length} bytes)`);
    return buf.toString("base64");
  }
  throw new Error("provider returned no image (neither b64_json nor url)");
}

async function buildEditBody(
  capability: ProviderCapability,
  input: ImageGenInput,
): Promise<ImageEditParams> {
  const refs = input.referenceImages ?? [];
  if (refs.length !== 1) {
    // Defensive: callProvider guarantees length === 1 before reaching here.
    throw new Error(
      `buildEditBody requires exactly 1 reference image, got ${refs.length}`,
    );
  }
  const ref = refs[0]!;
  const file = await toFile(ref.buffer, ref.filename, { type: ref.mimeType });
  // Mirror the ratio-mode handling in callProvider: drop `size` when the
  // caller passed `ratio:W:H`, and let the ratio hint travel via the prompt.
  const useRatio = isRatioSize(input.size);
  const ratioHint = useRatio ? extractRatio(input.size) : null;
  const promptForUpstream = ratioHint
    ? `${input.promptText}\n\nTarget aspect ratio: ${ratioHint}.`
    : input.promptText;
  return {
    model: capability.model,
    image: file,
    prompt: promptForUpstream,
    ...(useRatio ? {} : { size: input.size ?? "1024x1024" }),
    n: input.n ?? 1,
  } as unknown as ImageEditParams;
}

interface ClassifiedError {
  code: AttemptErrorCode;
  message: string;
}

function classifyError(err: unknown): ClassifiedError {
  if (err instanceof Error && err.name === "AbortError") {
    return { code: "aborted", message: err.message };
  }

  if (err instanceof APIError) {
    const status = err.status;
    const message =
      typeof err.error === "object" && err.error && "message" in err.error
        ? String((err.error as { message?: unknown }).message ?? err.message)
        : err.message;
    const isModeration =
      err.code === "content_policy_violation" ||
      err.type === "content_policy_violation" ||
      /content[_ ]policy|moderation|safety/i.test(message);
    if (isModeration) return { code: "moderation", message };
    if (status === 401 || status === 403) return { code: "auth", message: `HTTP ${status}: ${message}` };
    if (status === 429) return { code: "rate_limit", message };
    if (status && status >= 500) return { code: "server", message: `HTTP ${status}: ${message}` };
    return { code: "unknown", message: `HTTP ${status}: ${message}` };
  }

  // Node fetch typically wraps the real reason in `.cause`. Unwrap it so
  // operators see UND_ERR_BODY_TIMEOUT / ECONNRESET / etc. instead of a
  // generic "fetch failed".
  const baseMessage = err instanceof Error ? err.message : String(err);
  const cause = err instanceof Error ? (err as Error & { cause?: unknown }).cause : undefined;
  let message = baseMessage;
  if (cause !== undefined && cause !== null) {
    const causeStr =
      cause instanceof Error
        ? `${cause.name}: ${cause.message}${(cause as Error & { code?: string }).code ? ` (code=${(cause as Error & { code?: string }).code})` : ""}`
        : String(cause);
    message = `${baseMessage} | cause: ${causeStr}`;
  }
  if (/network|fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|UND_ERR_|ECONNRESET/i.test(message)) {
    return { code: "network", message };
  }
  return { code: "unknown", message };
}
