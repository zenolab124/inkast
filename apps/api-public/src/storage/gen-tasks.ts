import { db } from "./db.js";

export type GenChannel = "passthrough" | "builtin";
export type GenStatus = "pending" | "success" | "failed" | "aborted";

export interface GenTaskRow {
  id: string;
  user_id: number;
  prompt_json: string;
  channel: GenChannel;
  model: string | null;
  cost: number;
  status: GenStatus;
  image_url: string | null;
  error_code: string | null;
  created_at: number;
  completed_at: number | null;
}

export interface CreateGenTaskInput {
  id: string;
  userId: number;
  promptJson: string;
  channel: GenChannel;
  model?: string;
  cost?: number;
}

export function createGenTask(input: CreateGenTaskInput): void {
  db().prepare(
    `INSERT INTO gen_tasks (id, user_id, prompt_json, channel, model, cost, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
  ).run(
    input.id,
    input.userId,
    input.promptJson,
    input.channel,
    input.model ?? null,
    input.cost ?? 0,
    Date.now(),
  );
}

export function markGenTaskSuccess(id: string, imageUrl: string): void {
  db().prepare(
    `UPDATE gen_tasks SET status='success', image_url=?, completed_at=? WHERE id=?`,
  ).run(imageUrl, Date.now(), id);
}

export function markGenTaskFailed(id: string, errorCode: string): void {
  db().prepare(
    `UPDATE gen_tasks SET status='failed', error_code=?, completed_at=? WHERE id=?`,
  ).run(errorCode, Date.now(), id);
}

export function findGenTaskById(id: string): GenTaskRow | null {
  const row = db().prepare(`SELECT * FROM gen_tasks WHERE id=?`).get(id) as
    | GenTaskRow
    | undefined;
  return row ?? null;
}

export function listGenTasksByUser(userId: number, limit = 50): GenTaskRow[] {
  return db().prepare(
    `SELECT * FROM gen_tasks WHERE user_id=? ORDER BY created_at DESC LIMIT ?`,
  ).all(userId, limit) as GenTaskRow[];
}
