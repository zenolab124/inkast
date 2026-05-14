import { randomUUID } from "node:crypto";
import type {
  GenerateImageAttempt,
  ImagePrompt,
  JobRecord,
  JobStatus,
} from "@inkast/shared";
import { db } from "./db.js";

export interface CreateJobInput {
  promptSnapshot: ImagePrompt;
  promptText: string;
  isRaw: boolean;
  size: string;
  quality: string;
}

interface JobRow {
  id: string;
  kind: string;
  status: JobStatus;
  prompt_snapshot: string;
  prompt_text: string;
  is_raw: number;
  size: string;
  quality: string;
  generation_id: string | null;
  attempts: string;
  error_code: string | null;
  error_message: string | null;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
}

function rowToJob(row: JobRow): JobRecord {
  return {
    id: row.id,
    kind: "image_generate",
    status: row.status,
    promptSnapshot: JSON.parse(row.prompt_snapshot) as ImagePrompt,
    promptText: row.prompt_text,
    isRaw: row.is_raw === 1,
    size: row.size,
    quality: row.quality,
    generationId: row.generation_id,
    attempts: JSON.parse(row.attempts) as GenerateImageAttempt[],
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

export function createJob(input: CreateJobInput): JobRecord {
  const id = randomUUID();
  const now = Date.now();
  db()
    .prepare(
      `INSERT INTO jobs
       (id, kind, status, prompt_snapshot, prompt_text, is_raw,
        size, quality, attempts, created_at)
       VALUES (?, 'image_generate', 'pending', ?, ?, ?, ?, ?, '[]', ?)`,
    )
    .run(
      id,
      JSON.stringify(input.promptSnapshot),
      input.promptText,
      input.isRaw ? 1 : 0,
      input.size,
      input.quality,
      now,
    );
  return {
    id,
    kind: "image_generate",
    status: "pending",
    promptSnapshot: input.promptSnapshot,
    promptText: input.promptText,
    isRaw: input.isRaw,
    size: input.size,
    quality: input.quality,
    generationId: null,
    attempts: [],
    errorCode: null,
    errorMessage: null,
    createdAt: now,
    startedAt: null,
    completedAt: null,
  };
}

export function markJobRunning(id: string): void {
  db()
    .prepare(`UPDATE jobs SET status = 'running', started_at = ? WHERE id = ?`)
    .run(Date.now(), id);
}

export function updateJobAttempts(
  id: string,
  attempts: GenerateImageAttempt[],
): void {
  db()
    .prepare(`UPDATE jobs SET attempts = ? WHERE id = ?`)
    .run(JSON.stringify(attempts), id);
}

export function markJobSucceeded(id: string, generationId: string): void {
  db()
    .prepare(
      `UPDATE jobs SET status = 'succeeded', generation_id = ?, completed_at = ?
       WHERE id = ?`,
    )
    .run(generationId, Date.now(), id);
}

export function markJobFailed(
  id: string,
  code: string,
  message: string,
  attempts: GenerateImageAttempt[] = [],
): void {
  db()
    .prepare(
      `UPDATE jobs SET status = 'failed', error_code = ?, error_message = ?,
                       attempts = ?, completed_at = ?
       WHERE id = ?`,
    )
    .run(code, message, JSON.stringify(attempts), Date.now(), id);
}

export function getJob(id: string): JobRecord | null {
  const row = db()
    .prepare(`SELECT * FROM jobs WHERE id = ?`)
    .get(id) as JobRow | undefined;
  return row ? rowToJob(row) : null;
}

export function listJobs(opts?: {
  status?: JobStatus | JobStatus[];
  limit?: number;
  sinceMs?: number;
}): JobRecord[] {
  const limit = opts?.limit ?? 50;
  const statuses = opts?.status
    ? Array.isArray(opts.status)
      ? opts.status
      : [opts.status]
    : null;

  let where = "";
  const params: unknown[] = [];
  const clauses: string[] = [];
  if (statuses) {
    clauses.push(`status IN (${statuses.map(() => "?").join(",")})`);
    params.push(...statuses);
  }
  if (opts?.sinceMs !== undefined) {
    clauses.push(`created_at >= ?`);
    params.push(opts.sinceMs);
  }
  if (clauses.length > 0) {
    where = `WHERE ${clauses.join(" AND ")}`;
  }
  params.push(limit);

  const rows = db()
    .prepare(
      `SELECT * FROM jobs ${where} ORDER BY created_at DESC LIMIT ?`,
    )
    .all(...params) as JobRow[];
  return rows.map(rowToJob);
}

/**
 * Mark any pending/running jobs as failed on API startup — they can't be
 * resumed (the in-process timer that drives them is gone). Called from
 * runtime init so the frontend doesn't show forever-pending cards across
 * restarts.
 */
export function reaperAbandonedJobs(): number {
  const result = db()
    .prepare(
      `UPDATE jobs
       SET status = 'failed',
           error_code = 'abandoned',
           error_message = 'API process restarted before this job completed',
           completed_at = ?
       WHERE status IN ('pending', 'running')`,
    )
    .run(Date.now());
  return result.changes;
}
