import OpenAI from "openai";
import type { ImageGenerateParams } from "openai/resources/images";
import { extractRatio, isRatioSize } from "@inkast/shared";
import type { Provider, ProviderCapability } from "../../storage/providers.js";
import { resolveExtraHeaders } from "../codex-header.js";
import { appendImageCleanlinessInstruction } from "./prompt-cleanliness.js";
import type { ImageGenInput } from "./types.js";

const DEFAULT_TIMEOUT_MS = 600_000;
const DEFAULT_SEEDREAM_SIZE = "2K";
const MIN_SEEDREAM_PIXELS = 3_686_400;

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

interface SeedreamRequestBody {
  model: string;
  prompt: string;
  image?: string[];
  size: string;
  sequential_image_generation: "disabled";
  stream: false;
  response_format: "b64_json";
  watermark: false;
}

/**
 * Build the Volcengine Ark Seedream request body.
 *
 * Seedream deliberately does not use the OpenAI `/images/edits` route:
 * text-to-image, single-reference edit and multi-reference composition all
 * go through `/images/generations`, with reference bytes in `image`.
 */
export function buildSeedreamRequestBody(
  capability: ProviderCapability,
  input: ImageGenInput,
): SeedreamRequestBody {
  const refs = input.referenceImages ?? [];
  const useRatio = isRatioSize(input.size);
  const exactMatch = typeof input.size === "string"
    ? input.size.match(/^(\d+)x(\d+)$/)
    : null;
  const exactWidth = exactMatch ? Number(exactMatch[1]) : 0;
  const exactHeight = exactMatch ? Number(exactMatch[2]) : 0;
  const exactSizeAllowed = exactWidth * exactHeight >= MIN_SEEDREAM_PIXELS;
  const ratioDivisor = exactMatch && !exactSizeAllowed ? gcd(exactWidth, exactHeight) : 0;
  const ratioHint = useRatio
    ? extractRatio(input.size)
    : ratioDivisor > 0
      ? `${exactWidth / ratioDivisor}:${exactHeight / ratioDivisor}`
      : null;
  const prompt = appendImageCleanlinessInstruction(
    input.promptText,
    ratioHint ? [`Target aspect ratio: ${ratioHint}.`] : [],
  );
  const upstreamSize = exactMatch && exactSizeAllowed
    ? input.size as string
    : DEFAULT_SEEDREAM_SIZE;

  return {
    model: capability.model,
    prompt,
    ...(refs.length > 0
      ? {
          image: refs.map(
            ref => `data:${ref.mimeType.toLowerCase()};base64,${ref.buffer.toString("base64")}`,
          ),
        }
      : {}),
    size: upstreamSize,
    sequential_image_generation: "disabled",
    stream: false,
    response_format: "b64_json",
    // The product handles AI-origin disclosure itself. Do not add the
    // provider's visible corner watermark to user artwork.
    watermark: false,
  };
}

export async function callSeedreamApi(
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
  const body = buildSeedreamRequestBody(capability, input);

  console.log(
    `[image]   → POST ${baseUrl}/images/generations (seedream, refs=${body.image?.length ?? 0}, size=${body.size})`,
  );
  const reqStart = Date.now();
  // The OpenAI SDK keeps the standard auth/error/abort behavior while the
  // unchecked cast lets us send Ark's extra JSON fields (`image`,
  // `sequential_image_generation`, `watermark`) unchanged.
  const response = await client.images.generate(
    body as unknown as ImageGenerateParams,
    { signal: input.signal },
  );
  console.log(`[image]   ← seedream response in ${Date.now() - reqStart}ms`);

  const first = response.data?.[0];
  if (first?.b64_json) {
    console.log(`[image]   ← seedream b64_json received (${first.b64_json.length} chars)`);
    return first.b64_json;
  }
  if (first?.url) {
    console.log(`[image]   ← seedream url received, fetching bytes…`);
    const res = await fetch(first.url, { signal: input.signal });
    if (!res.ok) throw new Error(`download seedream image failed: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.toString("base64");
  }
  throw new Error("seedream returned no image (neither b64_json nor url)");
}
