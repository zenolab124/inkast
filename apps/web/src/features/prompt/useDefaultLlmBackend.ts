import { useMemo } from "react";
import {
  BUILTIN_CLAUDE_CODE_PROVIDER_ID,
  type LlmBackendDescriptor,
  type ProviderSummary,
} from "@inkast/shared";

/**
 * Derive which backend the LLM call should use given the current providers
 * list. Rule:
 *   1. Take all providers that have a non-disabled `llm` capability
 *   2. Pick the one with the lowest priority (ranked #1 in the LLM tab)
 *   3. If the winner is the built-in ClaudeCode row, dispatch as 'claude-code'
 *      so the driver factory routes to ClaudeCodeDriver
 *   4. Otherwise dispatch via providerId
 *
 * The built-in row is seeded by the backend so it ALWAYS exists — the only
 * way to get an empty pool is if the user disables it (and every other LLM
 * row). In that degenerate case we still fall back to 'claude-code' so
 * /api/draft-prompt doesn't error before reporting the misconfiguration.
 */
export function useEffectiveLlmBackend(
  providers: ProviderSummary[],
): LlmBackendDescriptor {
  return useMemo(() => computeEffectiveBackend(providers), [providers]);
}

export function computeEffectiveBackend(
  providers: ProviderSummary[],
): LlmBackendDescriptor {
  const candidates = providers
    .map(p => ({ p, cap: p.capabilities.find(c => c.kind === "llm" && !c.disabled) }))
    .filter((x): x is { p: ProviderSummary; cap: NonNullable<typeof x.cap> } => Boolean(x.cap))
    .sort((a, b) => a.cap.priority - b.cap.priority);

  const top = candidates[0];
  if (!top) return "claude-code";
  if (top.p.id === BUILTIN_CLAUDE_CODE_PROVIDER_ID) return "claude-code";
  return { kind: "openai-compatible", providerId: top.p.id };
}
