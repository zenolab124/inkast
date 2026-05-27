import { Hono, type Context } from "hono";
import { getCookie } from "hono/cookie";
import {
  PassthroughLlmError,
  passthroughLlmJson,
} from "../../drivers/passthrough-llm.js";
import { loadBuiltinLlmConfig } from "../../domain/llm/builtin-config.js";
import { getPromptEngineSystemPrompt } from "../../domain/prompt-engine.js";
import {
  InsufficientBalanceError,
  credit,
  debit,
  getBalance,
} from "../../domain/balance/service.js";
import { findValidSession } from "../../storage/sessions.js";
import { findUserById } from "../../storage/users.js";
import { SESSION_COOKIE } from "./auth.js";

export const promptRoutes = new Hono();

interface DraftBody {
  input?: string;
  lang?: "zh" | "en";
  llmProvider?: {
    baseUrl?: string;
    apiKey?: string;
    model?: string;
    useCodexHeader?: boolean;
  };
}

/**
 * 公开版 prose → JSON prompt:
 *   - 有 llmProvider(用户带 LLM 凭据) → 透明代理,不扣余额,不需登录
 *   - 没 llmProvider                  → 必须登录 + 有余额,走 builtin LLM,扣余额
 *
 * 失败 saga:debit → 调 LLM → 失败 credit 退款。
 *
 * 输出契合主线 DraftPromptResponse:{ prompt, hints, _meta }。
 */
promptRoutes.post("/prompt/draft", async c => {
  const body = (await c.req.json().catch(() => null)) as DraftBody | null;
  if (!body) return c.json({ error: "invalid_body" }, 400);

  const input = typeof body.input === "string" ? body.input.trim() : "";
  if (!input) return c.json({ error: "missing_input" }, 400);
  const lang: "zh" | "en" = body.lang === "en" ? "en" : "zh";

  const systemPrompt = getPromptEngineSystemPrompt(lang);

  // 路径 1:透明代理
  if (
    body.llmProvider &&
    typeof body.llmProvider.baseUrl === "string" &&
    typeof body.llmProvider.apiKey === "string" &&
    typeof body.llmProvider.model === "string" &&
    body.llmProvider.baseUrl &&
    body.llmProvider.apiKey &&
    body.llmProvider.model
  ) {
    try {
      const result = await passthroughLlmJson({
        baseUrl: body.llmProvider.baseUrl,
        apiKey: body.llmProvider.apiKey,
        model: body.llmProvider.model,
        systemPrompt,
        userPrompt: input,
        useCodexHeader: body.llmProvider.useCodexHeader === true,
        signal: c.req.raw.signal,
      });
      return shapeDraftResponse(c, result, "passthrough");
    } catch (err) {
      return shapePassthroughError(c, err);
    }
  }

  // 路径 2:builtin
  const cfg = loadBuiltinLlmConfig();
  if (!cfg.enabled) {
    return c.json(
      { error: "builtin_not_configured", message: "服务端未配置 builtin LLM" },
      503,
    );
  }

  // 鉴权(builtin 必须登录)
  const token = getCookie(c, SESSION_COOKIE);
  const sess = token ? findValidSession(token) : null;
  const user = sess ? findUserById(sess.userId) : null;
  if (!user) {
    return c.json({ error: "unauthenticated", message: "builtin LLM 需登录" }, 401);
  }

  // 余额校验 + 扣减
  const cost = cfg.costPerCall;
  const available = getBalance(user.id);
  if (available < cost) {
    return c.json({ error: "insufficient_balance", required: cost, available }, 402);
  }

  const ledgerRelated = `llm:${Date.now()}`;
  try {
    debit(user.id, cost, {
      type: "consume:llm",
      reason: "builtin draftPrompt",
      relatedId: ledgerRelated,
    });
  } catch (err) {
    if (err instanceof InsufficientBalanceError) {
      return c.json(
        { error: "insufficient_balance", required: err.required, available: err.available },
        402,
      );
    }
    throw err;
  }

  try {
    const result = await passthroughLlmJson({
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      model: cfg.model,
      systemPrompt,
      userPrompt: input,
      useCodexHeader: cfg.useCodexHeader,
      signal: c.req.raw.signal,
    });
    return shapeDraftResponse(c, result, "builtin", { cost, balanceAfter: getBalance(user.id) });
  } catch (err) {
    // 退款 + 返错
    credit(user.id, cost, {
      type: "refund:llm",
      reason: err instanceof PassthroughLlmError ? `llm failed: ${err.message}` : "llm failed",
      relatedId: ledgerRelated,
    });
    return shapePassthroughError(c, err, { refunded: cost, balanceAfter: getBalance(user.id) });
  }
});

function shapeDraftResponse(
  c: Context,
  result: { json: unknown; raw: string; durationMs: number },
  backend: string,
  extras?: { cost?: number; balanceAfter?: number },
) {
  const data = result.json as { prompt?: unknown; hints?: unknown[] } | null;
  if (!data || typeof data !== "object" || !data.prompt) {
    return c.json(
      {
        error: "invalid_llm_output",
        message: "LLM 输出缺少 prompt 字段",
        raw: result.raw.slice(0, 500),
      },
      502,
    );
  }
  return c.json({
    ...data,
    hints: Array.isArray(data.hints) ? data.hints : [],
    _meta: {
      backend,
      durationMs: result.durationMs,
      ...(extras?.cost !== undefined ? { cost: extras.cost } : {}),
      ...(extras?.balanceAfter !== undefined ? { balance_after: extras.balanceAfter } : {}),
    },
  });
}

function shapePassthroughError(
  c: Context,
  err: unknown,
  extras?: { refunded?: number; balanceAfter?: number },
) {
  if (err instanceof PassthroughLlmError) {
    const status =
      err.upstreamStatus !== null && err.upstreamStatus >= 400 && err.upstreamStatus < 600
        ? err.upstreamStatus
        : 502;
    return c.json(
      {
        error: err.upstreamCode ?? "llm_error",
        message: err.message,
        upstream_status: err.upstreamStatus,
        ...(extras?.refunded !== undefined ? { refunded: extras.refunded } : {}),
        ...(extras?.balanceAfter !== undefined ? { balance_after: extras.balanceAfter } : {}),
      },
      status as 400 | 401 | 402 | 403 | 404 | 429 | 500 | 502 | 503,
    );
  }
  throw err;
}
