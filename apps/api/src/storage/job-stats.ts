import type { GenerateImageAttempt } from "@inkast/shared";
import { db } from "./db.js";
import {
  aggregateAttempts,
  type ProviderBreakdownRow,
  type ProviderFailureRow,
} from "./plugin-stats.js";

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
  errorMessage: string | null;
  providerName: string | null;
  totalDurationMs: number | null;
  attempts: GenerateImageAttempt[];
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
      `SELECT strftime('%Y-%m-%d %H:00', created_at/1000, 'unixepoch', '+8 hours') AS hour,
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
      `SELECT id, status, size, quality, error_code, error_message,
              provider_name, attempts, created_at, completed_at
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
      error_message: string | null;
      provider_name: string | null;
      attempts: string;
      created_at: number;
      completed_at: number | null;
    }>;

  return rows.map(r => ({
    id: r.id,
    status: r.status,
    size: r.size,
    quality: r.quality,
    errorCode: r.error_code,
    errorMessage: r.error_message,
    providerName: r.provider_name,
    totalDurationMs: r.completed_at != null ? r.completed_at - r.created_at : null,
    attempts: safeParseAttempts(r.attempts),
    createdAt: r.created_at,
  }));
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
 * Web UI 通道版本的渠道分布。Mirrors plugin-stats.getProviderBreakdown:
 * 只统计 succeeded(图已生成),按最终落地的 provider_name 聚合。失败的 job
 * 没有 provider_name,不会出现在结果里。
 *
 * generations.duration_ms 不在 jobs 表上,所以平均耗时这里直接用 job 自身的
 * (completed_at - created_at) — 包含排队 + LLM + 生图,跟 plugin 通道的"纯生图
 * 耗时"语义不完全一致,但 Web UI 没拆点,这是能给出的最近似值。
 */
export function getJobsProviderBreakdown(sinceMs: number): ProviderBreakdownRow[] {
  const rows = db()
    .prepare(
      `SELECT COALESCE(provider_name, '(unknown)') AS providerName,
              COUNT(*) AS succeeded,
              AVG(completed_at - created_at) AS avgImageMs
       FROM jobs
       WHERE created_at >= ?
         AND status = 'succeeded'
         AND completed_at IS NOT NULL
         AND provider_name IS NOT NULL
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

/**
 * Web UI 通道版本的渠道失败分布。复用 plugin-stats.aggregateAttempts,
 * 让两通道的 dashboard 输出结构一致。
 */
export function getJobsProviderFailures(sinceMs: number): ProviderFailureRow[] {
  const rows = db()
    .prepare(
      `SELECT attempts FROM jobs WHERE created_at >= ? AND attempts != '[]'`,
    )
    .all(sinceMs) as Array<{ attempts: string }>;
  return aggregateAttempts(rows.map(r => safeParseAttempts(r.attempts)));
}
