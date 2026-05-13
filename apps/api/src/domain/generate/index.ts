import { writeFile } from "node:fs/promises";
import { mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ImagePrompt } from "@inkast/shared";
import { generateImage as drive } from "../../drivers/image/openai-compatible.js";
import {
  ImageGenError,
  type ImageGenInput,
  type ImageGenOutcome,
} from "../../drivers/image/types.js";
import { imagesDir } from "../../storage/runtime.js";
import {
  createGeneration,
  type Generation,
} from "../../storage/generations.js";

export interface GenerateInput {
  prompt: ImagePrompt;
  size?: ImageGenInput["size"];
  quality?: ImageGenInput["quality"];
  bypassModeration?: boolean;
  signal?: AbortSignal;
}

export interface GenerateOutcome {
  generation: Generation;
  driver: ImageGenOutcome;
}

/**
 * End-to-end image generation:
 *   1. Build prompt text (JSON.stringify of the structured prompt)
 *   2. Drive the provider pool (image driver handles failover)
 *   3. Persist image bytes to <DATA_DIR>/images/YYYY/MM/<id>.png
 *   4. Insert a generations row
 *
 * Path layout matches gpt-image-canvas conventions so a future cloud-sync
 * adapter (Phase 2+) can mirror them unchanged.
 */
export async function generate(input: GenerateInput): Promise<GenerateOutcome> {
  const promptText = JSON.stringify(input.prompt);

  const outcome = await drive({
    promptText,
    size: input.size,
    quality: input.quality,
    bypassModeration: input.bypassModeration,
    signal: input.signal,
  });

  const { relativePath, absolutePath } = imagePathFor(outcome.format);
  const dir = absolutePath.slice(0, absolutePath.lastIndexOf("/"));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  await writeFile(absolutePath, Buffer.from(outcome.imageB64, "base64"));

  const generation = createGeneration({
    promptSnapshot: input.prompt,
    promptText,
    imagePath: relativePath,
    imageFormat: outcome.format,
    size: input.size ?? "1024x1024",
    quality: input.quality ?? "high",
    providerId: outcome.providerId,
    durationMs: outcome.totalDurationMs,
  });

  return { generation, driver: outcome };
}

export function readImageBytes(relativePath: string): Buffer {
  const safe = sanitizeRelativePath(relativePath);
  return readFileSync(join(imagesDir(), safe));
}

function imagePathFor(format: string): { relativePath: string; absolutePath: string } {
  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  // Use crypto.randomUUID for the filename; we don't reuse the generation
  // row id here because the image is written before the row exists.
  const id = cryptoRandomId();
  const rel = `${yyyy}/${mm}/${id}.${format}`;
  return { relativePath: rel, absolutePath: join(imagesDir(), rel) };
}

function sanitizeRelativePath(rel: string): string {
  if (rel.includes("..") || rel.startsWith("/")) {
    throw new Error("invalid image path");
  }
  return rel;
}

function cryptoRandomId(): string {
  return globalThis.crypto.randomUUID();
}

export { ImageGenError };
