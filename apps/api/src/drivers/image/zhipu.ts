import OpenAI from "openai";
import type { ImageGenerateParams } from "openai/resources/images";
import { extractRatio, isRatioSize } from "@inkast/shared";
import type { Provider, ProviderCapability } from "../../storage/providers.js";
import { resolveExtraHeaders } from "../codex-header.js";
import { appendImageCleanlinessInstruction } from "./prompt-cleanliness.js";
import type { ImageGenInput } from "./types.js";

const DEFAULT_TIMEOUT_MS = 600_000;
const DEFAULT_SIZE = "1024x1024";
const MAX_PIXELS = 2 ** 21;

const RATIO_SIZES: Readonly<Record<string, string>> = {
  "1:1": "1024x1024",
  "2:3": "832x1248",
  "3:2": "1248x832",
  "3:4": "864x1152",
  "4:3": "1152x864",
  "4:5": "896x1120",
  "5:4": "1120x896",
  "16:9": "1344x768",
  "9:16": "768x1344",
  "2:1": "1440x720",
  "1:2": "720x1440",
};

interface ZhipuRequestBody {
  model: string;
  prompt: string;
  size: string;
  quality: "hd" | "standard";
}

function isSupportedExplicitSize(value: string): boolean {
  const match = /^(\d+)x(\d+)$/.exec(value);
  if (!match) return false;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return (
    width >= 512 && width <= 2048 && width % 16 === 0 &&
    height >= 512 && height <= 2048 && height % 16 === 0 &&
    width * height <= MAX_PIXELS
  );
}

export function buildZhipuRequestBody(
  capability: ProviderCapability,
  input: ImageGenInput,
): ZhipuRequestBody {
  if ((input.referenceImages?.length ?? 0) > 0) {
    throw new Error("CogView-4 does not support reference image input");
  }

  const ratio = isRatioSize(input.size) ? extractRatio(input.size) : null;
  const size = ratio
    ? (RATIO_SIZES[ratio] ?? DEFAULT_SIZE)
    : input.size && isSupportedExplicitSize(input.size)
      ? input.size
      : DEFAULT_SIZE;
  const prompt = buildZhipuPrompt(input);

  return {
    model: capability.model,
    prompt,
    size,
    quality: input.quality === "high" ? "hd" : "standard",
  };
}

export function buildZhipuPrompt(input: ImageGenInput): string {
  const ratio = isRatioSize(input.size) ? extractRatio(input.size) : null;
  return appendImageCleanlinessInstruction(
    input.promptText,
    ratio ? [`Target aspect ratio: ${ratio}.`] : [],
  );
}

export async function callZhipuApi(
  provider: Provider,
  capability: ProviderCapability,
  apiKey: string,
  input: ImageGenInput,
): Promise<string> {
  const baseUrl = provider.baseUrl.replace(/\/+$/, "");
  const extraHeaders = resolveExtraHeaders(capability);
  const client = new OpenAI({
    apiKey,
    baseURL: baseUrl,
    timeout: DEFAULT_TIMEOUT_MS,
    maxRetries: 0,
    ...(extraHeaders ? { defaultHeaders: extraHeaders } : {}),
  });
  const body = buildZhipuRequestBody(capability, input);

  console.log(
    `[image]   → POST ${baseUrl}/images/generations (zhipu, size=${body.size}, quality=${body.quality})`,
  );
  const response = await client.images.generate(
    body as unknown as ImageGenerateParams,
    { signal: input.signal },
  );
  const first = response.data?.[0];
  if (first?.b64_json) return first.b64_json;
  if (first?.url) {
    const res = await fetch(first.url, { signal: input.signal });
    if (!res.ok) throw new Error(`download CogView-4 image failed: HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer()).toString("base64");
  }
  throw new Error("CogView-4 returned no image (neither b64_json nor url)");
}
