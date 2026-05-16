import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type {
  DraftPromptRequest,
  LlmBackendDescriptor,
  WarmupRequest,
} from "@inkast/shared";
import { draftPrompt } from "../../domain/prompt-engine/index.js";
import { getLlmDriver, LlmDriverError } from "../../drivers/llm/index.js";

export const promptRoutes = new Hono();

/**
 * Validate and normalize an untrusted `backend` value into LlmBackendDescriptor.
 * Throws HTTPException(400) on malformed input.
 */
function parseBackend(raw: unknown): LlmBackendDescriptor | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (raw === "claude-code") return "claude-code";
  if (typeof raw === "object" && raw !== null) {
    const obj = raw as { kind?: string; providerId?: string };
    if (obj.kind === "openai-compatible" && typeof obj.providerId === "string" && obj.providerId.trim()) {
      return { kind: "openai-compatible", providerId: obj.providerId };
    }
  }
  throw new HTTPException(400, {
    message: "invalid 'backend' — expected 'claude-code' or { kind: 'openai-compatible', providerId }",
  });
}

function statusFromLlmError(code: LlmDriverError["code"]): 401 | 429 | 504 | 502 {
  if (code === "not_authenticated") return 401;
  if (code === "rate_limited") return 429;
  if (code === "timeout") return 504;
  return 502;
}

promptRoutes.post("/llm/warmup", async c => {
  let body: WarmupRequest = {};
  try {
    body = (await c.req.json()) as WarmupRequest;
  } catch {
    // empty body is fine — warm the default driver
  }
  const backend = parseBackend(body.backend);

  try {
    const result = await getLlmDriver(backend).warmup();
    return c.json(result);
  } catch (err) {
    if (err instanceof LlmDriverError) {
      throw new HTTPException(statusFromLlmError(err.code), {
        message: `${err.code}: ${err.message}`,
      });
    }
    throw err;
  }
});

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

  if (body.lang !== undefined && body.lang !== "zh" && body.lang !== "en") {
    throw new HTTPException(400, { message: "'lang' must be 'zh' or 'en'" });
  }

  const backend = parseBackend(body.backend);

  try {
    const outcome = await draftPrompt({ ...body, backend });
    return c.json({
      ...outcome.draft,
      _meta: {
        backend: outcome.backend,
        durationMs: outcome.durationMs,
      },
    });
  } catch (err) {
    if (err instanceof LlmDriverError) {
      throw new HTTPException(statusFromLlmError(err.code), {
        message: `${err.code}: ${err.message}`,
      });
    }
    throw err;
  }
});
