/**
 * LLM call with multi-backend fallover.
 *
 * Replaces the "one backend per call" pattern (single getLlmDriver call,
 * single completeJson try). Now: env primary backend goes first, then any
 * other enabled LLM provider by priority, with the local ClaudeCode driver
 * as final tail. Each candidate gets a same-backend `invalid_json`
 * retry-once (gpt-5.5 stochastic refusals); other transient failures
 * (HTTP 5xx / timeout / rate_limited / network) jump straight to the next
 * candidate. `aborted` short-circuits.
 *
 * Why this exists: 2026-05-24 Doom2099 task burned through all 6 image
 * providers (last one returned content_blocked), entered rewrite r1,
 * r1 LLM hit a HTTP 502 once, then the whole task failed because there
 * was no fallover. With this helper, an upstream 502 just moves on to
 * the next provider's LLM and the rewrite can still happen.
 *
 * Returns the first successful CompleteJsonResult, or throws the last
 * encountered LlmDriverError (aborted bubbles up immediately).
 */

import {
  BUILTIN_CLAUDE_CODE_ID,
  listEnabledCapabilities,
} from "../../storage/providers.js";
import { getLlmDriver, type LlmBackendDescriptor } from "./index.js";
import {
  LlmDriverError,
  type CompleteJsonOptions,
  type CompleteJsonResult,
} from "./types.js";

function backendLabel(b: LlmBackendDescriptor): string {
  if (b === "claude-code") return "claude-code";
  return `openai-compatible:${b.providerId.slice(0, 8)}…`;
}

/**
 * Build the ordered list of candidate backends to try:
 *   1. env INKAST_DEFAULT_LLM_PROVIDER_ID (if set) — operator's chosen
 *      primary, goes first regardless of priority
 *   2. all other enabled LLM-kind capabilities, ordered by priority
 *      (skipping the primary so it's not tried twice, and skipping the
 *      builtin claude-code id which represents the local OAuth driver)
 *   3. claude-code as the final tail — always present so we degrade to
 *      the local driver if every remote provider is down. On jdc this
 *      typically fails (no local OAuth), but on a developer's machine
 *      it'll save the request.
 */
function resolveCandidates(): LlmBackendDescriptor[] {
  const candidates: LlmBackendDescriptor[] = [];
  const seen = new Set<string>();

  const primaryId = process.env.INKAST_DEFAULT_LLM_PROVIDER_ID?.trim();
  if (primaryId && primaryId !== BUILTIN_CLAUDE_CODE_ID) {
    candidates.push({ kind: "openai-compatible", providerId: primaryId });
    seen.add(primaryId);
  }

  const enabledLlms = listEnabledCapabilities("llm");
  let claudeCodeEnabled = false;
  for (const cap of enabledLlms) {
    const id = cap.provider.id;
    if (id === BUILTIN_CLAUDE_CODE_ID) {
      claudeCodeEnabled = true;
      continue;
    }
    if (seen.has(id)) continue;
    candidates.push({ kind: "openai-compatible", providerId: id });
    seen.add(id);
  }

  // Only add claude-code tail when the builtin capability is actually
  // enabled in DB. On jdc the operator disables it by intent (no local
  // OAuth); adding it unconditionally wastes an SDK call and surfaces a
  // misleading "Not logged in" error trail when every remote LLM fails.
  if (claudeCodeEnabled) {
    candidates.push("claude-code");
  }
  return candidates;
}

/**
 * Drop-in replacement for `getLlmDriver(...).completeJson(opts)` that walks
 * a multi-backend pool. `contextLabel` shows up in logs (e.g. "rewrite r1")
 * to make journal grepping sane.
 *
 * `postValidate` lets callers reject semantically-bad-but-syntactically-OK
 * LLM output (e.g. JSON schema parsed fine but a required business field
 * is empty). Return a non-null string (describing the rejection reason)
 * and the helper treats it as an `invalid_json` failure: same-backend
 * retry-once then fall over. This catches LLM half-refusals where the
 * model returns valid JSON but elides the load-bearing field — seen in
 * production with gpt-5.5 producing `{"analysis": {...}, "rewritten": ""}`.
 */
export async function completeJsonWithFallover<T = unknown>(
  opts: CompleteJsonOptions,
  contextLabel = "llm",
  postValidate?: (data: T) => string | null,
): Promise<CompleteJsonResult<T>> {
  const candidates = resolveCandidates();
  let lastErr: unknown;

  for (let i = 0; i < candidates.length; i++) {
    const backend = candidates[i]!;
    const label = backendLabel(backend);
    const driver = getLlmDriver(backend);

    // Same-backend retry-once on invalid_json (model stochastic refusal,
    // e.g. gpt-5.5 returning plain "我不能帮助..." text instead of JSON).
    // Other LlmDriverError codes jump to the next backend immediately.
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (opts.signal?.aborted) {
        throw new LlmDriverError("aborted", `${contextLabel} aborted by caller`);
      }
      try {
        const result = await driver.completeJson<T>(opts);
        if (postValidate) {
          const reason = postValidate(result.data);
          if (reason) {
            // Throw an invalid_json so the standard retry-once + fallover
            // path picks it up — same handling as a syntactic JSON failure.
            throw new LlmDriverError(
              "invalid_json",
              `postValidate rejected: ${reason}`,
            );
          }
        }
        return result;
      } catch (err) {
        lastErr = err;
        if (err instanceof LlmDriverError && err.code === "aborted") throw err;
        if (
          err instanceof LlmDriverError &&
          err.code === "invalid_json" &&
          attempt === 1
        ) {
          console.warn(
            `[llm] ${contextLabel} ${label} invalid_json on attempt 1 — retrying same backend once`,
          );
          continue;
        }
        const msg = err instanceof Error ? err.message.slice(0, 160) : String(err);
        const code = err instanceof LlmDriverError ? err.code : "unknown";
        const remaining = candidates.length - i - 1;
        if (remaining > 0) {
          console.warn(
            `[llm] ${contextLabel} ${label} failed (${code}: ${msg}) — falling over to next backend (${remaining} left)`,
          );
        } else {
          console.warn(
            `[llm] ${contextLabel} ${label} failed (${code}: ${msg}) — no more backends`,
          );
        }
        break;
      }
    }
  }

  throw lastErr ?? new LlmDriverError("unknown", `${contextLabel}: no candidates produced a result`);
}
