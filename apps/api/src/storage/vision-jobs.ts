import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import type { VisionInput } from "../domain/vision/index.js";

export interface VisionJob {
  id: string; plugin_id: string; task_name: string; input_hash: string; input_json: string;
  status: "queued" | "running" | "succeeded" | "failed";
  created_at: number; updated_at: number; started_at: number | null;
  result_json: string | null; error_json: string | null;
}
export class VisionJobError extends Error {
  constructor(public code: string, public status: 404 | 409 | 429) { super(code); }
}
export function createVisionJobStore(conn: Database.Database, clock = Date.now) {
  const get = (plugin: string, id: string) => conn.prepare("SELECT * FROM plugin_vision_jobs WHERE plugin_id=? AND id=?").get(plugin, id) as VisionJob | undefined;
  return {
    get,
    submit: conn.transaction((plugin: string, id: string, task: string, input: VisionInput) => {
      const payload = JSON.stringify(input), fingerprint = createHash("sha256").update(task + "\n" + payload).digest("hex");
      const old = get(plugin, id);
      if (old) {
        if (old.input_hash !== fingerprint) throw new VisionJobError("vision_idempotency_conflict", 409);
        return old;
      }
      if (conn.prepare("SELECT 1 FROM plugin_vision_jobs WHERE id=?").get(id)) throw new VisionJobError("vision_idempotency_conflict", 409);
      if ((conn.prepare("SELECT count(*) n FROM plugin_vision_jobs WHERE status IN ('queued','running')").get() as { n: number }).n >= 16) throw new VisionJobError("vision_queue_full", 429);
      conn.prepare("INSERT INTO plugin_vision_jobs(id,plugin_id,task_name,input_hash,input_json,status,created_at,updated_at) VALUES(?,?,?,?,?,'queued',?,?)").run(id, plugin, task, fingerprint, payload, clock(), clock());
      return get(plugin, id)!;
    }),
    queued() { return conn.prepare("SELECT * FROM plugin_vision_jobs WHERE status='queued' ORDER BY created_at,id").all() as VisionJob[]; },
    claim(plugin: string, id: string) {
      return conn.prepare("UPDATE plugin_vision_jobs SET status='running',started_at=?,updated_at=? WHERE plugin_id=? AND id=? AND status='queued'").run(clock(), clock(), plugin, id).changes === 1;
    },
    finish(plugin: string, id: string, result: object | null, error: object | null) {
      return conn.prepare("UPDATE plugin_vision_jobs SET status=?,result_json=?,error_json=?,input_json='{}',updated_at=? WHERE plugin_id=? AND id=? AND status='running'").run(error ? "failed" : "succeeded", result ? JSON.stringify(result) : null, error ? JSON.stringify(error) : null, clock(), plugin, id).changes === 1;
    },
    expireQueued() {
      conn.prepare("UPDATE plugin_vision_jobs SET status='failed',error_json=?,input_json='{}',updated_at=? WHERE status='queued' AND created_at<?").run(JSON.stringify({ code: "vision_queue_expired", retryable: false }), clock(), clock() - 30 * 60_000);
    },
    interruptRunning() {
      // A restarted process cannot prove whether its previous upstream request was
      // billed. Never silently replay it; retain an explicit unknown outcome.
      conn.prepare("UPDATE plugin_vision_jobs SET status='failed',error_json=?,input_json='{}',updated_at=? WHERE status='running'").run(JSON.stringify({ code: "vision_interrupted", retryable: false, billing_unknown: true }), clock());
    },
  };
}
