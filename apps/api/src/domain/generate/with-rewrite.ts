/**
 * Shared wrapper around the image driver with up-to-3-round LLM rewrite
 * fallback.
 *
 * Round semantics (the names are fixed in user-facing docs):
 *   round 0 — caller's literal prompt, full pool
 *   round 1 — LLM vision rewrite (identity-feature, chain-of-thought)
 *   round 2 — fingerprint-degrade (keep colors/form/posture, only swap
 *             signature names for upper-class terms)
 *   round 3 — color-only anchor (colors immutable; form/posture relaxed)
 *
 * Caller-controllable behavior via `RewritePolicy`:
 *   - `skipOriginal: true` jumps straight to round 1 (useful for obscure
 *     characters where the model doesn't know the IP — the LLM-extracted
 *     description is often better than the model's own recall)
 *   - `maxRound: 0..3` caps how far we'll degrade before giving up. 0 means
 *     "no rewrite at all"; round 0 failure → terminal failure.
 *
 * Trigger gate for entering the rewrite loop: at least one attempt's
 * errorCode is in REWRITE_TRIGGER_CODES (provider_blocked_content,
 * upstream_safety_rejected, moderation). Pure network/auth errors don't
 * trigger rewrite — rewriting can't fix DNS/502/401.
 *
 * Both `domain/generate.ts` (Web UI channel) and `domain/plugin-async.ts`
 * (plugin channel) call this so the rewrite logic stays in one place.
 */

import { generateImage } from "../../drivers/image/openai-compatible.js";
import {
  ImageGenError,
  type ImageGenAttempt,
  type ImageGenInput,
  type ImageGenOutcome,
  type AttemptErrorCode,
} from "../../drivers/image/types.js";
import {
  rewriteBlockedPrompt,
  type IdentityAnchors,
  type RewriteRound,
} from "../rewrite-prompt/index.js";

/** Error codes that mean "same prompt will keep failing this provider"; rewriting may help. */
const REWRITE_TRIGGER_CODES: ReadonlySet<AttemptErrorCode> = new Set<AttemptErrorCode>([
  "provider_blocked_content",
  "upstream_safety_rejected",
  "moderation",
]);

const DEFAULT_MAX_ROUND: 0 | 1 | 2 | 3 = 3;

export interface RewritePolicy {
  /** Skip round 0; start at round 1. Default false. */
  skipOriginal?: boolean;
  /** Highest rewrite round allowed (0 = no rewrite). Default 3. */
  maxRound?: 0 | 1 | 2 | 3;
}

/** Live progress snapshot pushed once per provider attempt (all rounds). */
export interface ProgressSnapshot {
  /** Round currently being attempted: 0 (original prompt) … maxRound. */
  round: number;
  /** Every provider attempt so far across all rounds (append-only, live). */
  attempts: ImageGenAttempt[];
}

export interface DriveWithRewriteOutcome extends ImageGenOutcome {
  /**
   * One entry per LLM rewrite round actually performed. Empty when round 0
   * succeeded. Reflects actual order: [round1, round2, round3]. The success
   * (if any) used the LAST entry.
   */
  rewrittenPromptHistory: string[];
  /**
   * Which round actually produced the successful image. Useful for
   * downstream gating (e.g. post-review edit only runs after round ≥ 2).
   *   0 = round 0 (original prompt)
   *   1 = round 1 (identity-feature)
   *   2 = round 2 (fingerprint-degrade)
   *   3 = round 3 (color-only anchor)
   */
  successRound: 0 | 1 | 2 | 3;
}

function collectTriggerProviders(attempts: ImageGenAttempt[]): string[] {
  const ids = attempts
    .filter(a => a.errorCode && REWRITE_TRIGGER_CODES.has(a.errorCode))
    .map(a => a.providerId);
  return Array.from(new Set(ids));
}

export async function driveWithRewriteFallback(
  input: ImageGenInput,
  policy: RewritePolicy = {},
  onProgress?: (snapshot: ProgressSnapshot) => void,
): Promise<DriveWithRewriteOutcome> {
  const skipOriginal = policy.skipOriginal === true;
  const maxRound: 0 | 1 | 2 | 3 = policy.maxRound ?? DEFAULT_MAX_ROUND;

  if (skipOriginal && maxRound === 0) {
    // Nonsensical combination: skipping the original prompt means we MUST
    // use a rewritten one, but max_round=0 forbids rewriting entirely.
    // Bail loudly so the caller (or operator reading logs) notices.
    throw new ImageGenError(
      "no_providers",
      "pipeline_policy: skip_original=true with max_round=0 is contradictory (no path can produce a prompt)",
    );
  }

  const cumulativeAttempts: ImageGenAttempt[] = [];
  // Live progress mirror: the driver's onAttempt fires once per provider
  // attempt; we append here and ping onProgress so the plugin channel can
  // persist in-flight progress (current round + channels walked so far). Kept
  // separate from cumulativeAttempts — which the round-boundary logic below
  // owns for the trigger-gate / return paths — so this stays non-invasive.
  const liveAttempts: ImageGenAttempt[] = [];
  let currentRound = skipOriginal ? 1 : 0;
  const reportAttempt = (attempt: ImageGenAttempt): void => {
    liveAttempts.push(attempt);
    onProgress?.({ round: currentRound, attempts: liveAttempts });
  };
  const rewritesHistory: string[] = [];
  let lastErr: ImageGenError | undefined;
  // Populated by round 1's vision-branch analysis; rounds 2/3 inherit from
  // this rather than re-parsing round 1's rewritten text (which fixes the
  // "r2 == r1 copy-paste" failure mode).
  let round1Analysis: IdentityAnchors | null = null;

  // ─── Round 0: caller's literal prompt, full pool ────────────────────────
  if (!skipOriginal) {
    try {
      const outcome = await generateImage({ ...input, onAttempt: reportAttempt });
      return {
        ...outcome,
        rewrittenPromptHistory: [],
        successRound: 0,
      };
    } catch (err) {
      if (!(err instanceof ImageGenError) || err.code !== "all_providers_failed") throw err;
      cumulativeAttempts.push(...err.attempts);
      lastErr = err;
    }

    // Round 0 failed. If max_round=0, surface the failure unchanged.
    if (maxRound === 0) {
      throw lastErr!;
    }

    // Initial trigger gate: rewrite only makes sense if at least one of the
    // round-0 failures is a content-related code. Network/auth errors on
    // every provider → rewriting won't help.
    if (collectTriggerProviders(cumulativeAttempts).length === 0) {
      throw lastErr!;
    }
  } else {
    console.log(`[generate] ▶ skip_original=true — jumping straight to round 1`);
  }

  // ─── Rounds 1..maxRound ─────────────────────────────────────────────────
  const baseExcludes = new Set(input.excludeProviderIds ?? []);
  for (let round = 1; round <= maxRound; round++) {
    currentRound = round;
    console.log(
      `[generate] ▶ rewrite round ${round}/${maxRound} starting — ${collectTriggerProviders(cumulativeAttempts).length} trigger-coded provider(s) so far, ${rewritesHistory.length} rewrite(s) so far`,
    );

    let rewrite;
    try {
      rewrite = await rewriteBlockedPrompt({
        originalPromptText: input.promptText,
        round: round as RewriteRound,
        previousRewrittens: rewritesHistory,
        previousAnalysis: round1Analysis,
        signal: input.signal,
      });
    } catch (rewriteErr) {
      // Compose the real failure cause into the error message so callers
      // (callback consumers, DB rows, ops grepping `error_msg`) see the
      // true root cause. Earlier versions silently used lastErr's message
      // here, which hid r1 LLM failures (e.g. upstream HTTP 502) behind
      // round 0's generic "exhausted all providers" text.
      const msg = rewriteErr instanceof Error ? rewriteErr.message : String(rewriteErr);
      const composedMsg = lastErr
        ? `rewrite r${round} LLM failed: ${msg} — and earlier rounds also failed (last: ${lastErr.message})`
        : `rewrite r${round} LLM failed: ${msg}`;
      console.warn(`[generate]   ✗ rewrite r${round} step failed — ${composedMsg}`);
      throw new ImageGenError(
        lastErr?.code ?? "all_providers_failed",
        composedMsg,
        cumulativeAttempts,
        lastErr?.cause,
        rewritesHistory,
      );
    }
    rewritesHistory.push(rewrite.rewrittenPromptText);
    // Stash round 1's analysis the first time we see one; rounds 2/3 use it
    // as the authoritative identity source.
    if (round === 1 && rewrite.analysis) {
      round1Analysis = rewrite.analysis;
    }

    // No accumulated exclude: each rewrite round produces a meaningfully
    // different prompt, so providers that returned trigger codes on earlier
    // rounds should get re-tried with the new text. (We used to permanently
    // exclude them after one trigger-coded failure, which saved time but
    // also denied the rewrite a chance to actually unblock the provider.)
    // Only honor the caller-supplied excludes (e.g. the post-review edit
    // step uses this to force images-mode providers).
    const excludesForRetry = [...baseExcludes];

    try {
      const retryOutcome = await generateImage({
        ...input,
        promptText: rewrite.rewrittenPromptText,
        excludeProviderIds: excludesForRetry,
        onAttempt: reportAttempt,
      });
      console.log(
        `[generate]   ✓ rewrite r${round} + retry succeeded via ${retryOutcome.providerName} in ${retryOutcome.totalDurationMs}ms`,
      );
      return {
        ...retryOutcome,
        attempts: [...cumulativeAttempts, ...retryOutcome.attempts],
        rewrittenPromptHistory: [...rewritesHistory],
        successRound: round as 1 | 2 | 3,
      };
    } catch (retryErr) {
      if (!(retryErr instanceof ImageGenError)) throw retryErr;
      cumulativeAttempts.push(...retryErr.attempts);
      lastErr = retryErr;
      // No early bail: keep stepping through rounds up to maxRound. Even if
      // this round's failures are non-content (network/server), the next
      // round's more aggressive prompt degradation might still get through
      // a transient-recovered provider.
    }
  }

  throw new ImageGenError(
    "all_providers_failed_after_rewrite",
    `rewrote prompt with LLM up to round ${maxRound} but still no provider succeeded: ${lastErr?.message ?? "(no underlying err)"}`,
    cumulativeAttempts,
    lastErr,
    rewritesHistory,
  );
}
