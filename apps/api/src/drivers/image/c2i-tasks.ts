import { extractRatio, isRatioSize } from "@inkast/shared";
import { createHash } from "node:crypto";
import type { Provider, ProviderCapability } from "../../storage/providers.js";
import { resolveExtraHeaders } from "../codex-header.js";
import { appendImageCleanlinessInstruction } from "./prompt-cleanliness.js";
import type { ImageGenInput } from "./types.js";

const DEFAULT_TIMEOUT_MS = 600_000;
const POLL_INITIAL_MS = 3_000;
const POLL_BACKOFF = 1.5;
const POLL_MAX_MS = 15_000;
const RESUME_POLL_THRESHOLD_MS = 300_000;

/** A 2.5 web alias alone does not select the independently authorized Codex route. */
export function isC2iCodexModel(model: string): boolean {
  return /^(?:[a-z0-9]+-)?codex-gpt-image-/i.test(model);
}

export function resolveC2iOptimizeOutput(capability: ProviderCapability): boolean {
  const configured = capability.extras?.optimizeOutput;
  return typeof configured === "boolean" ? configured : !isC2iCodexModel(capability.model);
}

interface C2iTasksDependencies {
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

/** The upstream may still be working; the pool must not create a replacement. */
export class C2iTaskPendingError extends Error {
  override readonly name = "C2iTaskPendingError";
  constructor(public readonly taskId: string, message: string) {
    super(`c2i-tasks: original task ${taskId} requires status recovery: ${message}`);
  }
}
class C2iTaskTerminalError extends Error {}

/**
 * c2i-tasks driver — calls chatgpt2api's custom async task API.
 *
 * Flow: submit task → poll until done → return bytes or an explicitly
 * requested provider-owned persistent URL.
 * Supports multi-reference images natively via the /api/image-tasks/edits
 * endpoint (multiple entries in the JSON `images` array).
 */
export interface C2iTasksResult {
  b64: string;
  /** Set when upstream returned a URL — consumer can use it directly. */
  url?: string;
}

export async function callC2iTasksApi(
  provider: Provider,
  capability: ProviderCapability,
  apiKey: string,
  input: ImageGenInput,
  deps: C2iTasksDependencies = {},
): Promise<C2iTasksResult> {
  const rootUrl = deriveRootUrl(provider.baseUrl);
  const refs = input.referenceImages ?? [];
  const hasRefs = refs.length > 0;
  const endpoint = hasRefs ? "edits" : "generations";
  const url = `${rootUrl}/api/image-tasks/${endpoint}`;

  const controller = new AbortController();
  const onParentAbort = () => controller.abort();
  if (input.signal?.aborted) controller.abort();
  input.signal?.addEventListener("abort", onParentAbort, { once: true });
  const timeoutHandle = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    let taskId: string;
    try {
      taskId = await submitTask(
        url, apiKey, provider.id, capability, input, refs, hasRefs, controller.signal, deps.fetch ?? fetch,
      );
    } catch (error) {
      if (!(error instanceof C2iTaskPendingError) || controller.signal.aborted) throw error;
      // A lost admission response does not mean no task was created.
      taskId = error.taskId;
    }
    try {
      return await pollUntilDone(
        rootUrl, apiKey, taskId, controller.signal, !isC2iCodexModel(capability.model), deps,
        resolveExtraHeaders(capability),
      );
    } catch (error) {
      if (error instanceof C2iTaskTerminalError) throw error;
      throw new C2iTaskPendingError(taskId, error instanceof Error ? error.message : String(error));
    }
  } finally {
    clearTimeout(timeoutHandle);
    input.signal?.removeEventListener("abort", onParentAbort);
  }
}

function deriveRootUrl(baseUrl: string): string {
  try {
    return new URL(baseUrl).origin;
  } catch {
    return baseUrl.replace(/\/v1\/?$/, "").replace(/\/+$/, "");
  }
}

async function submitTask(
  url: string,
  apiKey: string,
  providerId: string,
  capability: ProviderCapability,
  input: ImageGenInput,
  refs: NonNullable<ImageGenInput["referenceImages"]>,
  hasRefs: boolean,
  signal: AbortSignal,
  request: typeof fetch,
): Promise<string> {
  const promptText = buildC2iPromptText(input);

  const body: Record<string, unknown> = {
    batch_size: 1,
    prompt: promptText,
    model: capability.model,
    quality: input.quality ?? "high",
    output_format: input.format ?? "png",
    ...(input.background ? { background: input.background } : {}),
    response_format: input.deliveryIntent === "persistent-url" ? "url" : "b64_json",
    ...(input.deliveryIntent === "persistent-url" ? { url_source: "r2" } : {}),
    // Preserve legacy web sizing. Codex keeps native output by default so
    // quality comparisons do not silently crop/recompress the generated art.
    optimize_output: resolveC2iOptimizeOutput(capability),
  };

  const useRatio = isRatioSize(input.size);
  if (!useRatio && input.size && input.size !== "auto") {
    body.size = input.size;
  }

  if (hasRefs) {
    body.images = refs.map(
      ref => `data:${ref.mimeType};base64,${ref.buffer.toString("base64")}`,
    );
  }

  const clientTaskId = input.requestKey
    ? `inkast-${createHash("sha256").update(JSON.stringify([providerId, input.requestKey, body])).digest("hex").slice(0, 48)}`
    : crypto.randomUUID();
  body.client_task_id = clientTaskId;
  const headers = {
    "Content-Type": "application/json", Authorization: `Bearer ${apiKey}`,
    ...(resolveExtraHeaders(capability) ?? {}),
  };
  if (input.requestKey) {
    try {
      const check = await request(`${new URL(url).origin}/api/image-tasks?ids=${encodeURIComponent(clientTaskId)}`, { headers, signal });
      if (!check.ok) throw new Error(`status HTTP ${check.status}`);
      const known = await check.json() as { items?: C2iTaskItem[]; missing_ids?: string[] };
      if (known.items?.some(task => task.id === clientTaskId)) return clientTaskId;
      if (!known.missing_ids?.includes(clientTaskId) || check.headers.get("x-image-task-admission") !== "durable-v1")
        throw new Error("upstream did not confirm durable absence");
    } catch (error) {
      throw new C2iTaskPendingError(clientTaskId, error instanceof Error ? error.message : String(error));
    }
  }

  const bodyJson = JSON.stringify(body);
  console.log(
    `[image]   → POST ${url} (c2i-tasks ${hasRefs ? "edit" : "gen"}, refs=${refs.length}, body=${bodyJson.length}B)`,
  );
  const reqStart = Date.now();

  let res: Response;
  try {
    res = await request(url, { method: "POST", headers, body: bodyJson, signal });
  } catch (error) {
    throw new C2iTaskPendingError(clientTaskId, error instanceof Error ? error.message : String(error));
  }

  if (!res.ok) {
    if (res.status >= 500 || res.status === 408)
      throw new C2iTaskPendingError(clientTaskId, `submit HTTP ${res.status}`);
    const errText = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${errText.slice(0, 500)}`);
  }

  let result: { id?: string; status?: string };
  try { result = await res.json() as { id?: string; status?: string }; } catch {
    throw new C2iTaskPendingError(clientTaskId, "invalid admission response");
  }
  const taskId = result.id;
  if (!taskId || taskId !== clientTaskId) {
    throw new C2iTaskPendingError(clientTaskId, "submit returned no matching task id");
  }
  console.log(
    `[image]   ← task submitted: id=${taskId} status=${result.status} (+${Date.now() - reqStart}ms)`,
  );
  return taskId;
}

interface C2iTaskItem {
  id: string;
  status: string;
  data?: Array<{ b64_json?: string; url?: string }>;
  error?: string;
  error_code?: string;
  duration_ms?: number;
}

async function pollUntilDone(
  rootUrl: string,
  apiKey: string,
  taskId: string,
  signal: AbortSignal,
  allowWebResume: boolean,
  deps: C2iTasksDependencies,
  extraHeaders?: Record<string, string>,
): Promise<C2iTasksResult> {
  const request = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const pollUrl = `${rootUrl}/api/image-tasks?ids=${encodeURIComponent(taskId)}`;
  const pollStart = now();
  let interval = POLL_INITIAL_MS;
  let resumeFired = false;

  while (true) {
    if (signal.aborted) throw new Error("aborted");

    await (deps.sleep ?? sleep)(interval, signal);
    if (signal.aborted) throw new Error("aborted");

    const res = await request(pollUrl, {
      headers: { Authorization: `Bearer ${apiKey}`, ...extraHeaders },
      signal,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${errText.slice(0, 500)}`);
    }

    const body = await res.json() as {
      items?: C2iTaskItem[];
      missing_ids?: string[];
    };

    if (body.missing_ids?.includes(taskId)) {
      throw new Error("c2i-tasks: task disappeared from upstream (garbage-collected or invalid id)");
    }

    const task = body.items?.find(t => t.id === taskId);
    if (!task) {
      throw new Error("c2i-tasks: task not found in poll response");
    }

    const elapsed = now() - pollStart;
    console.log(
      `[image]   … poll ${taskId} status=${task.status} (+${elapsed}ms)`,
    );

    if (task.status === "success") {
      return await extractResult(task, signal);
    }

    if (task.status === "error") {
      if (["CODEX_OUTCOME_UNKNOWN", "codex_invalid_image", "codex_result_delivery_failed"].includes(task.error_code ?? "")) {
        // Generation may have consumed quota; status recovery must retain the
        // original task identity rather than falling back to another provider.
        throw new C2iTaskPendingError(taskId, task.error || "Codex result requires recovery");
      }
      throw new C2iTaskTerminalError(task.error || "c2i-tasks: upstream task failed");
    }

    if (
      !resumeFired &&
      allowWebResume &&
      elapsed > RESUME_POLL_THRESHOLD_MS &&
      task.status === "running"
    ) {
      resumeFired = true;
      await fireResumePoll(rootUrl, apiKey, taskId, signal, request, extraHeaders);
    }

    interval = Math.min(interval * POLL_BACKOFF, POLL_MAX_MS);
  }
}

async function extractResult(
  task: C2iTaskItem,
  _signal: AbortSignal,
): Promise<C2iTasksResult> {
  const first = task.data?.[0];
  if (!first) {
    throw new Error("c2i-tasks: task succeeded but data is empty");
  }

  if (first.url) {
    console.log(
      `[image]   ← c2i-tasks url: ${first.url} (duration=${task.duration_ms}ms)`,
    );
    return { b64: "", url: first.url };
  }

  if (first.b64_json) {
    console.log(
      `[image]   ← c2i-tasks b64_json (${first.b64_json.length} chars, duration=${task.duration_ms}ms)`,
    );
    return { b64: first.b64_json };
  }

  throw new Error("c2i-tasks: task data has neither b64_json nor url");
}

async function fireResumePoll(
  rootUrl: string,
  apiKey: string,
  taskId: string,
  signal: AbortSignal,
  request: typeof fetch,
  extraHeaders?: Record<string, string>,
): Promise<void> {
  const url = `${rootUrl}/api/image-tasks/${encodeURIComponent(taskId)}/resume-poll`;
  console.log(`[image]   → resume-poll ${taskId} (running > ${RESUME_POLL_THRESHOLD_MS / 1000}s)`);
  try {
    await request(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...extraHeaders,
      },
      body: JSON.stringify({ extra_timeout_secs: 60 }),
      signal,
    });
  } catch {
    // best-effort; don't fail the poll loop
  }
}

export function buildC2iPromptText(input: ImageGenInput): string {
  const ratioHint = isRatioSize(input.size)
    ? `Target aspect ratio: ${extractRatio(input.size)}.`
    : null;
  return appendImageCleanlinessInstruction(
    input.promptText,
    ratioHint ? [ratioHint] : [],
  );
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error("aborted"));
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
