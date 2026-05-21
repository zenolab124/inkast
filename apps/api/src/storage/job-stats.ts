import { db } from "./db.js";

/**
 * Aggregate queries for the Web UI channel (jobs table) — sibling of
 * plugin-stats.ts. Web UI jobs don't have callback / plugin / split llm+image
 * timing, so the cards are a proper subset.
 */

export interface JobOverviewStats {
  total: number;
  byStatus: Record<string, number>;
}

export interface JobLatencyStats {
  count: number;
  p50: number;
  p90: number;
  p99: number;
  max: number;
}

export interface JobErrorCodeRow {
  code: string;
  count: number;
}

export interface JobHourBucket {
  hour: string;
  total: number;
  succeeded: number;
  failed: number;
}

export interface RecentJobRow {
  id: string;
  status: string;
  size: string;
  quality: string;
  errorCode: string | null;
  totalDurationMs: number | null;
  createdAt: number;
}

export function getJobsOverview(sinceMs: number): JobOverviewStats {
  const rows = db()
    .prepare(`SELECT status FROM jobs WHERE created_at >= ?`)
    .all(sinceMs) as Array<{ status: string }>;

  const out: JobOverviewStats = { total: 0, byStatus: {} };
  for (const r of rows) {
    out.total++;
    out.byStatus[r.status] = (out.byStatus[r.status] ?? 0) + 1;
  }
  return out;
}

function percentiles(values: number[]): JobLatencyStats {
  if (values.length === 0) {
    return { count: 0, p50: 0, p90: 0, p99: 0, max: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const pick = (p: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
  return {
    count: sorted.length,
    p50: pick(0.5),
    p90: pick(0.9),
    p99: pick(0.99),
    max: sorted[sorted.length - 1]!,
  };
}

export function getJobsLatency(sinceMs: number): JobLatencyStats {
  const rows = db()
    .prepare(
      `SELECT created_at, completed_at
       FROM jobs
       WHERE created_at >= ? AND status = 'succeeded' AND completed_at IS NOT NULL`,
    )
    .all(sinceMs) as Array<{ created_at: number; completed_at: number }>;

  return percentiles(rows.map(r => r.completed_at - r.created_at));
}

export function getJobsTopErrorCodes(sinceMs: number, limit = 10): JobErrorCodeRow[] {
  const rows = db()
    .prepare(
      `SELECT error_code AS code, COUNT(*) AS count
       FROM jobs
       WHERE created_at >= ? AND error_code IS NOT NULL
       GROUP BY error_code
       ORDER BY count DESC
       LIMIT ?`,
    )
    .all(sinceMs, limit) as Array<{ code: string; count: number }>;
  return rows;
}

export function getJobsHourBuckets(sinceMs: number): JobHourBucket[] {
  const rows = db()
    .prepare(
      `SELECT strftime('%Y-%m-%d %H:00', created_at/1000, 'unixepoch') AS hour,
              COUNT(*) AS total,
              SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded,
              SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
       FROM jobs
       WHERE created_at >= ?
       GROUP BY hour
       ORDER BY hour`,
    )
    .all(sinceMs) as Array<{ hour: string; total: number; succeeded: number; failed: number }>;
  return rows;
}

export function getRecentJobs(limit = 50): RecentJobRow[] {
  const rows = db()
    .prepare(
      `SELECT id, status, size, quality, error_code, created_at, completed_at
       FROM jobs
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(limit) as Array<{
      id: string;
      status: string;
      size: string;
      quality: string;
      error_code: string | null;
      created_at: number;
      completed_at: number | null;
    }>;

  return rows.map(r => ({
    id: r.id,
    status: r.status,
    size: r.size,
    quality: r.quality,
    errorCode: r.error_code,
    totalDurationMs: r.completed_at != null ? r.completed_at - r.created_at : null,
    createdAt: r.created_at,
  }));
}
