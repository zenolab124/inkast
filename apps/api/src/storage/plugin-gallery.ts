import { db } from "./db.js";

/**
 * Plugin gallery storage — long-lived archive of every succeeded plugin task
 * that has a public R2 URL. Decoupled from `plugin_tasks` (which is GC'd at
 * 24h): each successful r2-mode task synchronously writes a row here inside
 * the same transaction as markTaskSucceeded, and this table is NEVER GC'd.
 *
 * The b64-mode path doesn't insert here by design — those bytes are transient
 * (lost when plugin_tasks GC'd) and can't be re-served from a URL anyway.
 */

export interface PluginGalleryRecord {
  id: string;
  pluginId: string;
  providerId: string | null;
  providerName: string | null;
  imageUrl: string;
  mime: string | null;
  prompt: string;
  finalPromptText: string | null;
  promptJson: string | null;
  rewrittenPrompts: string[];
  successRound: 0 | 1 | 2 | 3;
  postReviewEdited: boolean;
  llmDurationMs: number | null;
  imageDurationMs: number | null;
  createdAt: number;
}

export interface InsertPluginGalleryItemInput {
  id: string;
  pluginId: string;
  providerId: string | null;
  providerName: string | null;
  imageUrl: string;
  mime: string | null;
  prompt: string;
  finalPromptText: string | null;
  promptJson: string | null;
  rewrittenPrompts: string[];
  successRound: 0 | 1 | 2 | 3;
  postReviewEdited: boolean;
  llmDurationMs: number | null;
  imageDurationMs: number | null;
  createdAt: number;
}

/**
 * Idempotent insert keyed by task id. `INSERT OR IGNORE` so re-running the
 * backfill on startup or accidental double-insert during a task lifecycle
 * never duplicates. Returns true iff a new row landed.
 */
export function insertPluginGalleryItem(input: InsertPluginGalleryItemInput): boolean {
  const result = db()
    .prepare(
      `INSERT OR IGNORE INTO plugin_gallery_items
        (id, plugin_id, provider_id, provider_name, image_url, mime,
         prompt, final_prompt_text, prompt_json, rewritten_prompts, success_round,
         post_review_edited, llm_duration_ms, image_duration_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.id,
      input.pluginId,
      input.providerId,
      input.providerName,
      input.imageUrl,
      input.mime,
      input.prompt,
      input.finalPromptText,
      input.promptJson,
      input.rewrittenPrompts.length > 0 ? JSON.stringify(input.rewrittenPrompts) : null,
      input.successRound,
      input.postReviewEdited ? 1 : 0,
      input.llmDurationMs,
      input.imageDurationMs,
      input.createdAt,
    );
  return result.changes > 0;
}

interface DbRow {
  id: string;
  plugin_id: string;
  provider_id: string | null;
  provider_name: string | null;
  image_url: string;
  mime: string | null;
  prompt: string;
  final_prompt_text: string | null;
  prompt_json: string | null;
  rewritten_prompts: string | null;
  success_round: number;
  post_review_edited: number;
  llm_duration_ms: number | null;
  image_duration_ms: number | null;
  created_at: number;
}

function rowToRecord(row: DbRow): PluginGalleryRecord {
  return {
    id: row.id,
    pluginId: row.plugin_id,
    providerId: row.provider_id,
    providerName: row.provider_name,
    imageUrl: row.image_url,
    mime: row.mime,
    prompt: row.prompt,
    finalPromptText: row.final_prompt_text,
    promptJson: row.prompt_json,
    rewrittenPrompts: parseRewritten(row.rewritten_prompts),
    successRound: (row.success_round as 0 | 1 | 2 | 3),
    postReviewEdited: row.post_review_edited === 1,
    llmDurationMs: row.llm_duration_ms,
    imageDurationMs: row.image_duration_ms,
    createdAt: row.created_at,
  };
}

function parseRewritten(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export interface ListPluginGalleryQuery {
  /** Optional cursor: results strictly older than this `<createdAt>_<id>`. */
  cursor?: string | null;
  /** Max rows to return. */
  limit: number;
  /** Optional plugin id filter. */
  pluginId?: string | null;
}

export interface ListPluginGalleryResult {
  items: PluginGalleryRecord[];
  /** Cursor to pass for the next page; null when no more rows. */
  nextCursor: string | null;
}

/**
 * Keyset pagination on `(created_at DESC, id DESC)` — stable even when new rows
 * land at the head while the user is scrolling. Cursor format: `<createdAt>_<id>`.
 */
export function listPluginGallery(query: ListPluginGalleryQuery): ListPluginGalleryResult {
  const limit = Math.min(200, Math.max(1, query.limit));
  const cursor = parseCursor(query.cursor ?? null);
  const pluginId = query.pluginId?.trim() || null;

  const where: string[] = [];
  const params: Array<string | number> = [];
  if (cursor) {
    // Strictly "older than" the cursor row (created_at, id) — handles ties on
    // created_at by also comparing id lexicographically.
    where.push("(created_at < ? OR (created_at = ? AND id < ?))");
    params.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }
  if (pluginId) {
    where.push("plugin_id = ?");
    params.push(pluginId);
  }
  const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

  const rows = db()
    .prepare(
      `SELECT id, plugin_id, provider_id, provider_name, image_url, mime,
              prompt, final_prompt_text, prompt_json, rewritten_prompts, success_round,
              post_review_edited, llm_duration_ms, image_duration_ms, created_at
       FROM plugin_gallery_items
       ${whereClause}
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
    )
    .all(...params, limit + 1) as DbRow[];

  const hasMore = rows.length > limit;
  const page = (hasMore ? rows.slice(0, limit) : rows).map(rowToRecord);
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? `${last.createdAt}_${last.id}` : null;
  return { items: page, nextCursor };
}

function parseCursor(raw: string | null): { createdAt: number; id: string } | null {
  if (!raw) return null;
  const idx = raw.indexOf("_");
  if (idx <= 0) return null;
  const createdAt = Number(raw.slice(0, idx));
  const id = raw.slice(idx + 1);
  if (!Number.isFinite(createdAt) || !id) return null;
  return { createdAt, id };
}

/** Per-plugin counts for the filter chip bar. Cheap (single GROUP BY). */
export interface PluginCount {
  pluginId: string;
  count: number;
}

export function pluginGalleryCountsByPlugin(): PluginCount[] {
  const rows = db()
    .prepare(
      `SELECT plugin_id AS pluginId, COUNT(*) AS count
       FROM plugin_gallery_items
       GROUP BY plugin_id
       ORDER BY count DESC, pluginId ASC`,
    )
    .all() as Array<{ pluginId: string; count: number }>;
  return rows.map(r => ({ pluginId: r.pluginId, count: r.count }));
}

export function pluginGalleryTotal(): number {
  const row = db()
    .prepare(`SELECT COUNT(*) AS n FROM plugin_gallery_items`)
    .get() as { n: number };
  return row.n;
}

/**
 * One-shot startup backfill: copy every still-alive `plugin_tasks` row that
 * succeeded with an `image_url` into `plugin_gallery_items`. Idempotent via
 * `INSERT OR IGNORE` on id. Skips when the gallery already has more rows than
 * the cap (cheap guard against re-scanning a populated table on every boot).
 *
 * GC-deleted history is unrecoverable — only currently-resident rows.
 */
export function backfillPluginGalleryFromTasks(): { scanned: number; inserted: number } {
  const rows = db()
    .prepare(
      `SELECT id, plugin_id, provider_id, provider_name, image_url, mime,
              prompt, final_prompt_text, prompt_json, rewritten_prompt, success_round,
              post_review_edited, llm_duration_ms, image_duration_ms, created_at
       FROM plugin_tasks
       WHERE image_url IS NOT NULL
         AND status IN ('succeeded', 'callback_lost')
         AND success_round IS NOT NULL`,
    )
    .all() as Array<{
      id: string;
      plugin_id: string;
      provider_id: string | null;
      provider_name: string | null;
      image_url: string;
      mime: string | null;
      prompt: string;
      final_prompt_text: string | null;
      prompt_json: string | null;
      rewritten_prompt: string | null;
      success_round: number;
      post_review_edited: number | null;
      llm_duration_ms: number | null;
      image_duration_ms: number | null;
      created_at: number;
    }>;

  let inserted = 0;
  const tx = db().transaction(() => {
    for (const r of rows) {
      const ok = insertPluginGalleryItem({
        id: r.id,
        pluginId: r.plugin_id,
        providerId: r.provider_id,
        providerName: r.provider_name,
        imageUrl: r.image_url,
        mime: r.mime,
        prompt: r.prompt,
        finalPromptText: r.final_prompt_text,
        promptJson: r.prompt_json,
        rewrittenPrompts: parseRewritten(r.rewritten_prompt),
        successRound: (r.success_round as 0 | 1 | 2 | 3),
        postReviewEdited: r.post_review_edited === 1,
        llmDurationMs: r.llm_duration_ms,
        imageDurationMs: r.image_duration_ms,
        createdAt: r.created_at,
      });
      if (ok) inserted += 1;
    }
  });
  tx();
  return { scanned: rows.length, inserted };
}
