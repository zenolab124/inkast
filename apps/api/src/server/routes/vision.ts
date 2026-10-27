import { Hono } from "hono";
import { z } from "zod";
import { analyzeVision, VisionRequestError, VISION_MAX_BODY_BYTES } from "../../domain/vision/index.js";
import { LlmDriverError } from "../../drivers/llm/types.js";
import { visionJobRunner, publicVisionJob } from "../../domain/vision/jobs.js";
import { VisionJobError } from "../../storage/vision-jobs.js";

async function readBody(request: Request): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (request.body) for await (const chunk of request.body) {
    size += chunk.length;
    if (size > VISION_MAX_BODY_BYTES) throw new VisionRequestError("body_too_large", 413, "Request is too large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const inputSchema = z.object({
  images: z.array(z.object({ url: z.string().min(1) }).strict()).min(1).max(6),
  context: z.record(z.string(), z.unknown()).optional(),
}).strict();

/** Mounted below pluginAuth. The caller cannot inject schemas, prompts, models or providers. */
export function createVisionRoutes(analyze: typeof analyzeVision = analyzeVision, jobs = visionJobRunner): Hono {
  const routes = new Hono();
  routes.onError((error, c) => {
    if (error instanceof VisionRequestError || error instanceof VisionJobError) return c.json({ error: { code: error.code } }, error.status);
    if (error instanceof z.ZodError || error instanceof SyntaxError) return c.json({ error: { code: "invalid_input" } }, 400);
    return c.json({ error: { code: "vision_unavailable" } }, 503);
  });
  routes.post("/tasks/:task", async c => {
    if (!c.req.header("content-type")?.startsWith("application/json")) return c.json({ error: { code: "invalid_request" } }, 415);
    const { request_id, ...input } = inputSchema.extend({ request_id: z.string().regex(/^vision-[a-f0-9]{64}$/) }).strict().parse(await readBody(c.req.raw));
    const job = await jobs().submit(c.get("plugin"), request_id, c.req.param("task"), input);
    return c.json(publicVisionJob(job), 202);
  });
  routes.get("/tasks/:id", c => {
    const id = z.string().regex(/^vision-[a-f0-9]{64}$/).parse(c.req.param("id"));
    const job = jobs().store.get(c.get("plugin").id, id);
    if (!job) return c.json({ error: { code: "vision_task_not_found" } }, 404);
    return c.json(publicVisionJob(job));
  });
  routes.post("/:task", async c => {
    try {
      if (!c.req.header("content-type")?.startsWith("application/json")) {
        return c.json({ error: { code: "invalid_request", message: "JSON required" } }, 415);
      }
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      if (c.req.raw.body) {
        for await (const chunk of c.req.raw.body) {
          bytes += chunk.length;
          if (bytes > VISION_MAX_BODY_BYTES) throw new VisionRequestError("body_too_large", 413, "Request is too large");
          chunks.push(chunk);
        }
      }
      let payload: unknown;
      try { payload = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch {
        return c.json({ error: { code: "invalid_request", message: "Invalid JSON" } }, 400);
      }
      const input = inputSchema.safeParse(payload);
      if (!input.success) return c.json({ error: { code: "invalid_request", message: "Invalid vision input" } }, 400);
      const result = await analyze(c.get("plugin"), c.req.param("task"), input.data, c.req.raw.signal);
      return c.json({
        data: result.data,
        duration_ms: result.durationMs,
        attempts: result.attempts ?? (result.receipt ? [result.receipt] : []),
      });
    } catch (error) {
      if (error instanceof VisionRequestError) {
        if (error.status === 429) c.header("Retry-After", "5");
        return c.json({ error: { code: error.code, message: error.message } }, error.status);
      }
      const timeout = error instanceof LlmDriverError && ["timeout", "aborted"].includes(error.code);
      return c.json({
        error: { code: timeout ? "vision_timeout" : "vision_unavailable", message: "Vision analysis did not complete" },
        attempts: error instanceof LlmDriverError ? error.attempts ?? (error.receipt ? [error.receipt] : []) : [],
      }, timeout ? 504 : 503);
    }
  });
  return routes;
}
