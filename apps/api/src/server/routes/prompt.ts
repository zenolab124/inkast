import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { DraftPromptRequest } from "@inkast/shared";
import { draftPrompt } from "../../domain/prompt-engine/index.js";
import { LlmDriverError } from "../../drivers/llm/index.js";

export const promptRoutes = new Hono();

promptRoutes.post("/draft-prompt", async c => {
  let body: DraftPromptRequest;
  try {
    body = (await c.req.json()) as DraftPromptRequest;
  } catch {
    throw new HTTPException(400, { message: "invalid JSON body" });
  }

  if (typeof body.input !== "string" || !body.input.trim()) {
    throw new HTTPException(400, { message: "'input' must be a non-empty string" });
  }

  try {
    const outcome = await draftPrompt(body);
    return c.json({
      ...outcome.draft,
      _meta: {
        backend: outcome.backend,
        durationMs: outcome.durationMs,
      },
    });
  } catch (err) {
    if (err instanceof LlmDriverError) {
      const status: 401 | 429 | 504 | 502 =
        err.code === "not_authenticated" ? 401
        : err.code === "rate_limited"    ? 429
        : err.code === "timeout"         ? 504
        : 502;
      throw new HTTPException(status, { message: `${err.code}: ${err.message}` });
    }
    throw err;
  }
});
