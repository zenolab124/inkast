import { extractRatio, isRatioSize } from "@inkast/shared";
import type { Provider, ProviderCapability } from "../../storage/providers.js";
import { resolveExtraHeaders } from "../codex-header.js";
import type { ImageGenInput } from "./types.js";

const DEFAULT_SIZE = "1024x1024";

const RATIO_SIZES: Readonly<Record<string, string>> = {
  "1:1": "1024x1024",
  "2:3": "768x1152",
  "3:2": "1152x768",
  "3:4": "768x1024",
  "4:3": "1024x768",
  "4:5": "832x1024",
  "5:4": "1024x832",
  "16:9": "1280x720",
  "9:16": "720x1280",
  "2:1": "1440x720",
  "1:2": "720x1440",
};

interface SiliconFlowRequestBody {
  model: string;
  prompt: string;
  image_size: string;
  batch_size: number;
  num_inference_steps: number;
  guidance_scale: number;
}

interface SiliconFlowResponse {
  images?: Array<{ url?: string }>;
}

export function buildSiliconFlowRequestBody(
  capability: ProviderCapability,
  input: ImageGenInput,
): SiliconFlowRequestBody {
  if ((input.referenceImages?.length ?? 0) > 0) {
    throw new Error("Kolors does not support reference image input");
  }

  const ratio = isRatioSize(input.size) ? extractRatio(input.size) : null;
  const exactSize = typeof input.size === "string" && /^\d+x\d+$/.test(input.size)
    ? input.size
    : null;
  const imageSize = ratio
    ? (RATIO_SIZES[ratio] ?? DEFAULT_SIZE)
    : exactSize ?? DEFAULT_SIZE;
  const prompt = ratio
    ? `${input.promptText}\n\nTarget aspect ratio: ${ratio}.`
    : input.promptText;

  return {
    model: capability.model,
    prompt,
    image_size: imageSize,
    batch_size: Math.min(Math.max(input.n ?? 1, 1), 4),
    num_inference_steps: 20,
    guidance_scale: 7.5,
  };
}

export async function callSiliconFlowApi(
  provider: Provider,
  capability: ProviderCapability,
  apiKey: string,
  input: ImageGenInput,
): Promise<string> {
  const baseUrl = provider.baseUrl.replace(/\/+$/, "");
  const body = buildSiliconFlowRequestBody(capability, input);
  console.log(
    `[image]   → POST ${baseUrl}/images/generations (siliconflow, size=${body.image_size})`,
  );
  const res = await fetch(`${baseUrl}/images/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...(resolveExtraHeaders(capability) ?? {}),
    },
    body: JSON.stringify(body),
    signal: input.signal,
  });
  if (!res.ok) {
    const errorBody = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${errorBody.slice(0, 500)}`);
  }
  const result = await res.json() as SiliconFlowResponse;
  const url = result.images?.[0]?.url;
  if (!url) throw new Error("SiliconFlow returned no image URL");
  const imageRes = await fetch(url, { signal: input.signal });
  if (!imageRes.ok) {
    throw new Error(`download Kolors image failed: HTTP ${imageRes.status}`);
  }
  return Buffer.from(await imageRes.arrayBuffer()).toString("base64");
}
