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
  callbackAttempts: number;
  callbackLost: boolean;
  llmDurationMs: number | null;
  imageDurationMs: number | null;
  totalDurationMs: number | null;
  createdAt: number;
}

export interface ProviderBreakdownRow {
  providerName: string;
  succeeded: number;
  avgImageMs: number;
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
  // SQLite strftime to bucket by hour (UTC). Frontend can re-localize if needed;
  // for an admin view we keep it simple and just label by hour.
  const rows = db()
    .prepare(
      `SELECT strftime('%Y-%m-%d %H:00', created_at/1000, 'unixepoch') AS hour,
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
      `SELECT id, plugin_id, status, callback_url, error_code,
              callback_attempts, callback_lost, llm_duration_ms,
              image_duration_ms, provider_name, created_at, completed_at
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
      callback_attempts: number;
      callback_lost: number;
      llm_duration_ms: number | null;
      image_duration_ms: number | null;
      provider_name: string | null;
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
    callbackAttempts: r.callback_attempts,
    callbackLost: r.callback_lost === 1,
    llmDurationMs: r.llm_duration_ms,
    imageDurationMs: r.image_duration_ms,
    totalDurationMs: r.completed_at != null ? r.completed_at - r.created_at : null,
    createdAt: r.created_at,
  }));
}

function extractHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "<malformed>";
  }
}
