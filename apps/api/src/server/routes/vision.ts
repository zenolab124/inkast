import { Hono } from "hono";
import { z } from "zod";
import { analyzeVision, VisionRequestError, VISION_MAX_BODY_BYTES } from "../../domain/vision/index.js";
import { LlmDriverError } from "../../drivers/llm/types.js";

const inputSchema = z.object({
  images: z.array(z.object({ url: z.string().min(1) }).strict()).min(1).max(6),
  context: z.record(z.string(), z.unknown()).optional(),
}).strict();

/** Mounted below pluginAuth. The caller cannot inject schemas, prompts, models or providers. */
export function createVisionRoutes(analyze: typeof analyzeVision = analyzeVision): Hono {
  const routes = new Hono();
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
