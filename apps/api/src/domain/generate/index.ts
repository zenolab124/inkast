import { writeFile } from "node:fs/promises";
import { mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ImagePrompt, ReferenceImage } from "@inkast/shared";
import { generateImage as drive } from "../../drivers/image/openai-compatible.js";
import {
  ImageGenError,
  type ImageGenInput,
  type ImageGenOutcome,
} from "../../drivers/image/types.js";
import { imagesDir } from "../../storage/runtime.js";
import {
  createGeneration,
  getGeneration,
  type Generation,
} from "../../storage/generations.js";
import {
  markJobFailed,
  markJobRunning,
  markJobSucceeded,
  updateJobAttempts,
} from "../../storage/jobs.js";

export interface GenerateInput {
  prompt: ImagePrompt;
  size?: ImageGenInput["size"];
  quality?: ImageGenInput["quality"];
  bypassModeration?: boolean;
  signal?: AbortSignal;
  /** Bypass the structured-prompt JSON.stringify path; feed this text directly. */
  rawPrompt?: string;
  /** Reference image (Gallery generation or fresh upload). */
  referenceImage?: ReferenceImage;
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
  const promptText = input.rawPrompt ?? JSON.stringify(input.prompt);
  const mode = input.rawPrompt ? "raw-prose" : "structured-json";
  const referenceImage = input.referenceImage
    ? await resolveReferenceImage(input.referenceImage)
    : undefined;
  console.log(
    `[generate] ▶ start · mode=${mode} · prompt-bytes=${promptText.length}${referenceImage ? ` · with-reference` : ""}`,
  );

  const outcome = await drive({
    promptText,
    size: input.size,
    quality: input.quality,
    bypassModeration: input.bypassModeration,
    signal: input.signal,
    referenceImage,
  });

  const { relativePath, absolutePath } = imagePathFor(outcome.format);
  const dir = absolutePath.slice(0, absolutePath.lastIndexOf("/"));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const writeStart = Date.now();
  await writeFile(absolutePath, Buffer.from(outcome.imageB64, "base64"));
  console.log(`[generate]   ✓ wrote ${relativePath} in ${Date.now() - writeStart}ms`);

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
  console.log(`[generate] ✓ done · id=${generation.id} · total=${outcome.totalDurationMs}ms`);

  return { generation, driver: outcome };
}

/**
 * Wrap `generate` for async jobs: updates the jobs row through the lifecycle
 * (running → succeeded/failed) and never throws — callers fire and forget.
 */
export async function runGenerationJob(
  jobId: string,
  input: GenerateInput,
): Promise<void> {
  markJobRunning(jobId);
  console.log(`[job] ▶ running ${jobId}`);
  try {
    const outcome = await generate(input);
    updateJobAttempts(jobId, outcome.driver.attempts);
    markJobSucceeded(jobId, outcome.generation.id);
    console.log(`[job] ✓ ${jobId} succeeded (generation=${outcome.generation.id})`);
  } catch (err) {
    if (err instanceof ImageGenError) {
      markJobFailed(jobId, err.code, err.message, err.attempts ?? []);
      console.log(`[job] ✗ ${jobId} failed: ${err.code} — ${err.message}`);
    } else {
      const msg = err instanceof Error ? err.message : String(err);
      markJobFailed(jobId, "internal", msg);
      console.log(`[job] ✗ ${jobId} failed: internal — ${msg}`);
    }
  }
}

/**
 * Resolve a wire-format ReferenceImage into the buffer/mimetype shape the
 * driver expects. For `generation` mode, reads the file from disk; for
 * `upload` mode, base64-decodes the payload.
 */
async function resolveReferenceImage(
  ref: ReferenceImage,
): Promise<NonNullable<ImageGenInput["referenceImage"]>> {
  if (ref.kind === "generation") {
    const gen = getGeneration(ref.generationId);
    if (!gen) {
      throw new Error(`reference generation not found: ${ref.generationId}`);
    }
    const buffer = readImageBytes(gen.imagePath);
    const mimeType =
      gen.imageFormat === "jpeg"
        ? "image/jpeg"
        : gen.imageFormat === "webp"
          ? "image/webp"
          : "image/png";
    return { buffer, mimeType, filename: `reference.${gen.imageFormat}` };
  }
  // upload
  const buffer = Buffer.from(ref.dataBase64, "base64");
  const ext =
    ref.mimeType === "image/jpeg"
      ? "jpg"
      : ref.mimeType === "image/webp"
        ? "webp"
        : "png";
  return { buffer, mimeType: ref.mimeType, filename: `reference.${ext}` };
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
