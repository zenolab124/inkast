import type {
  DraftPromptRequest,
  DraftPromptResponse,
  LlmBackendDescriptor,
} from "@inkast/shared";
import { getFirstEnabledProvider } from "../config/api.js";

export interface DraftPromptError {
  status: number;
  message: string;
}

/**
 * 公开版 prose → JSON prompt:浏览器拿 IDB 里的 LLM provider 配置,塞进
 * /api/prompt/draft 请求(透明代理,凭据零持久化)。没配 LLM provider 则
 * 后端走 builtin LLM(扣余额,需登录)。
 *
 * 跟主线 /api/draft-prompt 协议不一样,所以走新路径 /api/prompt/draft——
 * 公开版后端实现这条,主线代码不动。
 */
export async function draftPrompt(
  req: DraftPromptRequest,
  signal?: AbortSignal,
): Promise<DraftPromptResponse> {
  const llmProvider = await getFirstEnabledProvider("llm");
  const llmCap = llmProvider?.capabilities.find(c => c.kind === "llm");
  const useCodex = llmCap?.extras &&
    (llmCap.extras as Record<string, unknown>).useCodexHeader === true;

  const body = {
    input: req.input,
    lang: req.lang,
    llmProvider: llmProvider && llmCap
      ? {
          baseUrl: llmProvider.baseUrl,
          apiKey: llmProvider.apiKey,
          model: llmCap.model,
          useCodexHeader: !!useCodex,
        }
      : undefined,
  };

  const res = await fetch("/api/prompt/draft", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const errJson = (await res.json()) as { message?: string; error?: string };
      message = errJson.message ?? errJson.error ?? message;
    } catch {
      // body not JSON;keep status-based message
    }
    const err: DraftPromptError = { status: res.status, message };
    throw err;
  }
  return (await res.json()) as DraftPromptResponse;
}

/**
 * 公开版没有 cold-start LLM 概念(每次请求 new OpenAI client),warmup 是
 * no-op。保留签名以兼容主线 App.tsx 调用。
 */
export async function warmupLlm(_backend?: LlmBackendDescriptor): Promise<void> {
  // no-op
}
