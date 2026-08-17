import { extractRatio, isRatioSize } from "@inkast/shared";
import type { Provider, ProviderCapability } from "../../storage/providers.js";
import { resolveExtraHeaders } from "../codex-header.js";
import type { ImageGenInput } from "./types.js";

const DEFAULT_TIMEOUT_MS = 600_000;
const POLL_INITIAL_MS = 3_000;
const POLL_BACKOFF = 1.5;
const POLL_MAX_MS = 15_000;
const RESUME_POLL_THRESHOLD_MS = 300_000;

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
): Promise<C2iTasksResult> {
  const rootUrl = deriveRootUrl(provider.baseUrl);
  const refs = input.referenceImages ?? [];
  const hasRefs = refs.length > 0;
  const endpoint = hasRefs ? "edits" : "generations";
  const url = `${rootUrl}/api/image-tasks/${endpoint}`;

  const controller = new AbortController();
  const onParentAbort = () => controller.abort();
  input.signal?.addEventListener("abort", onParentAbort, { once: true });
  const timeoutHandle = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const taskId = await submitTask(
      url, apiKey, capability, input, refs, hasRefs, controller.signal,
    );
    return await pollUntilDone(
      rootUrl, apiKey, taskId, controller.signal,
    );
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
  capability: ProviderCapability,
  input: ImageGenInput,
  refs: NonNullable<ImageGenInput["referenceImages"]>,
  hasRefs: boolean,
  signal: AbortSignal,
): Promise<string> {
  const clientTaskId = crypto.randomUUID();
  const promptText = buildPromptText(input);

  const body: Record<string, unknown> = {
    client_task_id: clientTaskId,
    prompt: promptText,
    model: capability.model,
    quality: input.quality ?? "high",
    output_format: input.format ?? "png",
    response_format: input.deliveryIntent === "persistent-url" ? "url" : "b64_json",
    ...(input.deliveryIntent === "persistent-url" ? { url_source: "r2" } : {}),
    // chatgpt2api keeps resize/compression disabled for all callers unless
    // Inkast explicitly opts in on its dedicated async-task integration.
    optimize_output: true,
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

  const bodyJson = JSON.stringify(body);
  console.log(
    `[image]   → POST ${url} (c2i-tasks ${hasRefs ? "edit" : "gen"}, refs=${refs.length}, body=${bodyJson.length}B)`,
  );
  const reqStart = Date.now();

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...(resolveExtraHeaders(capability) ?? {}),
    },
    body: bodyJson,
    signal,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${errText.slice(0, 500)}`);
  }

  const result = await res.json() as { id?: string; status?: string };
  const taskId = result.id;
  if (!taskId) {
    throw new Error("c2i-tasks: submit returned no task id");
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
  duration_ms?: number;
}

async function pollUntilDone(
  rootUrl: string,
  apiKey: string,
  taskId: string,
  signal: AbortSignal,
): Promise<C2iTasksResult> {
  const pollUrl = `${rootUrl}/api/image-tasks?ids=${encodeURIComponent(taskId)}`;
  const pollStart = Date.now();
  let interval = POLL_INITIAL_MS;
  let resumeFired = false;

  while (true) {
    if (signal.aborted) throw new Error("aborted");

    await sleep(interval, signal);
    if (signal.aborted) throw new Error("aborted");

    const res = await fetch(pollUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
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

    const elapsed = Date.now() - pollStart;
    console.log(
      `[image]   … poll ${taskId} status=${task.status} (+${elapsed}ms)`,
    );

    if (task.status === "success") {
      return await extractResult(task, signal);
    }

    if (task.status === "error") {
      throw new Error(task.error || "c2i-tasks: upstream task failed");
    }

    if (
      !resumeFired &&
      elapsed > RESUME_POLL_THRESHOLD_MS &&
      task.status === "running"
    ) {
      resumeFired = true;
      await fireResumePoll(rootUrl, apiKey, taskId, signal);
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
): Promise<void> {
  const url = `${rootUrl}/api/image-tasks/${encodeURIComponent(taskId)}/resume-poll`;
  console.log(`[image]   → resume-poll ${taskId} (running > ${RESUME_POLL_THRESHOLD_MS / 1000}s)`);
  try {
    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ extra_timeout_secs: 60 }),
      signal,
    });
  } catch {
    // best-effort; don't fail the poll loop
  }
}

function buildPromptText(input: ImageGenInput): string {
  let text = input.promptText;
  if (isRatioSize(input.size)) {
    text += `\n\nTarget aspect ratio: ${extractRatio(input.size)}.`;
  }
  return text;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error("aborted"));
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
