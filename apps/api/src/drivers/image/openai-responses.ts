import { IMAGE_FORMAT_DEFAULT, extractRatio, isRatioSize } from "@inkast/shared";
import type { Provider, ProviderCapability } from "../../storage/providers.js";
import { resolveExtraHeaders } from "./openai-compatible.js";
import type { ImageGenInput } from "./types.js";

const DEFAULT_TIMEOUT_MS = 600_000;

/**
 * Call an OpenAI-compatible /v1/responses endpoint with the built-in
 * `image_generation` tool, via raw fetch + manual SSE parsing.
 *
 * Why not the OpenAI SDK:
 *   - `client.responses.create` (non-streaming) hits a wall on third-party
 *     proxies that internally time out before the tool finishes, returning a
 *     stub with `call.status="generating"` and no `result`.
 *   - `client.responses.stream` works on official OpenAI but the SDK's stream
 *     parser strictly requires the event sequence to START with
 *     `response.created`, and proxies (anyrouter etc.) routinely skip that
 *     event. The SDK throws "expected 'response.created' event, got X" and
 *     unwinds the whole call.
 *   - Raw fetch + our own SSE parser tolerates any event order, drops events
 *     we don't recognize, and just looks for the one piece of data we need:
 *     a base64 `result` on an `image_generation_call` output item.
 *
 * What we listen for, in priority order:
 *   1. `response.output_item.done` where item.type === "image_generation_call"
 *      AND item.result is present — this is the authoritative final result.
 *   2. `response.image_generation_call.partial_image` — partial frames; the
 *      last one received is usually the finished image. Used as fallback when
 *      a proxy emits partial_image but never sends output_item.done.
 *   3. Top-level fallback: when the stream ends, if we have any partial_image
 *      and no done event, return the last partial.
 *
 * Differences from /v1/images/generations (see openai-compatible.ts):
 *   - No size / quality / n params — injected as natural-language hints
 *   - Reference image: base64 data URL as an `input_image` content part
 */
export async function callImageGenerationTool(
  provider: Provider,
  capability: ProviderCapability,
  apiKey: string,
  input: ImageGenInput,
): Promise<string> {
  const url = `${provider.baseUrl.replace(/\/+$/, "")}/responses`;
  const promptWithDirective = wrapPromptForImageGen(input);

  // Either a plain string (text-only) or a single user message with text +
  // one or more input_image parts (reference-image mode). The two shapes
  // match the documented OpenAI Responses API; proxies pass them through
  // verbatim. Multiple references: each becomes its own `input_image` part
  // in order.
  const refs = input.referenceImages ?? [];
  const requestInput: unknown = refs.length > 0
    ? [
        {
          role: "user",
          content: [
            { type: "input_text", text: promptWithDirective },
            ...refs.map(ref => ({
              type: "input_image",
              image_url: `data:${ref.mimeType};base64,${ref.buffer.toString("base64")}`,
              detail: "auto",
            })),
          ],
        },
      ]
    : promptWithDirective;

  // image_generation tool accepts `output_format` (best-effort; many proxies
  // silently drop unknown tool fields). Domain layer sniffs the bytes anyway,
  // so an ignored hint still produces an honest extension on disk.
  const requestedFormat = input.format ?? IMAGE_FORMAT_DEFAULT;
  const body = {
    model: capability.model,
    input: requestInput,
    tools: [{ type: "image_generation", output_format: requestedFormat }],
    // Force the tool call. General chat models tend to respond with text
    // when the input looks like a JSON spec.
    tool_choice: { type: "image_generation" },
    stream: true,
  };

  const bodyJson = JSON.stringify(body);
  const refsTotalBytes = refs.reduce((acc, r) => acc + r.buffer.length, 0);
  console.log(
    `[image]   → STREAM ${url} (tool=image_generation${refs.length > 0 ? ` · ${refs.length} reference${refs.length > 1 ? "s" : ""}` : ""})`,
  );
  console.log(
    `[image]   request: body=${bodyJson.length}B (json), refs=${refs.length} totaling ${refsTotalBytes}B (raw bytes, base64 inflates ~33%)`,
  );
  for (const [i, ref] of refs.entries()) {
    console.log(
      `[image]   reference[${i}]: ${ref.mimeType} · ${ref.buffer.length} bytes`,
    );
  }
  const reqStart = Date.now();

  // Combine the caller's abort signal with our own timeout. Either firing
  // aborts the fetch immediately.
  const controller = new AbortController();
  const onParentAbort = () => controller.abort();
  input.signal?.addEventListener("abort", onParentAbort, { once: true });
  const timeoutHandle = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        Accept: "text/event-stream",
        ...(resolveExtraHeaders(capability) ?? {}),
      },
      body: bodyJson,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutHandle);
    input.signal?.removeEventListener("abort", onParentAbort);
    // Wrap with the underlying cause so the caller can see *why* fetch died
    // (DNS, TCP reset, TLS, undici body-timeout, etc.).
    const detail = describeCause(err);
    console.log(
      `[image]   ✗ fetch errored before/at response headers in ${Date.now() - reqStart}ms: ${detail}`,
    );
    throw new Error(`fetch failed before stream: ${detail}`);
  }

  // Dump a compact subset of response headers — the keys most useful for
  // tracing in a proxy's logs (request id, ray id, rate limit, retry hints).
  const headerSnapshot = pickHeaderSnapshot(res.headers);
  console.log(
    `[image]   ← response headers in ${Date.now() - reqStart}ms (status=${res.status} content-type=${res.headers.get("content-type") ?? "<none>"})`,
  );
  if (Object.keys(headerSnapshot).length > 0) {
    console.log(`[image]     resp-headers: ${JSON.stringify(headerSnapshot)}`);
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    clearTimeout(timeoutHandle);
    input.signal?.removeEventListener("abort", onParentAbort);
    // Include the snapshot inline so the caller (and downstream attempts log)
    // sees both body and headers without having to scrape console.
    const headersInfo =
      Object.keys(headerSnapshot).length > 0
        ? ` headers=${JSON.stringify(headerSnapshot)}`
        : "";
    throw new Error(`HTTP ${res.status}: ${errText.slice(0, 500)}${headersInfo}`);
  }
  if (!res.body) {
    clearTimeout(timeoutHandle);
    input.signal?.removeEventListener("abort", onParentAbort);
    throw new Error("responses mode: server returned no body");
  }

  try {
    const { result, diag } = await consumeSseForImage(res.body, reqStart);
    if (!result) {
      console.log(`[image]   ✗ stream ended without image_generation_call result`);
      console.log(`[image]     ${diagOneLiner(diag)}`);
      const text = clipText(diag.modelText);
      if (text) console.log(`[image]     model.text="${text}"`);
      const reasoning = clipText(diag.reasoningText);
      if (reasoning) console.log(`[image]     reasoning="${reasoning}"`);
      throw new Error(formatStreamFailure(diag));
    }
    console.log(
      `[image]   ← b64 result received (${result.length} chars, total ${Date.now() - reqStart}ms)`,
    );
    return result;
  } finally {
    clearTimeout(timeoutHandle);
    input.signal?.removeEventListener("abort", onParentAbort);
  }
}

/**
 * Parse SSE events off the response body, returning the base64-encoded image
 * bytes the moment we see them. Tolerates non-standard event ordering, blank
 * lines, comment lines, and the `[DONE]` terminator (which some proxies send,
 * even though Responses API officially doesn't use it).
 */
async function consumeSseForImage(
  body: ReadableStream<Uint8Array>,
  reqStart: number,
): Promise<{ result: string | null; diag: SseDiagnostics }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalFromDone: string | null = null;
  let lastPartial: string | null = null;
  const diag = newSseDiagnostics();
  diag.lastEventAt = reqStart;

  try {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Process complete events separated by double-newlines (SSE spec).
        let sepIdx: number;
        while ((sepIdx = indexOfEventBoundary(buffer)) !== -1) {
          const eventBlock = buffer.slice(0, sepIdx);
          buffer = buffer.slice(sepIdx).replace(/^(\r?\n)+/, "");
          const parsed = parseEventBlock(eventBlock);
          if (!parsed) continue;
          if (parsed.data === "[DONE]") {
            // Some proxies send this; safe to treat as end-of-stream.
            return { result: finalFromDone ?? lastPartial, diag };
          }
          const obj = tryParseJson(parsed.data);
          if (!obj) {
            // Proxy sent malformed JSON. Don't crash — track it.
            diag.parseErrors += 1;
            continue;
          }
          // Track wall-clock gaps between events. The biggest gap is the most
          // informative single number for "where did the stream stall?"
          const now = Date.now();
          const gap = now - diag.lastEventAt;
          if (gap > diag.maxEventGapMs) diag.maxEventGapMs = gap;
          diag.lastEventAt = now;
          diag.eventCount += 1;

          const t = typeof obj.type === "string" ? obj.type : undefined;
          if (t) {
            diag.eventTypes[t] = (diag.eventTypes[t] ?? 0) + 1;
            // Log lifecycle/image events; skip the noisy deltas.
            if (
              t === "response.created" ||
              t === "response.in_progress" ||
              t === "response.completed" ||
              t === "response.failed" ||
              t === "response.incomplete" ||
              t.startsWith("response.image_generation_call.") ||
              t === "response.output_item.added" ||
              t === "response.output_item.done"
            ) {
              console.log(`[image]   … ${t} (+${now - reqStart}ms)`);
            }
          }

          // Capture upstream response metadata when it first appears. Useful
          // for spotting when proxy lies about the model or when chasing a
          // response.id in the upstream's logs.
          if (t === "response.created" || t === "response.in_progress") {
            if (!diag.responseId && obj.response?.id) {
              diag.responseId = obj.response.id;
            }
            if (!diag.responseModel && obj.response?.model) {
              diag.responseModel = obj.response.model;
            }
          }

          // Harvest upstream "why I failed" hints from any lifecycle event
          // that carries them. These are the ground truth — never overwrite
          // them with our own synthesized error messages.
          if (t === "response.failed") {
            const reason = obj.response?.error?.message ?? obj.error?.message;
            if (reason) diag.upstreamErrors.push(`response.failed: ${reason}`);
          }
          if (t === "response.incomplete") {
            const reason =
              obj.response?.incomplete_details?.reason ?? obj.incomplete_details?.reason;
            if (reason) diag.upstreamErrors.push(`response.incomplete: ${reason}`);
          }
          if (
            t === "response.image_generation_call.failed" ||
            t === "response.image_generation_call.error"
          ) {
            const reason = obj.error?.message ?? "<no message>";
            diag.upstreamErrors.push(`${t}: ${reason}`);
          }

          // Diagnostics: tally items as added/done, count partial frames,
          // accumulate model + reasoning text. All read-only for the success
          // path — they only matter when we throw `formatStreamFailure(diag)`.
          if (
            t === "response.output_item.added" &&
            obj.item &&
            typeof obj.item.type === "string"
          ) {
            const k = obj.item.type;
            diag.itemsAdded[k] = (diag.itemsAdded[k] ?? 0) + 1;
          }
          if (
            t === "response.output_item.done" &&
            obj.item &&
            typeof obj.item.type === "string"
          ) {
            const k = obj.item.type;
            diag.itemsDone[k] = (diag.itemsDone[k] ?? 0) + 1;
          }
          if (t === "response.image_generation_call.partial_image") {
            diag.partialFrames += 1;
          }
          if (
            t === "response.output_text.delta" &&
            typeof obj.delta === "string" &&
            diag.modelText.length < TEXT_CAP
          ) {
            diag.modelText += obj.delta;
          }
          if (
            (t === "response.reasoning_summary_text.delta" ||
              t === "response.reasoning_text.delta") &&
            typeof obj.delta === "string" &&
            diag.reasoningText.length < TEXT_CAP
          ) {
            diag.reasoningText += obj.delta;
          }

          // Primary: output_item.done with image_generation_call → item.result
          if (
            t === "response.output_item.done" &&
            obj.item &&
            obj.item.type === "image_generation_call" &&
            typeof obj.item.result === "string" &&
            obj.item.result.length > 0
          ) {
            finalFromDone = obj.item.result;
          }
          // Fallback: partial_image — last frame is typically the finished image.
          if (
            t === "response.image_generation_call.partial_image" &&
            typeof obj.partial_image_b64 === "string" &&
            obj.partial_image_b64.length > 0
          ) {
            lastPartial = obj.partial_image_b64;
          }
          // Some proxies stuff the result directly on the completed event.
          if (
            t === "response.image_generation_call.completed" &&
            typeof obj.result === "string" &&
            obj.result.length > 0
          ) {
            finalFromDone = obj.result;
          }
        }
      }
    } catch (err) {
      // Stream was aborted mid-flight (undici body-timeout, ECONNRESET, etc.).
      // DON'T re-throw blindly — preserve diag so the caller has context to
      // report. Surface the underlying cause too (Node fetch errors typically
      // wrap the real reason in `.cause`).
      diag.streamError = describeCause(err);
    }
  } finally {
    reader.releaseLock();
  }

  return { result: finalFromDone ?? lastPartial, diag };
}

/**
 * Unwrap a fetch/stream error into a readable one-liner that includes
 * `err.cause` if present. Node's fetch wraps the real reason
 * (UND_ERR_BODY_TIMEOUT, ECONNRESET, etc.) in `.cause` and we used to throw
 * away that detail.
 */
/**
 * Pull the response headers that matter for tracing across a proxy chain.
 * Different vendors expose different keys (CF, AWS, OpenAI direct, anyrouter,
 * etc.) — we collect a union of common ones. Empty object means "nothing
 * useful found".
 */
function pickHeaderSnapshot(h: Headers): Record<string, string> {
  const keys = [
    "x-request-id",
    "x-trace-id",
    "x-amzn-requestid",
    "x-amzn-trace-id",
    "cf-ray",
    "openai-request-id",
    "openai-organization",
    "openai-version",
    "openai-processing-ms",
    "x-ratelimit-limit-requests",
    "x-ratelimit-limit-tokens",
    "x-ratelimit-remaining-requests",
    "x-ratelimit-remaining-tokens",
    "x-ratelimit-reset-requests",
    "x-ratelimit-reset-tokens",
    "retry-after",
    "via",
    "server",
    "x-runtime",
  ];
  const snap: Record<string, string> = {};
  for (const k of keys) {
    const v = h.get(k);
    if (v !== null) snap[k] = v;
  }
  return snap;
}

function describeCause(err: unknown): string {
  if (err instanceof Error) {
    const head = `${err.name}: ${err.message}`;
    const cause = (err as Error & { cause?: unknown }).cause;
    if (cause === undefined || cause === null) return head;
    if (cause instanceof Error) {
      const code = (cause as Error & { code?: string }).code;
      const codeStr = code ? ` (code=${code})` : "";
      return `${head} | cause: ${cause.name}: ${cause.message}${codeStr}`;
    }
    return `${head} | cause: ${String(cause)}`;
  }
  return String(err);
}

function indexOfEventBoundary(buf: string): number {
  // SSE event boundary is "\n\n" but tolerant parsers also accept "\r\n\r\n".
  const a = buf.indexOf("\n\n");
  const b = buf.indexOf("\r\n\r\n");
  if (a === -1) return b;
  if (b === -1) return a;
  return Math.min(a, b);
}

function parseEventBlock(block: string): { event?: string; data: string } | null {
  // Each event block is a set of "field: value" lines; we care about `data:`
  // (potentially multi-line — concatenate). Lines starting with ":" are
  // comments and skipped.
  const lines = block.split(/\r?\n/);
  const dataLines: string[] = [];
  let event: string | undefined;
  for (const line of lines) {
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).replace(/^\s/, ""));
    }
  }
  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join("\n") };
}

interface SseEventPayload {
  type?: string;
  item?: { type?: string; result?: string };
  partial_image_b64?: string;
  result?: string;
  /** Present on `response.output_text.delta` events — incremental message text. */
  delta?: string;
  /** Present on `response.created` — top-level response wrapper. */
  response?: {
    id?: string;
    model?: string;
    created_at?: number;
    error?: { code?: string; message?: string } | null;
    incomplete_details?: { reason?: string } | null;
  };
  /** Present on lifecycle failed events. */
  error?: { code?: string; message?: string } | null;
  /** Present on `response.incomplete`. */
  incomplete_details?: { reason?: string } | null;
}

/**
 * Snapshot of what the SSE stream contained, populated as events flow. Useful
 * when the stream ends WITHOUT an image_generation_call result — the caller
 * surfaces this to the operator so they can tell "model only talked, never
 * called the tool" from "proxy truncated tool events" from "tool finished but
 * result field was filtered" etc.
 *
 * Intentionally redundant: `eventTypes` is the gold-standard tally; the other
 * fields are pre-computed shortcuts for the common diagnostic angles.
 */
interface SseDiagnostics {
  /** Total parsed JSON events. */
  eventCount: number;
  /** Counts by full event `type` string (response.output_item.added, ...). */
  eventTypes: Record<string, number>;
  /** `response.output_item.added` grouped by `item.type`. */
  itemsAdded: Record<string, number>;
  /** `response.output_item.done` grouped by `item.type`. */
  itemsDone: Record<string, number>;
  /** Count of `response.image_generation_call.partial_image` frames. */
  partialFrames: number;
  /** Accumulated `response.output_text.delta` text (what the model "said"). */
  modelText: string;
  /** Accumulated reasoning summary text, if the model emitted any. */
  reasoningText: string;
  /**
   * Set when the underlying ReadableStream throws mid-flight (network drop,
   * undici body-timeout, abort, etc.). Without this the caller used to see
   * `fetch failed` with zero context about what the stream had emitted before
   * dying — see Tier 1 #1 in the diagnostic plan.
   */
  streamError: string | null;
  /**
   * Upstream-side error/incomplete reasons harvested from
   * `response.failed`, `response.incomplete`, and the embedded
   * `response.error` field. These are the ground-truth "why" — much more
   * useful than our locally-synthesized error wrappers.
   */
  upstreamErrors: string[];
  /** Count of SSE data frames that failed JSON.parse — proxy malformed output. */
  parseErrors: number;
  /** OpenAI response id (response.created.response.id), if seen. */
  responseId: string | null;
  /** Actual model the upstream reports (may differ from requested capability.model). */
  responseModel: string | null;
  /** Max wall-clock gap between consecutive parsed events (ms). */
  maxEventGapMs: number;
  /** Timestamp of the last event we saw (used to compute maxEventGapMs). */
  lastEventAt: number;
}

/** Cap on accumulated text buffers to keep memory bounded if a model rants. */
const TEXT_CAP = 4000;

function newSseDiagnostics(): SseDiagnostics {
  return {
    eventCount: 0,
    eventTypes: {},
    itemsAdded: {},
    itemsDone: {},
    partialFrames: 0,
    modelText: "",
    reasoningText: "",
    streamError: null,
    upstreamErrors: [],
    parseErrors: 0,
    responseId: null,
    responseModel: null,
    maxEventGapMs: 0,
    lastEventAt: 0,
  };
}

/** Compact one-liner for console — easy to grep, includes every dimension. */
function diagOneLiner(diag: SseDiagnostics): string {
  return [
    `events=${diag.eventCount}`,
    `eventTypes=${JSON.stringify(diag.eventTypes)}`,
    `itemsAdded=${JSON.stringify(diag.itemsAdded)}`,
    `itemsDone=${JSON.stringify(diag.itemsDone)}`,
    `partialFrames=${diag.partialFrames}`,
    `modelText-len=${diag.modelText.length}`,
    `reasoningText-len=${diag.reasoningText.length}`,
    `parseErrors=${diag.parseErrors}`,
    `maxGap=${diag.maxEventGapMs}ms`,
    diag.responseId ? `respId=${diag.responseId}` : "respId=<none>",
    diag.responseModel ? `respModel=${diag.responseModel}` : "respModel=<none>",
    diag.streamError ? `streamError="${diag.streamError}"` : "streamError=<none>",
    diag.upstreamErrors.length > 0
      ? `upstreamErrors=${JSON.stringify(diag.upstreamErrors)}`
      : "upstreamErrors=[]",
  ].join(" ");
}

function clipText(s: string, max = 300): string {
  const t = s.trim().replace(/\s+/g, " ");
  if (t.length === 0) return "";
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function formatStreamFailure(diag: SseDiagnostics): string {
  const parts: string[] = [];
  parts.push(`Saw ${diag.eventCount} events.`);
  parts.push(`Event types: ${JSON.stringify(diag.eventTypes)}.`);
  parts.push(`Items added: ${JSON.stringify(diag.itemsAdded)}.`);
  parts.push(`Items done: ${JSON.stringify(diag.itemsDone)}.`);
  parts.push(`Partial frames: ${diag.partialFrames}.`);
  parts.push(`Max event gap: ${diag.maxEventGapMs}ms.`);
  if (diag.parseErrors > 0) parts.push(`Parse errors: ${diag.parseErrors}.`);
  if (diag.responseId) parts.push(`Response id: ${diag.responseId}.`);
  if (diag.responseModel) parts.push(`Response model: ${diag.responseModel}.`);
  if (diag.upstreamErrors.length > 0) {
    parts.push(`Upstream errors: ${JSON.stringify(diag.upstreamErrors)}.`);
  }
  if (diag.streamError) {
    parts.push(`Stream aborted: ${diag.streamError}.`);
  }
  const text = clipText(diag.modelText);
  if (text) parts.push(`Model said: "${text}".`);
  const reasoning = clipText(diag.reasoningText);
  if (reasoning) parts.push(`Reasoning: "${reasoning}".`);
  const headline = diag.streamError
    ? "stream aborted mid-flight"
    : "stream ended without an image_generation_call result";
  return `responses mode: ${headline}. ${parts.join(" ")}`;
}

function tryParseJson(s: string): SseEventPayload | null {
  try {
    return JSON.parse(s) as SseEventPayload;
  } catch {
    return null;
  }
}

/**
 * Wrap the caller's prompt with a directive that names the tool explicitly,
 * and append size/quality as natural-language hints (the Responses API
 * doesn't accept those as discrete params).
 */
function wrapPromptForImageGen(input: ImageGenInput): string {
  // Three size shapes the caller can send (see SIZE_AUTO / SIZE_RATIO_PREFIX
  // in @inkast/shared):
  //   "auto"        → omit dimension hint entirely; model picks freely
  //   "ratio:W:H"   → aspect ratio fixed, pixels free
  //   "WxH"         → exact pixel size
  // The Responses API doesn't accept any of these as discrete params, so we
  // encode whichever shape the caller chose into the prompt text.
  let dimensionHint: string;
  if (isRatioSize(input.size)) {
    dimensionHint = `Target aspect ratio: ${extractRatio(input.size)}.`;
  } else if (input.size && input.size !== "auto") {
    dimensionHint = `Target size: ${input.size}.`;
  } else {
    dimensionHint = "";
  }

  const qualityHint = input.quality ? ` Target quality: ${input.quality}.` : "";
  const countHint = input.n && input.n > 1 ? ` Generate ${input.n} images.` : "";

  const directive =
    `Use the image_generation tool to create an image based on the following spec.` +
    (dimensionHint ? ` ${dimensionHint}` : "") +
    qualityHint +
    countHint;

  return `${directive}\n\n${input.promptText}`;
}
