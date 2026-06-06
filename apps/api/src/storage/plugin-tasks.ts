import { randomUUID } from "node:crypto";
import type { GenerateImageAttempt } from "@inkast/shared";
import { db } from "./db.js";
import { insertPluginGalleryItem } from "./plugin-gallery.js";

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
  /**
   * Mutually exclusive with `imageUrl` — exactly one is set on succeeded,
   * driven by the plugin's `imageStorage.kind`:
   *   - "b64" (default): b64Json set, imageUrl null
   *   - "r2":            imageUrl set (public URL on plugin-configured CDN), b64Json null
   */
  b64Json: string | null;
  imageUrl: string | null;
  mime: string | null;
  promptJson: string | null;
  /**
   * One entry per LLM rewrite round actually performed. Empty array when no
   * rewrite happened (original prompt succeeded). Persisted regardless of
   * outcome — on failure paths the dashboard can still see what each round
   * produced. Stored as JSON in the DB cell; deserialized here for callers.
   */
  rewrittenPrompts: string[];
  /**
   * Which rewrite round actually produced the successful image. Set only on
   * `succeeded` tasks. Null otherwise (failed / not yet completed).
   *   0 = caller's literal prompt direct (no rewrite happened)
   *   1 = LLM vision rewrite (identity-feature)
   *   2 = fingerprint-degrade
   *   3 = color-only anchor
   */
  successRound: 0 | 1 | 2 | 3 | null;
  /**
   * True iff the post-review edit step actually replaced the image bytes.
   * Set only on `succeeded` tasks. False means either post-review wasn't
   * enabled, or it ran and the LLM judged the image already matched (no
   * edit needed), or the edit attempt itself failed and we kept the
   * pre-review image. Null on failed tasks.
   */
  postReviewEdited: boolean | null;
  errorCode: string | null;
  errorMsg: string | null;
  callbackAttempts: number;
  lastCallbackAt: number | null;
  callbackLost: boolean;
  llmDurationMs: number | null;
  imageDurationMs: number | null;
  providerId: string | null;
  providerName: string | null;
  /**
   * Every provider attempt the driver made for this task, in order. Includes
   * both failures (with errorCode/errorMessage) and the final successful one
   * (when status=succeeded). Empty array when the task failed before reaching
   * the image driver (LLM error, no providers configured, R2 upload failure
   * post-success). Each element is `GenerateImageAttempt` from @inkast/shared.
   */
  attempts: GenerateImageAttempt[];
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
  image_url: string | null;
  mime: string | null;
  prompt_json: string | null;
  rewritten_prompt: string | null;
  success_round: number | null;
  post_review_edited: number | null;
  error_code: string | null;
  error_msg: string | null;
  callback_attempts: number;
  last_callback_at: number | null;
  callback_lost: number;
  llm_duration_ms: number | null;
  image_duration_ms: number | null;
  provider_id: string | null;
  provider_name: string | null;
  attempts: string;
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
    imageUrl: row.image_url,
    mime: row.mime,
    promptJson: row.prompt_json,
    rewrittenPrompts: parseRewrittenPrompts(row.rewritten_prompt),
    successRound:
      row.success_round === 0 ||
      row.success_round === 1 ||
      row.success_round === 2 ||
      row.success_round === 3
        ? (row.success_round as 0 | 1 | 2 | 3)
        : null,
    postReviewEdited:
      row.post_review_edited === null ? null : row.post_review_edited === 1,
    errorCode: row.error_code,
    errorMsg: row.error_msg,
    callbackAttempts: row.callback_attempts,
    lastCallbackAt: row.last_callback_at,
    callbackLost: row.callback_lost === 1,
    llmDurationMs: row.llm_duration_ms,
    imageDurationMs: row.image_duration_ms,
    providerId: row.provider_id,
    providerName: row.provider_name,
    attempts: parseAttempts(row.attempts),
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

function parseAttempts(raw: string | null | undefined): GenerateImageAttempt[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as GenerateImageAttempt[]) : [];
  } catch {
    return [];
  }
}

function parseRewrittenPrompts(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
    // Legacy single-string format from v2.3 — wrap into a 1-element array
    // so dashboards / callers see a consistent shape.
    if (typeof v === "string" && v.length > 0) return [v];
  } catch {
    // v2.3 stored a raw string (not JSON). Treat as single round.
    if (typeof raw === "string" && raw.length > 0) return [raw];
  }
  return [];
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
    imageUrl: null,
    mime: null,
    promptJson: null,
    rewrittenPrompts: [],
    successRound: null,
    postReviewEdited: null,
    errorCode: null,
    errorMsg: null,
    callbackAttempts: 0,
    lastCallbackAt: null,
    callbackLost: false,
    llmDurationMs: null,
    imageDurationMs: null,
    providerId: null,
    providerName: null,
    attempts: [],
    createdAt: now,
    completedAt: null,
  };
}

export function markTaskRunning(id: string): void {
  db().prepare(`UPDATE plugin_tasks SET status = 'running' WHERE id = ?`).run(id);
}

/**
 * Increment-update a running task's live progress: which round it's on and the
 * provider attempts walked so far. Driven by the plugin worker's onProgress
 * hook (the image driver fires it once per provider attempt). The
 * `status = 'running'` guard makes a late/racing ping a no-op once the row
 * reached a terminal state — so it can never clobber the authoritative
 * attempts written by markTaskSucceeded / markTaskFailed.
 */
export function updateTaskProgress(
  id: string,
  progress: { round: number; attempts: GenerateImageAttempt[] },
): void {
  db()
    .prepare(
      `UPDATE plugin_tasks
       SET current_round = ?, attempts = ?
       WHERE id = ? AND status = 'running'`,
    )
    .run(progress.round, JSON.stringify(progress.attempts), id);
}

/**
 * Exactly one of `b64Json` / `imageUrl` must be set, driven by the plugin's
 * imageStorage.kind. mime is always set so callers know the bytes' format
 * (even when bytes are remote — useful for client-side Content-Type assertions).
 */
interface SucceededBase {
  mime: string;
  promptJson: string;
  llmDurationMs: number;
  imageDurationMs: number;
  providerId: string;
  providerName: string;
  /** Full driver attempt trail. Persisted as JSON for the admin dashboard. */
  attempts: GenerateImageAttempt[];
  /**
   * One entry per LLM rewrite round actually performed before this terminal
   * outcome. Empty array means no rewrite happened. The DRIVER does the
   * dedup — callers always pass `outcome.rewrittenPromptHistory` straight
   * through. Stored as JSON in the DB cell.
   * Used by the admin dashboard / debugging — never sent in callbacks.
   */
  rewrittenPrompts?: string[];
  /**
   * Which rewrite round actually produced the image. 0 = caller's literal
   * prompt; 1/2/3 = LLM rewrite rounds. Persisted for both the dashboard
   * AND the callback body (snap-ub uses this to label the result).
   */
  successRound: 0 | 1 | 2 | 3;
  /**
   * True iff the post-review edit step replaced the image. False means
   * either post-review didn't run, ran-and-passed, or ran-and-fell-back.
   * Persisted for both dashboard + callback.
   */
  postReviewEdited: boolean;
}

export type MarkSucceededInput =
  | (SucceededBase & { kind: "b64"; b64Json: string })
  | (SucceededBase & { kind: "r2"; imageUrl: string });

export function markTaskSucceeded(id: string, input: MarkSucceededInput): void {
  const b64Json = input.kind === "b64" ? input.b64Json : null;
  const imageUrl = input.kind === "r2" ? input.imageUrl : null;
  const rewrittenPromptsJson =
    input.rewrittenPrompts && input.rewrittenPrompts.length > 0
      ? JSON.stringify(input.rewrittenPrompts)
      : null;

  // Atomic: UPDATE the task row + (r2 only) archive into plugin_gallery_items
  // in the same transaction so the gallery never has a row whose task didn't
  // actually succeed, and vice versa. better-sqlite3 transactions are sync.
  const tx = db().transaction(() => {
    db()
      .prepare(
        `UPDATE plugin_tasks
         SET status = 'succeeded', b64_json = ?, image_url = ?, mime = ?, prompt_json = ?,
             rewritten_prompt = ?, success_round = ?, post_review_edited = ?,
             llm_duration_ms = ?, image_duration_ms = ?,
             provider_id = ?, provider_name = ?, attempts = ?,
             completed_at = ?
         WHERE id = ?`,
      )
      .run(
        b64Json,
        imageUrl,
        input.mime,
        input.promptJson,
        rewrittenPromptsJson,
        input.successRound,
        input.postReviewEdited ? 1 : 0,
        input.llmDurationMs,
        input.imageDurationMs,
        input.providerId,
        input.providerName,
        JSON.stringify(input.attempts ?? []),
        Date.now(),
        id,
      );

    if (input.kind === "r2") {
      // Re-read plugin_id / prompt / created_at from the just-updated row so
      // the gallery insert doesn't force every caller to thread those values.
      // Same-transaction read = always sees the UPDATE above.
      const row = db()
        .prepare(
          `SELECT plugin_id, prompt, created_at FROM plugin_tasks WHERE id = ?`,
        )
        .get(id) as
        | { plugin_id: string; prompt: string; created_at: number }
        | undefined;
      if (row) {
        insertPluginGalleryItem({
          id,
          pluginId: row.plugin_id,
          providerId: input.providerId,
          providerName: input.providerName,
          imageUrl: input.imageUrl,
          mime: input.mime,
          prompt: row.prompt,
          promptJson: input.promptJson,
          rewrittenPrompts: input.rewrittenPrompts ?? [],
          successRound: input.successRound,
          postReviewEdited: input.postReviewEdited,
          llmDurationMs: input.llmDurationMs,
          imageDurationMs: input.imageDurationMs,
          createdAt: row.created_at,
        });
      }
    }
  });
  tx();
}

export interface MarkFailedInput {
  errorCode: string;
  errorMsg: string;
  llmDurationMs?: number | null;
  imageDurationMs?: number | null;
  /**
   * Driver attempt trail when the failure happened inside / after the image
   * driver. Empty/omitted when the failure was pre-driver (LLM error, plugin
   * not registered) or post-success (R2 upload — caller should pass the
   * driver's successful trail in that case so the dashboard still shows it).
   */
  attempts?: GenerateImageAttempt[];
  /**
   * Rewrite rounds that ran before this failure. Always populate when the
   * caller has access — diagnostics on failed tasks are exactly when this
   * is most useful.
   */
  rewrittenPrompts?: string[];
}

export function markTaskFailed(id: string, input: MarkFailedInput): void {
  const rewrittenPromptsJson =
    input.rewrittenPrompts && input.rewrittenPrompts.length > 0
      ? JSON.stringify(input.rewrittenPrompts)
      : null;
  db()
    .prepare(
      `UPDATE plugin_tasks
       SET status = 'failed', error_code = ?, error_msg = ?,
           llm_duration_ms = ?, image_duration_ms = ?, attempts = ?,
           rewritten_prompt = ?, completed_at = ?
       WHERE id = ?`,
    )
    .run(
      input.errorCode,
      input.errorMsg,
      input.llmDurationMs ?? null,
      input.imageDurationMs ?? null,
      JSON.stringify(input.attempts ?? []),
      rewrittenPromptsJson,
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
