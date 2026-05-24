import { writeFile } from "node:fs/promises";
import { mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import type { ImageFormat, ImagePrompt, ReferenceImage } from "@inkast/shared";
import { MAX_REFERENCE_IMAGES } from "@inkast/shared";

/**
 * Reference-image normalization tuning. Empirically the anyrouter proxy RSTs
 * the socket at ~300s when the request body exceeds ~200KB total, well before
 * upstream ever processes it. With 6 references that means each compressed
 * image must stay below ~25KB raw (~33KB base64-inflated) — so we cap the
 * long side and re-encode to webp at a moderate quality.
 *
 * Trade-off: 384px max side keeps faces / silhouettes recognizable for a
 * gpt-image-style model while bringing typical card-art / portrait sources
 * (1024+ px) down to 10-15KB. 256/q50 was smaller but lost too much detail
 * for the model to read the reference. 384/q60 is the empirically-derived
 * sweet spot for the IronMan card test set.
 */
const REF_MAX_DIMENSION = 384;
const REF_WEBP_QUALITY = 60;
import {
  ImageGenError,
  type ImageGenInput,
  type ImageGenOutcome,
} from "../../drivers/image/types.js";
import { driveWithRewriteFallback } from "./with-rewrite.js";
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
  /** Requested output format; actual on-disk format is decided by magic-number sniff. */
  format?: ImageFormat;
  bypassModeration?: boolean;
  signal?: AbortSignal;
  /** Bypass the structured-prompt JSON.stringify path; feed this text directly. */
  rawPrompt?: string;
  /** Reference images (Gallery generations or fresh uploads). */
  referenceImages?: ReferenceImage[];
  /** Original prose the user typed in the composer (persisted on the row). */
  prose?: string | null;
  /** Field names supplied by the LLM expansion (persisted on the row). */
  aiFilledFields?: string[] | null;
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
  const originalPromptText = input.rawPrompt ?? JSON.stringify(input.prompt);
  const mode = input.rawPrompt ? "raw-prose" : "structured-json";
  const rawRefs = input.referenceImages ?? [];
  if (rawRefs.length > MAX_REFERENCE_IMAGES) {
    throw new ImageGenError(
      "unknown",
      `too many reference images (${rawRefs.length} > ${MAX_REFERENCE_IMAGES})`,
    );
  }
  const referenceImages = rawRefs.length > 0
    ? await Promise.all(rawRefs.map(resolveReferenceImage))
    : undefined;
  console.log(
    `[generate] ▶ start · mode=${mode} · prompt-bytes=${originalPromptText.length}${referenceImages ? ` · refs=${referenceImages.length}` : ""}`,
  );

  const outcome = await driveWithRewriteFallback({
    promptText: originalPromptText,
    size: input.size,
    quality: input.quality,
    format: input.format,
    bypassModeration: input.bypassModeration,
    signal: input.signal,
    referenceImages,
  });
  const promptText =
    outcome.rewrittenPromptHistory.length > 0
      ? outcome.rewrittenPromptHistory[outcome.rewrittenPromptHistory.length - 1]!
      : originalPromptText;

  // Decode once; sniff the real format from magic numbers rather than trust
  // the driver/provider. Third-party OpenAI-compatible proxies frequently
  // ignore `output_format` and return PNG bytes anyway — we'd rather store
  // an honest extension than a misleading one.
  const bytes = Buffer.from(outcome.imageB64, "base64");
  const actualFormat = sniffImageFormat(bytes);
  if (input.format && actualFormat !== input.format) {
    console.log(
      `[generate]   ⚠ provider returned ${actualFormat} despite request for ${input.format}`,
    );
  }
  const { relativePath, absolutePath } = imagePathFor(actualFormat);
  const dir = absolutePath.slice(0, absolutePath.lastIndexOf("/"));
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const writeStart = Date.now();
  await writeFile(absolutePath, bytes);
  console.log(`[generate]   ✓ wrote ${relativePath} in ${Date.now() - writeStart}ms`);

  const generation = createGeneration({
    promptSnapshot: input.prompt,
    promptText,
    imagePath: relativePath,
    imageFormat: actualFormat,
    size: input.size ?? "1024x1024",
    quality: input.quality ?? "high",
    providerId: outcome.providerId,
    durationMs: outcome.totalDurationMs,
    prose: input.prose ?? null,
    aiFilledFields: input.aiFilledFields ?? null,
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
    markJobSucceeded(
      jobId,
      outcome.generation.id,
      outcome.driver.providerId,
      outcome.driver.providerName,
    );
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
 *
 * Critically: ALL references are re-compressed via sharp before reaching the
 * driver. The anyrouter proxy RSTs at ~300s for request bodies > ~200KB
 * (see REF_MAX_DIMENSION comment) — a 6-ref request with 80KB-each WebP
 * inputs gets to ~600KB base64 and never makes it past the proxy queue.
 * Down-scaling to 384px/q60 brings typical sources to 10-15KB so 6 of them
 * fit comfortably under the body-size ceiling.
 */
async function resolveReferenceImage(
  ref: ReferenceImage,
): Promise<NonNullable<ImageGenInput["referenceImages"]>[number]> {
  let raw: Buffer;
  if (ref.kind === "generation") {
    const gen = getGeneration(ref.generationId);
    if (!gen) {
      throw new Error(`reference generation not found: ${ref.generationId}`);
    }
    raw = readImageBytes(gen.imagePath);
  } else {
    raw = Buffer.from(ref.dataBase64, "base64");
  }
  return await normalizeReferenceImage(raw);
}

/**
 * Re-encode any input image (PNG / JPEG / WEBP / GIF) into a small webp
 * sized for the upstream proxy's body-limit window. Logs the before/after
 * sizes so operators can spot regressions if the compression ratio changes.
 */
async function normalizeReferenceImage(
  rawBuffer: Buffer,
): Promise<NonNullable<ImageGenInput["referenceImages"]>[number]> {
  const startBytes = rawBuffer.length;
  const compressed = await sharp(rawBuffer)
    .resize({
      width: REF_MAX_DIMENSION,
      height: REF_MAX_DIMENSION,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: REF_WEBP_QUALITY })
    .toBuffer();
  console.log(
    `[generate]   ref compressed: ${startBytes}B → ${compressed.length}B (${((compressed.length / startBytes) * 100).toFixed(0)}%)`,
  );
  return {
    buffer: compressed,
    mimeType: "image/webp",
    filename: "reference.webp",
  };
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

/**
 * Identify image bytes by magic number. Falls back to "png" for unknown bytes
 * so we never crash, but the operator log line catches mismatches.
 */
function sniffImageFormat(buf: Buffer): ImageFormat {
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return "png";
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "jpeg";
  }
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return "webp";
  }
  return "png";
}

export { ImageGenError };
