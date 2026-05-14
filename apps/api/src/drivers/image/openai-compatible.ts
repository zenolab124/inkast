import OpenAI, { APIError, toFile } from "openai";
import type {
  ImageEditParams,
  ImageGenerateParams,
} from "openai/resources/images";
import { listProviderKeys, type Provider } from "../../storage/providers.js";
import {
  ImageGenError,
  type AttemptErrorCode,
  type ImageGenAttempt,
  type ImageGenInput,
  type ImageGenOutcome,
} from "./types.js";

// gpt-image-2 high-quality jobs commonly take 1-5 minutes via third-party
// proxies. 10 minutes mirrors gpt-image-canvas's 1_200_000 ms ceiling cut
// roughly in half; still long enough to survive realistic spikes.
const DEFAULT_TIMEOUT_MS = 600_000;

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
  const pool = listProviderKeys();
  if (pool.length === 0) {
    throw new ImageGenError(
      "no_providers",
      "no providers configured — add one in the provider config dialog",
    );
  }

  const overallStart = Date.now();
  const attempts: ImageGenAttempt[] = [];

  for (const [idx, { provider, apiKey }] of pool.entries()) {
    if (input.signal?.aborted) {
      throw new ImageGenError("aborted", "image generation aborted by caller", attempts);
    }

    const started = Date.now();
    console.log(
      `[image] ▶ attempt ${idx + 1}/${pool.length}: ${provider.name} (priority=${provider.priority}) → ${provider.baseUrl} · model=${provider.model}`,
    );
    console.log(
      `[image]   size=${input.size ?? "1024x1024"} quality=${input.quality ?? "high"} prompt-bytes=${input.promptText.length}`,
    );
    // Heartbeat so the operator can see the request is still alive while the
    // upstream model is working. Every 15s.
    const heartbeat = setInterval(() => {
      const elapsedSec = Math.floor((Date.now() - started) / 1000);
      console.log(`[image]   …still waiting on ${provider.name} (${elapsedSec}s elapsed)`);
    }, 15_000);
    try {
      const b64 = await callProvider(provider, apiKey, input);
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
      continue;
    }
  }

  throw new ImageGenError(
    "all_providers_failed",
    `exhausted all ${pool.length} providers — see attempts for details`,
    attempts,
  );
}

async function callProvider(
  provider: Provider,
  apiKey: string,
  input: ImageGenInput,
): Promise<string> {
  const client = new OpenAI({
    apiKey,
    baseURL: provider.baseUrl.replace(/\/+$/, ""),
    timeout: DEFAULT_TIMEOUT_MS,
    // Leave maxRetries at the SDK default (2). Auto-retry on transient
    // network errors mirrors gpt-image-canvas — only the FINAL failure
    // surfaces to the pool walker, which then decides whether to fail
    // over to the next provider.
  });

  // gpt-image-2 accepts size values the openai SDK's TypeScript union does
  // not yet enumerate; same for output_format. Pass through via an unchecked
  // cast — mirrors gpt-image-canvas's approach in image-provider.ts.
  //
  // `output_format: "png"` is important: some OpenAI-compatible proxies
  // default to returning a URL (not b64_json) when this field is absent,
  // adding an extra download hop and making timing flakier.
  const body = {
    model: provider.model,
    prompt: input.promptText,
    size: input.size ?? "1024x1024",
    quality: input.quality ?? "high",
    output_format: "png",
    n: input.n ?? 1,
  } as unknown as ImageGenerateParams;

  const useEdit = input.referenceImage !== undefined;
  console.log(
    `[image]   → POST ${provider.baseUrl.replace(/\/+$/, "")}/images/${useEdit ? "edits" : "generations"}`,
  );
  if (useEdit) {
    console.log(
      `[image]   reference: ${input.referenceImage!.mimeType} · ${input.referenceImage!.buffer.length} bytes`,
    );
  }
  const reqStart = Date.now();
  const response = useEdit
    ? await client.images.edit(await buildEditBody(provider, input), {
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
  provider: Provider,
  input: ImageGenInput,
): Promise<ImageEditParams> {
  const ref = input.referenceImage;
  if (!ref) throw new Error("buildEditBody called without referenceImage");
  const file = await toFile(ref.buffer, ref.filename, { type: ref.mimeType });
  return {
    model: provider.model,
    image: file,
    prompt: input.promptText,
    size: input.size ?? "1024x1024",
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

  const message = err instanceof Error ? err.message : String(err);
  if (/network|fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i.test(message)) {
    return { code: "network", message };
  }
  return { code: "unknown", message };
}
