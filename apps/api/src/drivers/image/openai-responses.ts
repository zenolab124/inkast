import { IMAGE_FORMAT_DEFAULT, extractRatio, isRatioSize } from "@inkast/shared";
import type { Provider, ProviderCapability } from "../../storage/providers.js";
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

  console.log(
    `[image]   → STREAM ${url} (tool=image_generation${refs.length > 0 ? ` · ${refs.length} reference${refs.length > 1 ? "s" : ""}` : ""})`,
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
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutHandle);
    input.signal?.removeEventListener("abort", onParentAbort);
    throw err;
  }

  console.log(
    `[image]   ← response headers in ${Date.now() - reqStart}ms (status=${res.status} content-type=${res.headers.get("content-type") ?? "<none>"})`,
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    clearTimeout(timeoutHandle);
    input.signal?.removeEventListener("abort", onParentAbort);
    throw new Error(`HTTP ${res.status}: ${errText.slice(0, 500)}`);
  }
  if (!res.body) {
    clearTimeout(timeoutHandle);
    input.signal?.removeEventListener("abort", onParentAbort);
    throw new Error("responses mode: server returned no body");
  }

  try {
    const result = await consumeSseForImage(res.body, reqStart);
    if (!result) {
      throw new Error(
        "responses mode: stream ended without an image_generation_call result. The proxy may not have completed the tool call, or model declined to use it.",
      );
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
): Promise<string | null> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalFromDone: string | null = null;
  let lastPartial: string | null = null;

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
          return finalFromDone ?? lastPartial;
        }
        const obj = tryParseJson(parsed.data);
        if (!obj) continue;

        const t = typeof obj.type === "string" ? obj.type : undefined;
        if (t) {
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
            console.log(`[image]   … ${t} (+${Date.now() - reqStart}ms)`);
          }
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
  } finally {
    reader.releaseLock();
  }

  return finalFromDone ?? lastPartial;
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
