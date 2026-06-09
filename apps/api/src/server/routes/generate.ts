import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ImagePrompt } from "@inkast/shared";
import { generate, readImageBytes, ImageGenError } from "../../domain/generate/index.js";
import { getGeneration, listGenerations } from "../../storage/generations.js";

export const generateRoutes = new Hono();

interface GenerateBody {
  prompt: ImagePrompt;
  size?: "1024x1024" | "1024x1536" | "1536x1024";
  quality?: "low" | "medium" | "high";
  bypassModeration?: boolean;
  rawPrompt?: string;
}

generateRoutes.post("/generate-image", async c => {
  let body: GenerateBody;
  try {
    body = (await c.req.json()) as GenerateBody;
  } catch {
    throw new HTTPException(400, { message: "invalid JSON body" });
  }
  if (!body.prompt || typeof body.prompt !== "object") {
    throw new HTTPException(400, { message: "'prompt' must be an object" });
  }
  if (body.rawPrompt !== undefined && (typeof body.rawPrompt !== "string" || !body.rawPrompt.trim())) {
    throw new HTTPException(400, { message: "'rawPrompt' must be a non-empty string when provided" });
  }

  const routeStart = Date.now();
  console.log(`[route] POST /api/generate-image received`);

  try {
    const outcome = await generate({
      prompt: body.prompt,
      size: body.size,
      quality: body.quality,
      bypassModeration: body.bypassModeration,
      rawPrompt: body.rawPrompt,
    });
    console.log(`[route] ◀ responding to client (route total=${Date.now() - routeStart}ms)`);
    return c.json({
      generation: outcome.generation,
      driver: {
        providerName: outcome.driver.providerName,
        providerId: outcome.driver.providerId,
        attempts: outcome.driver.attempts,
        totalDurationMs: outcome.driver.totalDurationMs,
      },
    });
  } catch (err) {
    if (err instanceof ImageGenError) {
      console.error(
        "[generate] failed:",
        err.code,
        err.message,
        "\n  attempts:",
        JSON.stringify(err.attempts, null, 2),
      );
      const status: 400 | 404 | 502 =
        err.code === "no_providers"        ? 400
        : err.code === "moderation_rejected" ? 400
        : 502;
      return c.json(
        {
          error: err.code,
          message: err.message,
          attempts: err.attempts,
        },
        status,
      );
    }
    throw err;
  }
});

generateRoutes.get("/generations", c => {
  const limit = Number(c.req.query("limit") ?? 100);
  return c.json({ generations: listGenerations(Math.min(Math.max(limit, 1), 500)) });
});

generateRoutes.get("/generations/:id/image", c => {
  const id = c.req.param("id");
  const gen = getGeneration(id);
  if (!gen) throw new HTTPException(404, { message: `generation ${id} not found` });
  // R2-enabled rows carry a public URL — bounce the browser straight to the
  // CDN so the image bytes never traverse jdc's 5Mbps uplink. Local-only rows
  // (dev / pre-R2 historical) fall through to the on-disk serve below.
  if (gen.imageUrl) return c.redirect(gen.imageUrl, 302);
  try {
    const bytes = readImageBytes(gen.imagePath);
    const mime = gen.imageFormat === "jpeg" ? "image/jpeg"
      : gen.imageFormat === "webp" ? "image/webp"
      : "image/png";
    return c.body(bytes as unknown as ArrayBuffer, 200, {
      "Content-Type": mime,
      "Cache-Control": "private, max-age=31536000, immutable",
    });
  } catch {
    throw new HTTPException(410, { message: "image file missing on disk" });
  }
});
