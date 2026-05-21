import { randomUUID } from "node:crypto";
import { db } from "./db.js";

export type PluginTaskStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "callback_lost";

export interface PluginTaskRow {
  id: string;
  pluginId: string;
  prompt: string;
  callbackUrl: string;
  /**
   * Plaintext one-time token caller supplied at submit. Echoed back as
   * `X-Callback-Token` header on callback POST so caller can verify.
   * Not hashed: caller stores it plaintext too (per v2 protocol §3),
   * token is task-scoped + single-use + GC'd after 24h.
   */
  callbackToken: string;
  status: PluginTaskStatus;
  b64Json: string | null;
  mime: string | null;
  promptJson: string | null;
  errorCode: string | null;
  errorMsg: string | null;
  callbackAttempts: number;
  lastCallbackAt: number | null;
  callbackLost: boolean;
  llmDurationMs: number | null;
  imageDurationMs: number | null;
  providerId: string | null;
  providerName: string | null;
  createdAt: number;
  completedAt: number | null;
}

interface DbRow {
  id: string;
  plugin_id: string;
  prompt: string;
  callback_url: string;
  callback_token: string;
  status: PluginTaskStatus;
  b64_json: string | null;
  mime: string | null;
  prompt_json: string | null;
  error_code: string | null;
  error_msg: string | null;
  callback_attempts: number;
  last_callback_at: number | null;
  callback_lost: number;
  llm_duration_ms: number | null;
  image_duration_ms: number | null;
  provider_id: string | null;
  provider_name: string | null;
  created_at: number;
  completed_at: number | null;
}

function rowToTask(row: DbRow): PluginTaskRow {
  return {
    id: row.id,
    pluginId: row.plugin_id,
    prompt: row.prompt,
    callbackUrl: row.callback_url,
    callbackToken: row.callback_token,
    status: row.status,
    b64Json: row.b64_json,
    mime: row.mime,
    promptJson: row.prompt_json,
    errorCode: row.error_code,
    errorMsg: row.error_msg,
    callbackAttempts: row.callback_attempts,
    lastCallbackAt: row.last_callback_at,
    callbackLost: row.callback_lost === 1,
    llmDurationMs: row.llm_duration_ms,
    imageDurationMs: row.image_duration_ms,
    providerId: row.provider_id,
    providerName: row.provider_name,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

export interface CreatePluginTaskInput {
  pluginId: string;
  prompt: string;
  callbackUrl: string;
  callbackToken: string;
}

export function createPluginTask(input: CreatePluginTaskInput): PluginTaskRow {
  const id = `ink-${randomUUID()}`;
  const now = Date.now();
  db()
    .prepare(
      `INSERT INTO plugin_tasks
        (id, plugin_id, prompt, callback_url, callback_token, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'queued', ?)`,
    )
    .run(id, input.pluginId, input.prompt, input.callbackUrl, input.callbackToken, now);
  return {
    id,
    pluginId: input.pluginId,
    prompt: input.prompt,
    callbackUrl: input.callbackUrl,
    callbackToken: input.callbackToken,
    status: "queued",
    b64Json: null,
    mime: null,
    promptJson: null,
    errorCode: null,
    errorMsg: null,
    callbackAttempts: 0,
    lastCallbackAt: null,
    callbackLost: false,
    llmDurationMs: null,
    imageDurationMs: null,
    providerId: null,
    providerName: null,
    createdAt: now,
    completedAt: null,
  };
}

export function markTaskRunning(id: string): void {
  db().prepare(`UPDATE plugin_tasks SET status = 'running' WHERE id = ?`).run(id);
}

export interface MarkSucceededInput {
  b64Json: string;
  mime: string;
  promptJson: string;
  llmDurationMs: number;
  imageDurationMs: number;
  providerId: string;
  providerName: string;
}

export function markTaskSucceeded(id: string, input: MarkSucceededInput): void {
  db()
    .prepare(
      `UPDATE plugin_tasks
       SET status = 'succeeded', b64_json = ?, mime = ?, prompt_json = ?,
           llm_duration_ms = ?, image_duration_ms = ?,
           provider_id = ?, provider_name = ?,
           completed_at = ?
       WHERE id = ?`,
    )
    .run(
      input.b64Json,
      input.mime,
      input.promptJson,
      input.llmDurationMs,
      input.imageDurationMs,
      input.providerId,
      input.providerName,
      Date.now(),
      id,
    );
}

export interface MarkFailedInput {
  errorCode: string;
  errorMsg: string;
  llmDurationMs?: number | null;
  imageDurationMs?: number | null;
}

export function markTaskFailed(id: string, input: MarkFailedInput): void {
  db()
    .prepare(
      `UPDATE plugin_tasks
       SET status = 'failed', error_code = ?, error_msg = ?,
           llm_duration_ms = ?, image_duration_ms = ?, completed_at = ?
       WHERE id = ?`,
    )
    .run(
      input.errorCode,
      input.errorMsg,
      input.llmDurationMs ?? null,
      input.imageDurationMs ?? null,
      Date.now(),
      id,
    );
}

export function incrementCallbackAttempt(id: string): void {
  db()
    .prepare(
      `UPDATE plugin_tasks
       SET callback_attempts = callback_attempts + 1, last_callback_at = ?
       WHERE id = ?`,
    )
    .run(Date.now(), id);
}

export function markCallbackLost(id: string): void {
  db()
    .prepare(`UPDATE plugin_tasks SET callback_lost = 1, status = 'callback_lost' WHERE id = ?`)
    .run(id);
}

export function getPluginTask(id: string): PluginTaskRow | null {
  const row = db()
    .prepare(`SELECT * FROM plugin_tasks WHERE id = ?`)
    .get(id) as DbRow | undefined;
  return row ? rowToTask(row) : null;
}

/**
 * Tasks still queued or running at call time. Used by startup recovery to
 * interrupt them and trigger callbacks.
 */
export function listInflightTasks(): PluginTaskRow[] {
  const rows = db()
    .prepare(
      `SELECT * FROM plugin_tasks WHERE status IN ('queued','running')
       ORDER BY created_at ASC`,
    )
    .all() as DbRow[];
  return rows.map(rowToTask);
}

/**
 * Mark all queued/running tasks as failed with `interrupted` code. Called on
 * startup — the in-process worker that owned these is gone after restart, so
 * we'd otherwise leave callers waiting forever. Returns the rows that were
 * affected (pre-update snapshot) so recovery can fire one last callback per.
 */
export function reaperInflightPluginTasks(): PluginTaskRow[] {
  const before = listInflightTasks();
  if (before.length === 0) return [];
  db()
    .prepare(
      `UPDATE plugin_tasks
       SET status = 'failed', error_code = 'interrupted',
           error_msg = 'inkast restarted mid-flight', completed_at = ?
       WHERE status IN ('queued','running')`,
    )
    .run(Date.now());
  return before;
}

/**
 * GC: delete terminal-state rows older than the cutoff. queued/running never
 * deleted (would orphan in-flight work). Returns count deleted.
 */
export function gcOldPluginTasks(olderThanMs: number): number {
  const cutoff = Date.now() - olderThanMs;
  const result = db()
    .prepare(
      `DELETE FROM plugin_tasks
       WHERE created_at < ?
         AND status IN ('succeeded','failed','callback_lost')`,
    )
    .run(cutoff);
  return result.changes;
}
