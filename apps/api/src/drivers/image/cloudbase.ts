import { createHmac, randomUUID } from "node:crypto";
import { extractRatio, isRatioSize } from "@inkast/shared";
import type { Provider, ProviderCapability } from "../../storage/providers.js";
import { appendImageCleanlinessInstruction } from "./prompt-cleanliness.js";
import type { ImageGenInput } from "./types.js";

const DEFAULT_MAX_CONCURRENCY = 5;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const SUPPORTED_RATIOS = new Set(["1:1", "3:4", "9:16", "16:9"]);
const SUPPORTED_RATIO_VALUES = [
  ["1:1", 1],
  ["3:4", 3 / 4],
  ["9:16", 9 / 16],
  ["16:9", 16 / 9],
] as const;

interface CloudBaseResponse {
  ok?: boolean;
  requestId?: string;
  url?: string;
  code?: string;
  message?: string;
}

export class CloudBaseImageError extends Error {
  override readonly name = "CloudBaseImageError";
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus?: number,
    public readonly body?: unknown,
  ) {
    super(message);
  }
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

export function resolveCloudBaseRatio(size: ImageGenInput["size"]): string {
  let requestedValue: number | null = null;
  if (isRatioSize(size)) {
    const ratio = extractRatio(size);
    if (ratio && SUPPORTED_RATIOS.has(ratio)) return ratio;
    const match = ratio?.match(/^(\d+):(\d+)$/);
    if (match) requestedValue = Number(match[1]) / Number(match[2]);
  }
  if (requestedValue === null && typeof size === "string") {
    const match = size.match(/^(\d+)x(\d+)$/);
    if (match) {
      const width = Number(match[1]);
      const height = Number(match[2]);
      const divisor = gcd(width, height);
      const ratio = `${width / divisor}:${height / divisor}`;
      if (SUPPORTED_RATIOS.has(ratio)) return ratio;
      requestedValue = width / height;
    }
  }
  if (!requestedValue || !Number.isFinite(requestedValue)) return "1:1";
  let nearest: readonly [string, number] = SUPPORTED_RATIO_VALUES[0];
  for (const candidate of SUPPORTED_RATIO_VALUES) {
    if (Math.abs(candidate[1] - requestedValue) < Math.abs(nearest[1] - requestedValue)) {
      nearest = candidate;
    }
  }
  return nearest[0];
}

export function buildCloudBaseRequestBody(input: ImageGenInput): string {
  const refs = input.referenceImages ?? [];
  if (refs.length > 1) {
    throw new CloudBaseImageError(
      "BAD_IMAGE_URL",
      `CloudBase image-to-image supports exactly one reference image (got ${refs.length})`,
    );
  }
  const sourceUrls = refs.map(ref => ref.sourceUrl).filter((url): url is string => Boolean(url));
  if (refs.length === 1 && sourceUrls.length !== 1) {
    throw new CloudBaseImageError(
      "BAD_IMAGE_URL",
      "CloudBase image-to-image requires the original validated HTTPS source URL",
    );
  }
  return JSON.stringify({
    taskId: randomUUID(),
    prompt: appendImageCleanlinessInstruction(input.promptText),
    imageUrls: sourceUrls,
    ratio: resolveCloudBaseRatio(input.size),
  });
}

function resolveMaxConcurrency(capability: ProviderCapability): number {
  const raw = capability.extras?.maxConcurrency;
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 1 && raw <= 20
    ? raw
    : DEFAULT_MAX_CONCURRENCY;
}

interface SemaphoreState {
  active: number;
  waiters: Array<() => void>;
}

const semaphores = new Map<string, SemaphoreState>();

async function acquire(providerId: string, limit: number, signal?: AbortSignal): Promise<() => void> {
  const state = semaphores.get(providerId) ?? { active: 0, waiters: [] };
  semaphores.set(providerId, state);
  if (state.active >= limit) {
    await new Promise<void>((resolve, reject) => {
      const wake = (): void => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      };
      const onAbort = (): void => {
        const index = state.waiters.indexOf(wake);
        if (index >= 0) state.waiters.splice(index, 1);
        reject(new DOMException("image generation aborted by caller", "AbortError"));
      };
      if (signal?.aborted) return onAbort();
      signal?.addEventListener("abort", onAbort, { once: true });
      state.waiters.push(wake);
    });
  }
  state.active++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    state.active--;
    state.waiters.shift()?.();
    if (state.active === 0 && state.waiters.length === 0) semaphores.delete(providerId);
  };
}

function sign(secret: string, timestamp: string, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

export async function callCloudBaseApi(
  provider: Provider,
  capability: ProviderCapability,
  apiKey: string,
  input: ImageGenInput,
): Promise<string> {
  const release = await acquire(provider.id, resolveMaxConcurrency(capability), input.signal);
  try {
    const body = buildCloudBaseRequestBody(input);
    const timestamp = String(Date.now());
    console.log(
      `[image]   → POST ${provider.baseUrl} (cloudbase, refs=${input.referenceImages?.length ?? 0}, ratio=${resolveCloudBaseRatio(input.size)})`,
    );
    const response = await fetch(provider.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Inkast-Timestamp": timestamp,
        "X-Inkast-Signature": sign(apiKey, timestamp, body),
      },
      body,
      signal: input.signal,
    });
    const data = (await response.json().catch(() => ({}))) as CloudBaseResponse;
    if (!response.ok || data.ok !== true || !data.url) {
      throw new CloudBaseImageError(
        data.code ?? `HTTP_${response.status}`,
        data.message ?? `CloudBase image proxy returned HTTP ${response.status}`,
        response.status,
        data,
      );
    }

    const image = await fetch(data.url, { signal: input.signal });
    if (!image.ok) {
      throw new CloudBaseImageError(
        "OUTPUT_DOWNLOAD_FAILED",
        `CloudBase output download returned HTTP ${image.status}`,
        image.status,
      );
    }
    const declaredLength = Number(image.headers.get("content-length") ?? "0");
    if (declaredLength > MAX_IMAGE_BYTES) {
      throw new CloudBaseImageError("OUTPUT_TOO_LARGE", "CloudBase output exceeds 20 MiB");
    }
    const bytes = Buffer.from(await image.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
      throw new CloudBaseImageError("OUTPUT_TOO_LARGE", "CloudBase output is empty or exceeds 20 MiB");
    }
    return bytes.toString("base64");
  } finally {
    release();
  }
}
