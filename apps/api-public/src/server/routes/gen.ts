import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import {
  PassthroughError,
  passthroughGenerate,
} from "../../drivers/passthrough-image.js";
import {
  createGenTask,
  markGenTaskFailed,
  markGenTaskSuccess,
} from "../../storage/gen-tasks.js";
import { requireAuth } from "../middleware/auth.js";

export const genRoutes = new Hono();

interface PassthroughBody {
  provider?: {
    baseUrl?: string;
    apiKey?: string;
    model?: string;
    useCodexHeader?: boolean;
  };
  prompt?: string;
  options?: {
    size?: string;
    n?: number;
  };
}

/**
 * 透明代理生图。流程:
 *   1. 鉴权(session cookie),拿到 user
 *   2. 校验入参(provider 三件套 + prompt)
 *   3. 写 gen_tasks(channel='passthrough', cost=0, status='pending')
 *      ——prompt + options 留痕,**provider 凭据不进 DB**
 *   4. 调 driver,b64 透传回前端
 *   5. mark task success/failed
 *
 * 用户自带 key,这里**不**扣公开版余额(cost=0)。失败也不扣。
 */
genRoutes.post("/gen/passthrough", requireAuth, async c => {
  const body = (await c.req.json().catch(() => null)) as PassthroughBody | null;
  if (!body) return c.json({ error: "invalid_body" }, 400);

  const provider = body.provider;
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (
    !provider ||
    typeof provider.baseUrl !== "string" ||
    typeof provider.apiKey !== "string" ||
    typeof provider.model !== "string" ||
    !provider.baseUrl ||
    !provider.apiKey ||
    !provider.model
  ) {
    return c.json(
      { error: "missing_provider", message: "provider.baseUrl/apiKey/model 必填" },
      400,
    );
  }
  if (!prompt) return c.json({ error: "missing_prompt" }, 400);

  const user = c.get("user");
  const taskId = randomUUID();

  // 记元数据(凭据不存)
  createGenTask({
    id: taskId,
    userId: user.id,
    promptJson: JSON.stringify({ prompt, options: body.options ?? {} }),
    channel: "passthrough",
    model: provider.model,
    cost: 0,
  });

  try {
    const result = await passthroughGenerate({
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      model: provider.model,
      prompt,
      size: body.options?.size,
      n: body.options?.n,
      useCodexHeader: provider.useCodexHeader === true,
      signal: c.req.raw.signal,
    });
    // Phase 1 透明代理直接返 b64;task 8 接 R2 后改成返 R2 URL。
    markGenTaskSuccess(taskId, `b64:passthrough:${result.b64Images.length}`);
    return c.json({
      ok: true,
      task_id: taskId,
      model: result.model,
      images_b64: result.b64Images,
      duration_ms: result.durationMs,
    });
  } catch (err) {
    if (err instanceof PassthroughError) {
      markGenTaskFailed(taskId, err.upstreamCode ?? "upstream_error");
      const status =
        err.upstreamStatus !== null && err.upstreamStatus >= 400 && err.upstreamStatus < 600
          ? err.upstreamStatus
          : 502;
      return c.json(
        {
          error: err.upstreamCode ?? "upstream_error",
          message: err.message,
          upstream_status: err.upstreamStatus,
          task_id: taskId,
        },
        status as 400 | 401 | 402 | 403 | 404 | 429 | 500 | 502 | 503,
      );
    }
    markGenTaskFailed(taskId, "internal_error");
    throw err;
  }
});
