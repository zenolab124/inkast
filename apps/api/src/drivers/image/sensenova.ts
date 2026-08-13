import OpenAI from "openai";
import type { ImageGenerateParams } from "openai/resources/images";
import { extractRatio, isRatioSize } from "@inkast/shared";
import type { Provider, ProviderCapability } from "../../storage/providers.js";
import { resolveExtraHeaders } from "../codex-header.js";
import type { ImageGenInput } from "./types.js";

const DEFAULT_TIMEOUT_MS = 600_000;
const DEFAULT_SIZE = "2752x1536";

const RATIO_SIZES: Readonly<Record<string, string>> = {
  "2:3": "1664x2496",
  "3:2": "2496x1664",
  "3:4": "1760x2368",
  "4:3": "2368x1760",
  "4:5": "1824x2272",
  "5:4": "2272x1824",
  "1:1": "2048x2048",
  "16:9": "2752x1536",
  "9:16": "1536x2752",
  "21:9": "3072x1376",
  "9:21": "1344x3136",
};

const SUPPORTED_SIZES = new Set(Object.values(RATIO_SIZES));

interface SenseNovaRequestBody {
  model: string;
  prompt: string;
  size: string;
  n: number;
}

export function buildSenseNovaRequestBody(
  capability: ProviderCapability,
  input: ImageGenInput,
): SenseNovaRequestBody {
  if ((input.referenceImages?.length ?? 0) > 0) {
    throw new Error("SenseNova U1 Fast does not support reference image input");
  }

  const ratio = isRatioSize(input.size) ? extractRatio(input.size) : null;
  const size = ratio
    ? (RATIO_SIZES[ratio] ?? DEFAULT_SIZE)
    : input.size && SUPPORTED_SIZES.has(input.size)
      ? input.size
      : DEFAULT_SIZE;
  const prompt = ratio
    ? `${input.promptText}\n\nTarget aspect ratio: ${ratio}.`
    : input.promptText;

  return {
    model: capability.model,
    prompt,
    size,
    n: input.n ?? 1,
  };
}

export async function callSenseNovaApi(
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
  const body = buildSenseNovaRequestBody(capability, input);

  console.log(
    `[image]   → POST ${baseUrl}/images/generations (sensenova, size=${body.size})`,
  );
  const response = await client.images.generate(
    body as unknown as ImageGenerateParams,
    { signal: input.signal },
  );

  const first = response.data?.[0];
  if (first?.b64_json) return first.b64_json;
  if (first?.url) {
    const res = await fetch(first.url, { signal: input.signal });
    if (!res.ok) throw new Error(`download SenseNova image failed: HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer()).toString("base64");
  }
  throw new Error("SenseNova returned no image (neither b64_json nor url)");
}
