import type { GenerateImageAttempt } from "@inkast/shared";
import { db } from "./db.js";

/**
 * Aggregate queries for the plugin-channel admin dashboard.
 * All queries scope to a time window passed in as `sinceMs`.
 */

export interface OverviewStats {
  total: number;
  byStatus: Record<string, number>;
  byPlugin: Record<string, { total: number; succeeded: number; failed: number; callbackLost: number }>;
}

export interface LatencyStats {
  count: number;
  p50: number;
  p90: number;
  p99: number;
  max: number;
}

export interface CallbackHealth {
  totalCallbacks: number;
  successAtAttempt: Record<number, number>;
  callbackLost: number;
  avgAttempts: number;
}

export interface ErrorCodeRow {
  code: string;
  count: number;
}

export interface HourBucket {
  hour: string;
  total: number;
  succeeded: number;
  failed: number;
}

export interface RecentTaskRow {
  id: string;
  pluginId: string;
  status: string;
  providerName: string | null;
  callbackHost: string;
  errorCode: string | null;
  errorMsg: string | null;
  callbackAttempts: number;
  callbackLost: boolean;
  llmDurationMs: number | null;
  imageDurationMs: number | null;
  totalDurationMs: number | null;
  attempts: GenerateImageAttempt[];
  /** running only: live round (0..3) the task is on; null on terminal/old rows. */
  currentRound: number | null;
  createdAt: number;
}

export interface ProviderBreakdownRow {
  providerName: string;
  succeeded: number;
  avgImageMs: number;
}

/**
 * Per-provider failure breakdown computed from the `attempts` JSON arrays
 * across all plugin_tasks in the window. Each attempt with `ok=false` counts
 * once toward (providerName, errorCode). Used by the "渠道失败 Top" dashboard
 * card to surface which channels are flaky and *how* they're failing.
 */
export interface ProviderFailureRow {
  providerName: string;
  totalAttempts: number;
  failedAttempts: number;
  byErrorCode: Record<string, number>;
}

/**
 * Aggregate succeeded plugin tasks by provider_name. Counts only `succeeded`
 * and `callback_lost` (the image was generated, just callback didn't make it).
 * Failures pre-image (LLM unavailable etc.) don't have a provider attached.
 */
export function getProviderBreakdown(sinceMs: number): ProviderBreakdownRow[] {
  const rows = db()
    .prepare(
      `SELECT COALESCE(provider_name, '(unknown)') AS providerName,
              COUNT(*) AS succeeded,
              AVG(image_duration_ms) AS avgImageMs
       FROM plugin_tasks
       WHERE created_at >= ?
         AND status IN ('succeeded', 'callback_lost')
       GROUP BY providerName
       ORDER BY succeeded DESC`,
    )
    .all(sinceMs) as Array<{ providerName: string; succeeded: number; avgImageMs: number | null }>;
  return rows.map(r => ({
    providerName: r.providerName,
    succeeded: r.succeeded,
    avgImageMs: r.avgImageMs ? Math.round(r.avgImageMs) : 0,
  }));
}

export function getOverview(sinceMs: number): OverviewStats {
  const rows = db()
    .prepare(
      `SELECT plugin_id, status, callback_lost FROM plugin_tasks WHERE created_at >= ?`,
    )
    .all(sinceMs) as Array<{ plugin_id: string; status: string; callback_lost: number }>;

  const out: OverviewStats = { total: 0, byStatus: {}, byPlugin: {} };
  for (const r of rows) {
    out.total++;
    out.byStatus[r.status] = (out.byStatus[r.status] ?? 0) + 1;
    const p = (out.byPlugin[r.plugin_id] ??= {
      total: 0,
      succeeded: 0,
      failed: 0,
      callbackLost: 0,
    });
    p.total++;
    if (r.status === "succeeded") p.succeeded++;
    if (r.status === "failed") p.failed++;
    if (r.callback_lost === 1) p.callbackLost++;
  }
  return out;
}

function percentiles(values: number[]): LatencyStats {
  if (values.length === 0) {
    return { count: 0, p50: 0, p90: 0, p99: 0, max: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const pick = (p: number): number => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
  return {
    count: sorted.length,
    p50: pick(0.5),
    p90: pick(0.9),
    p99: pick(0.99),
    max: sorted[sorted.length - 1]!,
  };
}

export function getLatency(sinceMs: number): { llm: LatencyStats; image: LatencyStats; total: LatencyStats } {
  const rows = db()
    .prepare(
      `SELECT llm_duration_ms, image_duration_ms, created_at, completed_at
       FROM plugin_tasks
       WHERE created_at >= ? AND status IN ('succeeded', 'callback_lost')`,
    )
    .all(sinceMs) as Array<{
      llm_duration_ms: number | null;
      image_duration_ms: number | null;
      created_at: number;
      completed_at: number | null;
    }>;

  const llmVals: number[] = [];
  const imageVals: number[] = [];
  const totalVals: number[] = [];
  for (const r of rows) {
    if (r.llm_duration_ms != null && r.llm_duration_ms > 0) llmVals.push(r.llm_duration_ms);
    if (r.image_duration_ms != null && r.image_duration_ms > 0) imageVals.push(r.image_duration_ms);
    if (r.completed_at != null) totalVals.push(r.completed_at - r.created_at);
  }
  return {
    llm: percentiles(llmVals),
    image: percentiles(imageVals),
    total: percentiles(totalVals),
  };
}

export function getCallbackHealth(sinceMs: number): CallbackHealth {
  const rows = db()
    .prepare(
      `SELECT callback_attempts, callback_lost, status
       FROM plugin_tasks
       WHERE created_at >= ? AND status IN ('succeeded', 'failed', 'callback_lost')`,
    )
    .all(sinceMs) as Array<{ callback_attempts: number; callback_lost: number; status: string }>;

  const out: CallbackHealth = {
    totalCallbacks: 0,
    successAtAttempt: {},
    callbackLost: 0,
    avgAttempts: 0,
  };
  let attemptSum = 0;
  for (const r of rows) {
    if (r.callback_attempts === 0) continue;
    out.totalCallbacks++;
    attemptSum += r.callback_attempts;
    if (r.callback_lost === 1) {
      out.callbackLost++;
    } else {
      out.successAtAttempt[r.callback_attempts] = (out.successAtAttempt[r.callback_attempts] ?? 0) + 1;
    }
  }
  out.avgAttempts = out.totalCallbacks > 0 ? attemptSum / out.totalCallbacks : 0;
  return out;
}

export function getTopErrorCodes(sinceMs: number, limit = 10): ErrorCodeRow[] {
  const rows = db()
    .prepare(
      `SELECT error_code AS code, COUNT(*) AS count
       FROM plugin_tasks
       WHERE created_at >= ? AND error_code IS NOT NULL
       GROUP BY error_code
       ORDER BY count DESC
       LIMIT ?`,
    )
    .all(sinceMs, limit) as Array<{ code: string; count: number }>;
  return rows;
}

export function getHourBuckets(sinceMs: number): HourBucket[] {
  // 按北京时间(Asia/Shanghai, UTC+8)的小时分桶,跟 admin 页面表格里的创建时间口径一致。
  const rows = db()
    .prepare(
      `SELECT strftime('%Y-%m-%d %H:00', created_at/1000, 'unixepoch', '+8 hours') AS hour,
              COUNT(*) AS total,
              SUM(CASE WHEN status = 'succeeded' OR status = 'callback_lost' THEN 1 ELSE 0 END) AS succeeded,
              SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
       FROM plugin_tasks
       WHERE created_at >= ?
       GROUP BY hour
       ORDER BY hour`,
    )
    .all(sinceMs) as Array<{ hour: string; total: number; succeeded: number; failed: number }>;
  return rows;
}

export function getRecentTasks(limit = 50): RecentTaskRow[] {
  const rows = db()
    .prepare(
      `SELECT id, plugin_id, status, callback_url, error_code, error_msg,
              callback_attempts, callback_lost, llm_duration_ms,
              image_duration_ms, provider_name, attempts, current_round,
              created_at, completed_at
       FROM plugin_tasks
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(limit) as Array<{
      id: string;
      plugin_id: string;
      status: string;
      callback_url: string;
      error_code: string | null;
      error_msg: string | null;
      callback_attempts: number;
      callback_lost: number;
      llm_duration_ms: number | null;
      image_duration_ms: number | null;
      provider_name: string | null;
      attempts: string;
      current_round: number | null;
      created_at: number;
      completed_at: number | null;
    }>;

  return rows.map(r => ({
    id: r.id,
    pluginId: r.plugin_id,
    status: r.status,
    providerName: r.provider_name,
    callbackHost: extractHost(r.callback_url),
    errorCode: r.error_code,
    errorMsg: r.error_msg,
    callbackAttempts: r.callback_attempts,
    callbackLost: r.callback_lost === 1,
    llmDurationMs: r.llm_duration_ms,
    imageDurationMs: r.image_duration_ms,
    totalDurationMs: r.completed_at != null ? r.completed_at - r.created_at : null,
    attempts: safeParseAttempts(r.attempts),
    currentRound: r.current_round,
    createdAt: r.created_at,
  }));
}

/**
 * Walks every plugin_tasks.attempts JSON in the window and aggregates per
 * (providerName, errorCode). Counts every attempt (including the successful
 * final one) toward totalAttempts so a "100% success" channel shows up too;
 * failedAttempts is the more useful one for spotting flaky providers.
 *
 * SQLite has json_each but iterating in Node is simpler given attempts arrays
 * are small (typically ≤6) and we already need per-provider grouping logic.
 */
export function getProviderFailures(sinceMs: number): ProviderFailureRow[] {
  const rows = db()
    .prepare(
      `SELECT attempts FROM plugin_tasks WHERE created_at >= ? AND attempts != '[]'`,
    )
    .all(sinceMs) as Array<{ attempts: string }>;

  return aggregateAttempts(rows.map(r => safeParseAttempts(r.attempts)));
}

function safeParseAttempts(raw: string | null | undefined): GenerateImageAttempt[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as GenerateImageAttempt[]) : [];
  } catch {
    return [];
  }
}

/**
 * Shared helper — also called from job-stats.ts so both channels build the
 * exact same "渠道失败 Top" structure. Exported intentionally.
 */
export function aggregateAttempts(
  attemptsArrays: GenerateImageAttempt[][],
): ProviderFailureRow[] {
  const byProvider = new Map<string, ProviderFailureRow>();
  for (const arr of attemptsArrays) {
    for (const a of arr) {
      const name = a.providerName || "(unknown)";
      let row = byProvider.get(name);
      if (!row) {
        row = { providerName: name, totalAttempts: 0, failedAttempts: 0, byErrorCode: {} };
        byProvider.set(name, row);
      }
      row.totalAttempts++;
      if (!a.ok) {
        row.failedAttempts++;
        const code = a.errorCode ?? "unknown";
        row.byErrorCode[code] = (row.byErrorCode[code] ?? 0) + 1;
      }
    }
  }
  return [...byProvider.values()].sort((a, b) => b.failedAttempts - a.failedAttempts);
}

function extractHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "<malformed>";
  }
}
