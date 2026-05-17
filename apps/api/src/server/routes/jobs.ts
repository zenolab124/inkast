import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ImageFormat, ImagePrompt, JobStatus, ReferenceImage } from "@inkast/shared";
import { MAX_REFERENCE_IMAGES, isImageFormat } from "@inkast/shared";
import { runGenerationJob } from "../../domain/generate/index.js";
import { createJob, getJob, listJobs } from "../../storage/jobs.js";

export const jobsRoutes = new Hono();

interface SubmitBody {
  prompt: ImagePrompt;
  /** "<width>x<height>" — typed loosely so the upstream model validates. */
  size?: string;
  quality?: "low" | "medium" | "high";
  /** Requested output format. Actual stored format follows magic-number sniff. */
  format?: ImageFormat;
  bypassModeration?: boolean;
  rawPrompt?: string;
  referenceImages?: ReferenceImage[];
  prose?: string;
  aiFilledFields?: string[];
}

const SIZE_RE = /^(\d{2,4})x(\d{2,4})$/;
const RATIO_RE = /^ratio:(\d{1,3}):(\d{1,3})$/;
/**
 * Surface-level shape check. Accepts:
 *   - "auto" — sentinel that tells the driver to omit `size` entirely so the
 *     upstream model picks freely (OpenAI gpt-image-2 default).
 *   - "ratio:<W>:<H>" — Inkast-private wire form for "lock aspect, free
 *     pixels". Drivers translate this either by dropping `size` (images
 *     endpoint) or by embedding the ratio as a prompt hint (responses
 *     endpoint). See SIZE_RATIO_PREFIX in @inkast/shared.
 *   - "<W>x<H>" — concrete pixels. We only verify the format and a sane
 *     dimension range; the actual list of supported sizes varies by provider,
 *     so the upstream returns the real verdict.
 */
function validateSize(s: string): void {
  if (s === "auto") return;
  const ratioMatch = RATIO_RE.exec(s);
  if (ratioMatch) {
    const w = Number(ratioMatch[1]);
    const h = Number(ratioMatch[2]);
    if (w < 1 || h < 1) {
      throw new HTTPException(400, {
        message: "'size' ratio parts must be >= 1 (e.g. ratio:9:16)",
      });
    }
    return;
  }
  const m = SIZE_RE.exec(s);
  if (!m) {
    throw new HTTPException(400, {
      message:
        "'size' must be 'auto', 'ratio:<W>:<H>', or '<width>x<height>' (e.g. 1024x1024)",
    });
  }
  const [, wStr, hStr] = m;
  const w = Number(wStr);
  const h = Number(hStr);
  if (w < 64 || w > 4096 || h < 64 || h > 4096) {
    throw new HTTPException(400, {
      message: "'size' width and height must be between 64 and 4096",
    });
  }
}

function validateReferenceImage(
  ref: unknown,
  idx: number,
): asserts ref is ReferenceImage {
  const path = `referenceImages[${idx}]`;
  if (typeof ref !== "object" || ref === null) {
    throw new HTTPException(400, { message: `'${path}' must be an object` });
  }
  const r = ref as Record<string, unknown>;
  if (r.kind === "generation") {
    if (typeof r.generationId !== "string" || !r.generationId) {
      throw new HTTPException(400, {
        message: `'${path}.generationId' required for kind=generation`,
      });
    }
  } else if (r.kind === "upload") {
    if (typeof r.mimeType !== "string" || !r.mimeType.startsWith("image/")) {
      throw new HTTPException(400, {
        message: `'${path}.mimeType' must be image/*`,
      });
    }
    if (typeof r.dataBase64 !== "string" || r.dataBase64.length < 100) {
      throw new HTTPException(400, {
        message: `'${path}.dataBase64' missing or too short`,
      });
    }
  } else {
    throw new HTTPException(400, {
      message: `'${path}.kind' must be 'generation' or 'upload'`,
    });
  }
}

function validateReferenceImages(
  refs: unknown,
): asserts refs is ReferenceImage[] {
  if (!Array.isArray(refs)) {
    throw new HTTPException(400, { message: "'referenceImages' must be an array" });
  }
  if (refs.length > MAX_REFERENCE_IMAGES) {
    throw new HTTPException(400, {
      message: `'referenceImages' length ${refs.length} exceeds cap ${MAX_REFERENCE_IMAGES}`,
    });
  }
  refs.forEach(validateReferenceImage);
}

const VALID_STATUSES: ReadonlySet<JobStatus> = new Set([
  "pending",
  "running",
  "succeeded",
  "failed",
]);

jobsRoutes.post("/jobs/generate", async c => {
  let body: SubmitBody;
  try {
    body = (await c.req.json()) as SubmitBody;
  } catch {
    throw new HTTPException(400, { message: "invalid JSON body" });
  }
  if (!body.prompt || typeof body.prompt !== "object") {
    throw new HTTPException(400, { message: "'prompt' must be an object" });
  }
  if (
    body.rawPrompt !== undefined &&
    (typeof body.rawPrompt !== "string" || !body.rawPrompt.trim())
  ) {
    throw new HTTPException(400, {
      message: "'rawPrompt' must be a non-empty string when provided",
    });
  }
  if (body.referenceImages !== undefined) {
    validateReferenceImages(body.referenceImages);
  }
  if (
    body.aiFilledFields !== undefined &&
    (!Array.isArray(body.aiFilledFields) ||
      body.aiFilledFields.some(s => typeof s !== "string"))
  ) {
    throw new HTTPException(400, {
      message: "'aiFilledFields' must be an array of strings",
    });
  }
  if (body.size !== undefined) {
    if (typeof body.size !== "string") {
      throw new HTTPException(400, { message: "'size' must be a string" });
    }
    validateSize(body.size);
  }
  if (body.format !== undefined && !isImageFormat(body.format)) {
    throw new HTTPException(400, {
      message: "'format' must be one of 'png' / 'jpeg' / 'webp'",
    });
  }

  const isRaw = body.rawPrompt !== undefined;
  const promptText = body.rawPrompt ?? JSON.stringify(body.prompt);
  const prose = typeof body.prose === "string" && body.prose.length > 0
    ? body.prose
    : null;
  const aiFilledFields = body.aiFilledFields && body.aiFilledFields.length > 0
    ? body.aiFilledFields
    : null;
  const job = createJob({
    promptSnapshot: body.prompt,
    promptText,
    isRaw,
    size: body.size ?? "1024x1024",
    quality: body.quality ?? "high",
    prose,
    aiFilledFields,
  });
  const refCount = body.referenceImages?.length ?? 0;
  console.log(
    `[job] ▶ ${job.id} submitted (isRaw=${isRaw} promptBytes=${promptText.length}${refCount > 0 ? ` refs=${refCount}` : ""}${prose ? ` prose=${prose.length}b` : ""}${aiFilledFields ? ` aiFields=${aiFilledFields.length}` : ""})`,
  );

  // Fire and forget — never block the HTTP response on the upstream model.
  runGenerationJob(job.id, {
    prompt: body.prompt,
    size: body.size,
    quality: body.quality,
    format: body.format,
    bypassModeration: body.bypassModeration,
    rawPrompt: body.rawPrompt,
    referenceImages: body.referenceImages,
    prose,
    aiFilledFields,
  }).catch(err => {
    console.error(`[job] ${job.id} unhandled error in runner:`, err);
  });

  return c.json({ jobId: job.id, status: job.status });
});

jobsRoutes.get("/jobs", c => {
  const statusParam = c.req.query("status");
  const sinceParam = c.req.query("since");
  const limitParam = c.req.query("limit");

  let statuses: JobStatus[] | undefined;
  if (statusParam) {
    statuses = statusParam.split(",").map(s => s.trim()) as JobStatus[];
    for (const s of statuses) {
      if (!VALID_STATUSES.has(s)) {
        throw new HTTPException(400, { message: `invalid status: ${s}` });
      }
    }
  }
  const sinceMs = sinceParam ? Number(sinceParam) : undefined;
  if (sinceParam && Number.isNaN(sinceMs)) {
    throw new HTTPException(400, { message: "'since' must be a number (ms)" });
  }
  const limit = limitParam
    ? Math.min(Math.max(Number(limitParam) || 50, 1), 200)
    : undefined;

  const jobs = listJobs({ status: statuses, sinceMs, limit });
  return c.json({ jobs });
});

jobsRoutes.get("/jobs/:id", c => {
  const id = c.req.param("id");
  const job = getJob(id);
  if (!job) throw new HTTPException(404, { message: `job ${id} not found` });
  return c.json(job);
});
