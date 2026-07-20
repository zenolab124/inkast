import { ImageGenError } from "../drivers/image/types.js";
import { LlmDriverError } from "../drivers/llm/types.js";

/**
 * Plugin 通道错误体 — 形似 OpenAI 标准 `{ error: { code, message, type } }`,
 * 但 `code` 是 inkast 自有命名,调用方在 worker 层做一次 mapper(参见
 * docs/inkast-integration.md §4 末尾的映射表)。
 */
export interface OpenAiStyleErrorBody {
  error: {
    code: string;
    message: string;
    type: string;
  };
}

export type ErrorStatus = 400 | 401 | 422 | 429 | 500 | 502 | 503 | 504;

export interface MappedError {
  status: ErrorStatus;
  body: OpenAiStyleErrorBody;
}

/**
 * 把 inkast 内部抛出的 `ImageGenError` / `LlmDriverError` / 其它 Error 映射成
 * 调用方文档里承诺的错误码 + HTTP 状态。任何非 ImageGenError/LlmDriverError
 * 一律归 `internal_error`/500 — 内部 bug 不该把内部细节往外漏。
 */
export function toOpenAiError(err: unknown): MappedError {
  if (err instanceof ImageGenError) {
    switch (err.code) {
      case "no_providers":
        return mk(503, "image_provider_unavailable", err.message, "api_error");
      case "all_providers_failed": {
        const codes = err.attempts.map(a => a.errorCode).filter(Boolean);
        if (codes.includes("rate_limit")) {
          return mk(429, "image_provider_rate_limited", err.message, "rate_limit_error");
        }
        if (codes.length > 0 && codes.every(c => c === "auth")) {
          return mk(500, "internal_error", "image provider auth misconfigured", "server_error");
        }
        return mk(503, "image_provider_unavailable", err.message, "api_error");
      }
      case "rewrite_llm_failed":
        return mk(502, "prompt_rewrite_failed", err.message, "api_error");
      case "moderation_rejected":
        return mk(422, "content_moderation_blocked", err.message, "invalid_request_error");
      case "aborted":
        return mk(504, "timeout", err.message, "api_error");
      default:
        return mk(500, "internal_error", err.message, "server_error");
    }
  }

  if (err instanceof LlmDriverError) {
    switch (err.code) {
      case "rate_limited":
        return mk(429, "llm_rate_limited", err.message, "rate_limit_error");
      case "timeout":
      case "aborted":
        return mk(504, "timeout", err.message, "api_error");
      case "invalid_json":
        return mk(502, "prompt_rewrite_failed", err.message, "api_error");
      case "backend_unavailable":
        return mk(503, "llm_unavailable", err.message, "api_error");
      case "not_authenticated":
        return mk(500, "internal_error", "llm backend not authenticated", "server_error");
      default:
        return mk(500, "internal_error", err.message, "server_error");
    }
  }

  const msg = err instanceof Error ? err.message : String(err);
  return mk(500, "internal_error", msg, "server_error");
}

function mk(
  status: ErrorStatus,
  code: string,
  message: string,
  type: string,
): MappedError {
  return { status, body: { error: { code, message, type } } };
}
