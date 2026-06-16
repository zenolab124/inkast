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
  markCapabilityAutoDisabledUntilNext6am,
  type Provider,
  type ProviderCapability,
} from "../../storage/providers.js";
import { acquireProviderSlot } from "../../lib/throttle.js";
import { resolveExtraHeaders } from "../codex-header.js";
import { callC2iTasksApi } from "./c2i-tasks.js";
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
  return raw === "responses" || raw === "images" || raw === "c2i-tasks"
    ? raw
    : IMAGE_GENERATION_MODE_DEFAULT;
}

// gpt-image-2 high-quality jobs commonly take 1-5 minutes via third-party
// proxies. 10 minutes mirrors gpt-image-canvas's 1_200_000 ms ceiling cut
// roughly in half; still long enough to survive realistic spikes.
const DEFAULT_TIMEOUT_MS = 600_000;

/**
 * Per-provider transient-failure retry budget. Total attempts per provider =
 * retryLimit + 1 (initial attempt + N retries).
 *
 * Default is 0 (no retry, single attempt then fall over). Most "transient"
 * failures we observe in production are provider-side model-level outages
 * (e.g. stream ends with 0 done items — the upstream model node is wedged,
 * not the queue slot). Retrying the same provider just doubles the wait
 * before we fall over to a healthier provider — and with a multi-provider
 * pool, fast fallover beats same-provider lottery.
 *
 * Per-capability override: each provider can set `extras.retryLimit` (0-5)
 * in the Web UI. Bump for providers that genuinely benefit from queue-slot
 * lottery (rare in current pool).
 *
 * Moderation, auth, and abort errors are NEVER retried regardless of limit.
 */
const PROVIDER_RETRY_LIMIT_DEFAULT = 0;
const PROVIDER_RETRY_LIMIT_MAX = 5;
const PROVIDER_RETRY_BACKOFF_MS = 5_000;

function resolveRetryLimit(capability: ProviderCapability): number {
  const raw = capability.extras?.retryLimit;
  if (
    typeof raw === "number" &&
    Number.isInteger(raw) &&
    raw >= 0 &&
    raw <= PROVIDER_RETRY_LIMIT_MAX
  ) {
    return raw;
  }
  return PROVIDER_RETRY_LIMIT_DEFAULT;
}

/**
 * Resolve the per-provider minimum interval (ms) between dispatched
 * requests. Precedence:
 *   1. capability.extras.min_interval_ms  (per-provider override; we follow
 *      the same pattern as retryLimit even though rate budget is really a
 *      per-API-key property — in practice each provider has one image
 *      capability so this is effectively per-provider)
 *   2. env INKAST_PROVIDER_MIN_INTERVAL_MS_DEFAULT  (process-wide default)
 *   3. 0  (no throttling)
 */
function resolveProviderMinIntervalMs(capability: ProviderCapability): number {
  const overrideRaw = capability.extras?.min_interval_ms;
  if (typeof overrideRaw === "number" && Number.isFinite(overrideRaw) && overrideRaw >= 0) {
    return overrideRaw;
  }
  const envRaw = process.env.INKAST_PROVIDER_MIN_INTERVAL_MS_DEFAULT;
  if (envRaw) {
    const parsed = Number.parseInt(envRaw, 10);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return 0;
}

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
  const fullPool = listEnabledCapabilities("image");
  const excludeSet = new Set(input.excludeProviderIds ?? []);
  let pool = excludeSet.size > 0
    ? fullPool.filter(p => !excludeSet.has(p.provider.id))
    : fullPool;
  if (input.requireMode) {
    pool = pool.filter(p => resolveMode(p.capability) === input.requireMode);
  }
  if (pool.length === 0) {
    throw new ImageGenError(
      "no_providers",
      fullPool.length === 0
        ? "no providers configured — add one in the provider config dialog"
        : input.requireMode
          ? `no provider matching mode=${input.requireMode} after excludes`
          : `all ${fullPool.length} provider(s) are excluded from this run`,
    );
  }

  const overallStart = Date.now();
  const attempts: ImageGenAttempt[] = [];

  for (const [idx, { provider, capability, apiKey }] of pool.entries()) {
    if (input.signal?.aborted) {
      throw new ImageGenError("aborted", "image generation aborted by caller", attempts);
    }

    const mode = resolveMode(capability);
    const retryLimit = resolveRetryLimit(capability);
    const refsCount = (input.referenceImages ?? []).length;
    let lastClassified: ClassifiedError | undefined;

    for (let retry = 0; retry <= retryLimit; retry++) {
      if (input.signal?.aborted) {
        throw new ImageGenError("aborted", "image generation aborted by caller", attempts);
      }
      // Per-provider rate limit. Blocks until this provider's slot opens
      // (serialized with other in-flight calls to the same providerId).
      // No-op when min_interval_ms is 0.
      await acquireProviderSlot(provider.id, resolveProviderMinIntervalMs(capability));
      if (input.signal?.aborted) {
        throw new ImageGenError("aborted", "image generation aborted by caller", attempts);
      }
      const started = Date.now();
      const tryLabel =
        retry === 0
          ? `attempt ${idx + 1}/${pool.length}`
          : `retry ${retry}/${retryLimit} on ${idx + 1}/${pool.length}`;
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
          mode === "c2i-tasks"
            ? await callC2iTasksApi(provider, capability, apiKey, input)
            : mode === "responses"
              ? await callImageGenerationTool(provider, capability, apiKey, input)
              : await callProvider(provider, capability, apiKey, input);
        clearInterval(heartbeat);
        const okAttempt = {
          providerId: provider.id,
          providerName: provider.name,
          ok: true,
          durationMs: Date.now() - started,
        };
        attempts.push(okAttempt);
        input.onAttempt?.(okAttempt);
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
        const failAttempt = {
          providerId: provider.id,
          providerName: provider.name,
          ok: false,
          errorCode: classified.code,
          errorMessage: classified.message,
          durationMs: Date.now() - started,
          httpStatus: classified.httpStatus,
          requestId: classified.requestId,
          errorBody: truncateErrorBody(classified.body),
        };
        attempts.push(failAttempt);
        input.onAttempt?.(failAttempt);
        console.log(
          `[image] ✗ ${provider.name} failed (${classified.code}) in ${Date.now() - started}ms`,
        );
        if (classified.message) {
          console.log(`[image]   reason: ${classified.message}`);
        }

        // Hard-stop errors — never retry these.
        if (classified.code === "moderation") {
          // Same hard-stop semantics as provider_blocked_content / upstream_
          // safety_rejected: rerunning the same prompt on the same provider
          // will keep being moderation-rejected. Fall over to the next
          // provider; the rewrite wrapper will pick up this trigger code
          // and start an LLM rewrite if any later provider also surfaces a
          // trigger-coded failure.
          //
          // (Used to throw ImageGenError("moderation_rejected") here, which
          // bypassed the rewrite wrapper entirely. That was wrong: most
          // "moderation" classifications come from upstream proxies' own
          // image-review layers, NOT OpenAI's content-policy moderation —
          // rewriting the prompt can actually move past them.)
          break;
        }
        if (classified.code === "aborted") {
          throw new ImageGenError("aborted", "image generation aborted by caller", attempts, err);
        }
        if (classified.code === "auth") {
          // Wrong API key won't get better on retry. Fall over to next provider.
          break;
        }
        if (classified.code === "provider_blocked_content") {
          // Gateway keyword filter — same prompt will fail every time on this
          // provider. Skip remaining retries and fall over.
          break;
        }
        if (classified.code === "upstream_safety_rejected") {
          // OpenAI model-layer safety reject — same prompt won't pass next
          // time either. Skip retries, fall over (and the rewrite wrapper
          // will pick this attempt up via the cumulative attempts trail).
          break;
        }
        if (classified.code === "quota_exhausted") {
          // Wallet / daily quota depleted. For a normal single-channel provider
          // this is a hard-stop: auto-disable the capability until next 06:00
          // Beijing time and fall over — retrying won't conjure budget before
          // the daily reset. Manual Web UI toggle clears the auto flag and
          // re-enables immediately after a top-up.
          if (!capability.extras?.exemptAutoDisable) {
            markCapabilityAutoDisabledUntilNext6am(provider.id, capability.kind);
            break;
          }
          // Exception: a capability flagged `extras.exemptAutoDisable` is a
          // multi-channel aggregate (e.g. `gpt`), where one quota signal means
          // a single upstream sub-channel is full, not the whole pool. Don't
          // auto-disable it, and — unlike a real hard-stop — DO retry on this
          // same provider: the next attempt may land on a sibling sub-channel
          // that still has budget. Fall through to the backoff/retry path
          // below; we only fall over once retryLimit is spent.
          console.log(
            `[image]   ${provider.name} quota signal but exempt (multi-channel) — retrying on same provider instead of auto-disable`,
          );
        }
        // Transient (or exempt-quota fall-through) — back off briefly, then
        // retry on the same provider.
        if (retry < retryLimit) {
          console.log(
            `[image]   …retrying ${provider.name} in ${PROVIDER_RETRY_BACKOFF_MS}ms (transient: ${classified.code})`,
          );
          await new Promise(rs => setTimeout(rs, PROVIDER_RETRY_BACKOFF_MS));
        }
      }
    }

    console.log(
      `[image] ⤵ ${provider.name} exhausted ${retryLimit + 1} attempts (last: ${lastClassified?.code ?? "unknown"}), falling over`,
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
  const extraHeaders = resolveExtraHeaders(capability);
  const client = new OpenAI({
    apiKey,
    baseURL: provider.baseUrl.replace(/\/+$/, ""),
    timeout: DEFAULT_TIMEOUT_MS,
    // Disable SDK-internal retries (was default 2). Retries are invisible in
    // logs and stack — one "failed" attempt can secretly be 3 round-trips of
    // 5-10 minutes each. We already retry at the pool-walker layer with full
    // visibility, so let the SDK fail loudly on the first attempt.
    maxRetries: 0,
    ...(extraHeaders ? { defaultHeaders: extraHeaders } : {}),
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
    // 放宽 OpenAI 自家 moderation 层(对直连 OpenAI 的渠道有效;对二道贩子代理
    // 是 best-effort —— 他们自家审查不读这个字段,但 OpenAI 上游层会按此放宽)。
    // 协议层:仅 images mode (/v1/images/generations) 接受 moderation 字段;
    // responses mode 协议本身不支持,所以这里只在 images 路径设。
    moderation: "low",
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
  /** Set for APIError; left undefined for network/abort/unknown branches. */
  httpStatus?: number;
  /** Set when SDK exposed it on the APIError instance. */
  requestId?: string;
  /**
   * Raw upstream response body (already JSON-parsed by SDK when possible).
   * String when upstream sent HTML or non-JSON; serialized + truncated
   * downstream before persisting. May be undefined for purely client-side
   * errors (abort, classifier-only failures) where no upstream payload exists.
   */
  body?: unknown;
}

/**
 * Cap on JSON-serialized errorBody size before it's stored in the attempts
 * column. Gateways returning HTML error pages can produce multi-KB bodies; we
 * don't want one wedged provider to balloon the DB. 4KB is enough to capture
 * an OpenAI APIError shape plus a moderate proxy-side trace block.
 */
const ERROR_BODY_MAX_BYTES = 4096;

/**
 * Best-effort grab of the upstream request id off an APIError. OpenAI SDK
 * normally promotes it onto `err.requestID`, but some compat proxies return it
 * only in raw response headers (`x-request-id` / `cf-ray` / `x-trace-id`).
 */
function extractRequestId(err: APIError): string | undefined {
  const direct = (err as unknown as { requestID?: string }).requestID;
  if (direct) return direct;
  const headers = (err as unknown as { headers?: Record<string, string> }).headers;
  if (headers && typeof headers === "object") {
    return (
      headers["x-request-id"] ??
      headers["x-trace-id"] ??
      headers["cf-ray"] ??
      undefined
    );
  }
  return undefined;
}

/**
 * Serialize any value to a string within the byte budget. Objects get
 * pretty-printed for dashboard readability; oversized values get the trailing
 * portion replaced with a marker so the truncation is obvious to operators.
 */
export function truncateErrorBody(body: unknown): unknown {
  if (body === undefined || body === null) return body;
  let serialized: string;
  if (typeof body === "string") {
    serialized = body;
  } else {
    try {
      serialized = JSON.stringify(body, null, 2);
    } catch {
      serialized = String(body);
    }
  }
  if (serialized.length <= ERROR_BODY_MAX_BYTES) {
    // For object inputs that fit, keep the structured shape so the dashboard
    // can render it natively rather than re-parsing a string.
    return typeof body === "string" ? body : body;
  }
  return `${serialized.slice(0, ERROR_BODY_MAX_BYTES)}\n…[truncated ${serialized.length - ERROR_BODY_MAX_BYTES} bytes]`;
}

/**
 * Loose quota-exhausted detector. Triggers when:
 *  - OpenAI standard `insufficient_quota` code/type, OR
 *  - message contains any pairing of (quota|balance|额度|余额) with
 *    (exhausted|exceeded|耗光|不足|用完|已用尽|no available).
 *
 * Errs on the side of inclusion per the spec (loose matching). Risk is a
 * short-lived rate-budget refusal getting auto-disabled until next 06:00 —
 * acceptable trade-off vs. burning attempts on a known-empty wallet.
 */
const QUOTA_MESSAGE_PATTERN =
  /insufficient[_\s-]quota|quota\s*(?:exhausted|exceeded|finished|depleted)|no\s+available\s+(?:image\s+)?quota|余额不足|余额已用|配额不足|配额已用|额度不足|额度已用|额度耗光|额度用完|额度用尽|账户余额|您的?余额|预扣费(?:额度)?失败|剩余额度.*?(?:不足|低于|需要)|扣费失败/i;

function isQuotaExhausted(
  code: unknown,
  type: unknown,
  message: string,
): boolean {
  if (code === "insufficient_quota" || type === "insufficient_quota") return true;
  return QUOTA_MESSAGE_PATTERN.test(message);
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
    const requestId = extractRequestId(err);
    // err.error is the SDK-parsed body when upstream sent JSON; fall back to
    // err.message envelope so the operator at least sees the SDK's framing
    // (status code / error class) instead of an empty body.
    const body =
      err.error !== undefined && err.error !== null
        ? err.error
        : { message: err.message, status: err.status };
    const isModeration =
      err.code === "content_policy_violation" ||
      err.type === "content_policy_violation" ||
      /content[_ ]policy|moderation|safety/i.test(message);
    if (isModeration) return { code: "moderation", message, httpStatus: status, requestId, body };
    // Gateway-level keyword filter (not upstream model safety). Two flavors:
    // (1) Chinese proxies wrap a policy refusal in HTTP 5xx with a Chinese
    // message and a traceid. (2) English "guardrails" style proxies (e.g.
    // c2i / deepark) return HTTP 400 with "may violate our guardrails
    // concerning similarity to third-party content". Both mean: same prompt
    // on same gateway will keep failing — hard-fallover + trigger rewrite.
    const isProviderBlocked =
      /违反.*?(平台|内容).*?(政策|规则)|内容.*?违规|提交.*?违反|guardrails|may violate|similar(?:ity)? to third[- ]party/i.test(
        message,
      );
    if (isProviderBlocked) {
      return { code: "provider_blocked_content", message: `HTTP ${status}: ${message}`, httpStatus: status, requestId, body };
    }
    // c2i / chatgpt2api-style upstream returned a text reply instead of an
    // image (prompt was interpreted as chat, not a drawing instruction).
    // Same prompt on same gateway will keep returning text — rewrite chain
    // can rescue by making the prompt explicitly look like an image command.
    if (err.code === "image_generation_text_response") {
      return { code: "provider_blocked_content", message: `HTTP ${status}: ${message}`, httpStatus: status, requestId, body };
    }
    // Quota / balance exhausted — auto-disable this capability until next
    // 06:00 Beijing time so the pool walker doesn't keep burning attempts.
    // Loose match: OpenAI standard `insufficient_quota` code + any phrasing
    // combining quota/balance/额度/余额 with exhausted/不足/耗光/用完.
    if (isQuotaExhausted(err.code, err.type, message)) {
      return { code: "quota_exhausted", message: `HTTP ${status}: ${message}`, httpStatus: status, requestId, body };
    }
    if (status === 401 || status === 403) return { code: "auth", message: `HTTP ${status}: ${message}`, httpStatus: status, requestId, body };
    if (status === 429) return { code: "rate_limit", message, httpStatus: status, requestId, body };
    if (status && status >= 500) return { code: "server", message: `HTTP ${status}: ${message}`, httpStatus: status, requestId, body };
    return { code: "unknown", message: `HTTP ${status}: ${message}`, httpStatus: status, requestId, body };
  }

  // Node fetch typically wraps the real reason in `.cause`. Unwrap it so
  // operators see UND_ERR_BODY_TIMEOUT / ECONNRESET / etc. instead of a
  // generic "fetch failed".
  const baseMessage = err instanceof Error ? err.message : String(err);
  const cause = err instanceof Error ? (err as Error & { cause?: unknown }).cause : undefined;
  let message = baseMessage;
  let causeRepr: unknown = undefined;
  if (cause !== undefined && cause !== null) {
    const causeStr =
      cause instanceof Error
        ? `${cause.name}: ${cause.message}${(cause as Error & { code?: string }).code ? ` (code=${(cause as Error & { code?: string }).code})` : ""}`
        : String(cause);
    message = `${baseMessage} | cause: ${causeStr}`;
    causeRepr =
      cause instanceof Error
        ? {
            name: cause.name,
            message: cause.message,
            code: (cause as Error & { code?: string }).code,
          }
        : cause;
  }
  // No upstream HTTP body to surface for these branches, but still expose the
  // wrapped error shape — operators want to see e.g. the undici cause code.
  const body =
    err instanceof Error
      ? { name: err.name, message: baseMessage, cause: causeRepr, stack: err.stack }
      : { value: String(err) };
  if (/network|fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|UND_ERR_|ECONNRESET/i.test(message)) {
    return { code: "network", message, body };
  }
  // Same gateway-level filter check as the APIError branch above — covers
  // responses-mode failures (which throw plain Error, not APIError).
  if (
    /违反.*?(平台|内容).*?(政策|规则)|内容.*?违规|提交.*?违反|guardrails|may violate|similar(?:ity)? to third[- ]party/i.test(
      message,
    )
  ) {
    return { code: "provider_blocked_content", message, body };
  }
  // Quota exhausted on responses-mode path. Same loose match as APIError branch.
  if (isQuotaExhausted(undefined, undefined, message)) {
    return { code: "quota_exhausted", message, body };
  }
  // OpenAI model-layer safety reject — typically surfaced through the SSE
  // `response.failed` event in responses-mode. The driver wraps it inside
  // the inkast diag message ("...Upstream errors: [response.failed: Your
  // request was rejected by the safety system. ...]"). Treat the same as
  // provider_blocked_content: hard-stop the current provider's retry, and
  // trigger LLM rewrite (model layer can change its mind once we degrade
  // the prompt's IP-identifying fingerprints).
  if (/rejected by the safety system|response\.failed.*safety|content[_ ]policy_violation/i.test(message)) {
    return { code: "upstream_safety_rejected", message, body };
  }
  // responses-mode driver throws plain Error with shape `HTTP <status>: ...`;
  // give the pool walker the same retry/fallover semantics it gets from the
  // SDK's APIError branch above by recovering the status code from the text.
  const httpMatch = message.match(/^HTTP (\d{3}):/);
  if (httpMatch) {
    const httpStatus = parseInt(httpMatch[1]!, 10);
    if (httpStatus === 401 || httpStatus === 403) return { code: "auth", message, httpStatus, body };
    if (httpStatus === 429) return { code: "rate_limit", message, httpStatus, body };
    if (httpStatus >= 500) return { code: "server", message, httpStatus, body };
  }
  return { code: "unknown", message, body };
}
