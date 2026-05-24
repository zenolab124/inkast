import { Hono } from "hono";
import { submitForPlugin } from "../../domain/plugin-async/index.js";
import type { PipelinePolicy } from "../../domain/plugin-async/index.js";
import { getPluginTask } from "../../storage/plugin-tasks.js";
import { pluginAuth } from "../middleware/plugin-auth.js";

export const pluginRoutes = new Hono();

pluginRoutes.use("*", pluginAuth);

const PROMPT_MIN_LEN = 2;
const PROMPT_MAX_LEN = 2000;
const CALLBACK_TOKEN_MIN_LEN = 16;
const CALLBACK_URL_MAX_LEN = 2048;

/**
 * POST /plugins/v1/images/submit
 *
 * v2 异步协议。立即返 task_id,inkast 后台跑完后回调 callback_url。
 * 详见 inkast-integration.md v2。
 */
pluginRoutes.post("/v1/images/submit", async c => {
  const plugin = c.get("plugin");

  let body: { prompt?: unknown; callback_url?: unknown; callback_token?: unknown };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json(
      errBody("invalid_request", "invalid JSON body", "invalid_request_error"),
      400,
    );
  }

  // prompt
  if (typeof body.prompt !== "string") {
    return c.json(
      errBody("invalid_request", "'prompt' must be a string", "invalid_request_error"),
      400,
    );
  }
  const prompt = body.prompt.trim();
  if (prompt.length < PROMPT_MIN_LEN) {
    return c.json(
      errBody(
        "prompt_too_short",
        `'prompt' must be at least ${PROMPT_MIN_LEN} characters`,
        "invalid_request_error",
      ),
      400,
    );
  }
  if (prompt.length > PROMPT_MAX_LEN) {
    return c.json(
      errBody(
        "prompt_too_long",
        `'prompt' must be at most ${PROMPT_MAX_LEN} characters`,
        "invalid_request_error",
      ),
      400,
    );
  }

  // callback_url
  if (typeof body.callback_url !== "string" || !body.callback_url) {
    return c.json(
      errBody("invalid_request", "'callback_url' is required", "invalid_request_error"),
      400,
    );
  }
  if (body.callback_url.length > CALLBACK_URL_MAX_LEN) {
    return c.json(
      errBody("invalid_request", "'callback_url' too long", "invalid_request_error"),
      400,
    );
  }
  let callbackUrl: URL;
  try {
    callbackUrl = new URL(body.callback_url);
  } catch {
    return c.json(
      errBody("invalid_request", "'callback_url' is not a valid URL", "invalid_request_error"),
      400,
    );
  }
  if (callbackUrl.protocol !== "https:" && callbackUrl.protocol !== "http:") {
    return c.json(
      errBody(
        "invalid_request",
        "'callback_url' must be http(s)",
        "invalid_request_error",
      ),
      400,
    );
  }

  // callback_token
  if (typeof body.callback_token !== "string" || body.callback_token.length < CALLBACK_TOKEN_MIN_LEN) {
    return c.json(
      errBody(
        "invalid_request",
        `'callback_token' must be at least ${CALLBACK_TOKEN_MIN_LEN} characters`,
        "invalid_request_error",
      ),
      400,
    );
  }

  // pipeline_policy — optional caller control over the rewrite chain + post-
  // review edit step. All sub-fields are optional and default to the legacy
  // behavior (run round 0, allow up to round 3, no post-review). See
  // domain/generate/with-rewrite.ts for round semantics.
  const policyInput = (body as { pipeline_policy?: unknown }).pipeline_policy;
  const policy = parsePipelinePolicy(policyInput);
  if (policy === "invalid") {
    return c.json(
      errBody(
        "invalid_request",
        "'pipeline_policy' must be an object with optional fields: skip_original (bool), max_round (0|1|2|3), post_review_edit (bool)",
        "invalid_request_error",
      ),
      400,
    );
  }

  const task = submitForPlugin({
    plugin,
    prompt,
    callbackUrl: body.callback_url,
    callbackToken: body.callback_token,
    pipelinePolicy: policy,
  });

  return c.json({
    task_id: task.id,
    status: "queued",
    created_at: Math.floor(task.createdAt / 1000),
  });
});

/**
 * GET /plugins/v1/images/status/:id
 *
 * Fallback poll. Normal path is callback push; this is for when the caller
 * suspects a callback was lost. Returns current state — succeeded includes
 * the b64_json payload (so caller can recover even if callback never made
 * it through retries).
 *
 * Caller is also scoped: only the plugin that owns the task can read it.
 * Cross-plugin reads return 404 (not 403 — don't leak existence).
 */
pluginRoutes.get("/v1/images/status/:id", c => {
  const plugin = c.get("plugin");
  const id = c.req.param("id");
  const task = getPluginTask(id);
  if (!task || task.pluginId !== plugin.id) {
    return c.json(
      errBody(
        "not_found",
        `task ${id} not found (may have expired after 24h)`,
        "invalid_request_error",
      ),
      404,
    );
  }

  const completedAt = task.completedAt ? Math.floor(task.completedAt / 1000) : undefined;

  // succeeded — or callback_lost (which still has the image, callback delivery
  // just failed). Both surface to the caller as a successful payload.
  // Payload shape depends on plugin's imageStorage.kind:
  //   - "r2": image_url + mime (v2.1 protocol)
  //   - "b64": b64_json + mime (v2 protocol)
  if (task.status === "succeeded" || task.status === "callback_lost") {
    if (task.imageUrl && task.mime) {
      return c.json({
        task_id: task.id,
        status: "succeeded",
        image_url: task.imageUrl,
        mime: task.mime,
        prompt_json: task.promptJson ? safeParseJson(task.promptJson) : undefined,
        completed_at: completedAt,
      });
    }
    if (task.b64Json && task.mime) {
      return c.json({
        task_id: task.id,
        status: "succeeded",
        b64_json: task.b64Json,
        mime: task.mime,
        prompt_json: task.promptJson ? safeParseJson(task.promptJson) : undefined,
        completed_at: completedAt,
      });
    }
  }

  // failed (no image)
  if (task.status === "failed") {
    return c.json({
      task_id: task.id,
      status: "failed",
      error_code: task.errorCode ?? "internal_error",
      error_msg: task.errorMsg ?? "(no error message)",
      completed_at: completedAt,
    });
  }

  // still in flight
  return c.json({
    task_id: task.id,
    status: task.status,    // queued | running
  });
});

function errBody(code: string, message: string, type: string) {
  return { error: { code, message, type } };
}

/**
 * Validate the caller-supplied pipeline_policy object. Returns:
 *   - `undefined` if the field wasn't provided at all (use defaults)
 *   - a validated PipelinePolicy on success
 *   - `"invalid"` literal if any sub-field is malformed → 400 to caller
 *
 * All sub-fields are optional; the helper just rejects type-mismatches.
 * Default semantics live in domain/generate/with-rewrite.ts (skip_original
 * defaults to false, max_round to 3, post_review_edit to false).
 */
function parsePipelinePolicy(
  raw: unknown,
): PipelinePolicy | undefined | "invalid" {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object") return "invalid";
  const r = raw as Record<string, unknown>;
  const out: PipelinePolicy = {};
  if (r.skip_original !== undefined) {
    if (typeof r.skip_original !== "boolean") return "invalid";
    out.skipOriginal = r.skip_original;
  }
  if (r.max_round !== undefined) {
    if (
      typeof r.max_round !== "number" ||
      !Number.isInteger(r.max_round) ||
      r.max_round < 0 ||
      r.max_round > 3
    ) {
      return "invalid";
    }
    out.maxRound = r.max_round as 0 | 1 | 2 | 3;
  }
  if (r.post_review_edit !== undefined) {
    if (typeof r.post_review_edit !== "boolean") return "invalid";
    out.postReviewEdit = r.post_review_edit;
  }
  return out;
}

function safeParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
