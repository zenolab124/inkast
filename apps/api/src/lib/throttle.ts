/**
 * Per-provider minimum-interval throttle.
 *
 * Many image providers enforce a rate limit (often 1-5 RPS). With
 * MAX_CONCURRENT=25 plugin tasks plus retries, the in-process pool can
 * easily fire 10+ requests at the same provider within a second, tripping
 * the limit and burning a slot on an avoidable failure.
 *
 * This module serializes calls per providerId: each acquirer awaits the
 * previous acquirer's slot, then optionally sleeps until `minIntervalMs`
 * has elapsed since the *previous dispatch* before being released.
 *
 * Design notes
 * ────────────
 * - Process-local. inkast is single-process; cross-process coordination
 *   not needed.
 * - Per-providerId. Different providers don't share rate budgets.
 * - Blocking (await), not reject. Plugin-async tasks tolerate hundreds
 *   of ms of queueing easily — the upstream model itself takes 30-360s.
 * - Chain-of-promises pattern: each call resolves only after the previous
 *   call's slot has elapsed, so concurrent acquirers naturally line up
 *   without explicit lock-management.
 * - Map nodes are not aggressively GC'd, but each entry is just the tail
 *   Promise; V8 collapses resolved chain heads internally.
 */

/** Per-provider tail of the serialized acquisition chain. */
const acquisitionChain = new Map<string, Promise<void>>();
/** Wall-clock ms of the last dispatch we let through, per provider. */
const lastDispatchAt = new Map<string, number>();

/**
 * Block until the caller is allowed to dispatch a request to `providerId`.
 * No-op when `minIntervalMs` <= 0.
 *
 * Concurrent callers for the same provider serialize: each waits for the
 * previous to finish its `minIntervalMs` window before being released.
 */
export async function acquireProviderSlot(
  providerId: string,
  minIntervalMs: number,
): Promise<void> {
  if (!Number.isFinite(minIntervalMs) || minIntervalMs <= 0) return;

  const previous = acquisitionChain.get(providerId) ?? Promise.resolve();
  const myTurn = previous.then(async () => {
    const last = lastDispatchAt.get(providerId) ?? 0;
    const waitMs = last + minIntervalMs - Date.now();
    if (waitMs > 0) {
      console.log(
        `[throttle] ${providerId} waiting ${waitMs}ms (min_interval=${minIntervalMs}ms)`,
      );
      await new Promise<void>(resolve => setTimeout(resolve, waitMs));
    }
    lastDispatchAt.set(providerId, Date.now());
  });
  acquisitionChain.set(providerId, myTurn);
  await myTurn;
}
