import type {
  DraftPromptRequest,
  DraftPromptResponse,
  LlmBackendDescriptor,
} from "@inkast/shared";

export interface DraftPromptError {
  status: number;
  message: string;
}

export async function draftPrompt(
  req: DraftPromptRequest,
  signal?: AbortSignal,
): Promise<DraftPromptResponse> {
  const res = await fetch("/api/draft-prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
    signal,
  });

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { message?: string };
      if (body?.message) message = body.message;
    } catch {
      // body not JSON; keep status-based message
    }
    const err: DraftPromptError = { status: res.status, message };
    throw err;
  }

  return (await res.json()) as DraftPromptResponse;
}

/**
 * Tell the API to pre-pay the LLM cold-start (subprocess spawn, OAuth decrypt,
 * TLS handshake). Fire-and-forget from the UI — failures are silently ignored,
 * since this is purely a latency optimization.
 */
export async function warmupLlm(backend?: LlmBackendDescriptor): Promise<void> {
  try {
    await fetch("/api/llm/warmup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(backend ? { backend } : {}),
    });
  } catch {
    // Silent: warmup is best-effort.
  }
}
