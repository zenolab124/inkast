import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import {
  PassthroughError,
  passthroughGenerate,
} from "../../drivers/passthrough-image.js";
import { loadBuiltinConfig } from "../../domain/gen/builtin-config.js";
import { uploadOrFallback } from "../../domain/gen/upload-or-fallback.js";
import {
  InsufficientBalanceError,
  credit,
  debit,
  getBalance,
} from "../../domain/balance/service.js";
import {
  createGenTask,
  markGenTaskFailed,
  markGenTaskSuccess,
} from "../../storage/gen-tasks.js";
import { requireAuth } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rate-limit.js";

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
genRoutes.post(
  "/gen/passthrough",
  requireAuth,
  // 透明代理:用户自己 key,主要防 jdc 转发资源被滥用。IP 维度足够。
  rateLimit({ tag: "gen_pt", window: "minute", ipLimit: 30 }),
  async c => {
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
    const uploaded = await uploadOrFallback({
      b64Images: result.b64Images,
      taskId,
      userId: user.id,
    });
    // gen_tasks.image_url 只存第一张的 URL(多张时其它的从 response 拿)。
    // R2 fallback 走 b64 时 image_url 留空,前端从 response.images[i].b64 取。
    const firstUrl = uploaded[0]?.url ?? null;
    markGenTaskSuccess(taskId, firstUrl ?? `b64:passthrough:${result.b64Images.length}`);
    return c.json({
      ok: true,
      task_id: taskId,
      model: result.model,
      images: uploaded,
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

/**
 * 兜底通道生图。用户没填 provider 时调这条,后端用 env 配的 builtin
 * provider 出图,扣 inkast 内部余额(单位"次")。
 *
 * 流程(saga):
 *   1. 鉴权,加载 builtin config,未配置 → 503
 *   2. 余额校验提前快速失败 → 402
 *   3. 创建 task(pending,cost=N)
 *   4. debit N(事务,余额不足 InsufficientBalanceError → 402)
 *   5. 调 driver
 *      成功 → mark task success
 *      失败 → credit N 回滚(refund:gen)+ mark task failed,返 502
 *
 * 余额变动全部进 balance_ledger,extras 通过 related_id=task_id 关联可对账。
 * 步骤 4-5 不是原子(driver 是异步 HTTP),进程 crash 在中间会留下"扣了没出图"
 * 的孤儿——Phase 1 接受;后续严格做要引 reserved balance。
 */
genRoutes.post(
  "/gen/builtin",
  requireAuth,
  // 兜底通道:花我们的 provider 钱,严点。user 维度防同账号狂调,
  // IP 维度防匿名滥用(虽然 requireAuth 已经挡住未登录,IP 限是双保险)
  rateLimit({ tag: "gen_bi", window: "minute", ipLimit: 20, userLimit: 10 }),
  async c => {
  const cfg = loadBuiltinConfig();
  if (!cfg.enabled) {
    return c.json(
      { error: "builtin_not_configured", message: "服务端未配置 builtin provider" },
      503,
    );
  }

  const body = (await c.req.json().catch(() => null)) as { prompt?: string; options?: { size?: string; n?: number } } | null;
  if (!body) return c.json({ error: "invalid_body" }, 400);
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) return c.json({ error: "missing_prompt" }, 400);

  const user = c.get("user");
  const cost = cfg.costPerImage;

  // 提前余额检查(driver 还没调用前快速 fail,UX 友好)
  const available = getBalance(user.id);
  if (available < cost) {
    return c.json(
      { error: "insufficient_balance", required: cost, available },
      402,
    );
  }

  const taskId = randomUUID();
  createGenTask({
    id: taskId,
    userId: user.id,
    promptJson: JSON.stringify({ prompt, options: body.options ?? {} }),
    channel: "builtin",
    model: cfg.model,
    cost,
  });

  // 扣余额(原子事务;余额不足在这里再抓一次,防并发)
  try {
    debit(user.id, cost, {
      type: "consume:gen",
      reason: "builtin image generate",
      relatedId: taskId,
    });
  } catch (err) {
    if (err instanceof InsufficientBalanceError) {
      markGenTaskFailed(taskId, "insufficient_balance");
      return c.json(
        { error: "insufficient_balance", required: err.required, available: err.available },
        402,
      );
    }
    throw err;
  }

  try {
    const result = await passthroughGenerate({
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      model: cfg.model,
      prompt,
      size: body.options?.size,
      n: body.options?.n,
      useCodexHeader: cfg.useCodexHeader,
      signal: c.req.raw.signal,
    });
    const uploaded = await uploadOrFallback({
      b64Images: result.b64Images,
      taskId,
      userId: user.id,
    });
    const firstUrl = uploaded[0]?.url ?? null;
    markGenTaskSuccess(taskId, firstUrl ?? `b64:builtin:${result.b64Images.length}`);
    return c.json({
      ok: true,
      task_id: taskId,
      model: result.model,
      images: uploaded,
      cost,
      balance_after: getBalance(user.id),
      duration_ms: result.durationMs,
    });
  } catch (err) {
    // 退款,task fail。
    credit(user.id, cost, {
      type: "refund:gen",
      reason: err instanceof PassthroughError ? `gen failed: ${err.message}` : "gen failed",
      relatedId: taskId,
    });
    markGenTaskFailed(
      taskId,
      err instanceof PassthroughError ? (err.upstreamCode ?? "upstream_error") : "internal_error",
    );
    if (err instanceof PassthroughError) {
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
          refunded: cost,
          balance_after: getBalance(user.id),
        },
        status as 400 | 401 | 402 | 403 | 404 | 429 | 500 | 502 | 503,
      );
    }
    throw err;
  }
});
