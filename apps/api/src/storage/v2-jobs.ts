import type Database from "better-sqlite3";
import { randomBytes, createHash } from "node:crypto";
import { db } from "./db.js";

export interface V2Job {
  id: string; plugin_id: string; owner_key: string; source_task_id: string; source_url: string;
  status: string; stage: string; lease_hash: string | null; lease_until: number;
  deliveries: number; created_at: number; updated_at: number; image_url: string | null; pipeline_revision: string | null;
  source_sha256: string | null; code_sha256: string | null; error_code: string | null; geometry_json: string | null;
}
export class V2QueueError extends Error {
  constructor(public code: string, public status: 409 | 429 | 503) { super(code); }
}
export const V2_DAILY_LIMIT = 3;
const digest = (v: string) => createHash("sha256").update(v).digest("hex");
export function createV2Store(conn: Database.Database, clock = Date.now) {
  const get = (plugin: string, id: string) => conn.prepare("SELECT * FROM static_v2_jobs WHERE plugin_id=? AND id=?").get(plugin, id) as V2Job | undefined;
  const online = (plugin: string) => !!conn.prepare("SELECT 1 FROM static_v2_workers WHERE plugin_id=? AND seen_at>?").get(plugin, clock() - 120_000);
  const leased = (plugin: string, id: string, token: string) => {
    const row = get(plugin, id);
    if (!row || row.status !== "running" || row.lease_hash !== digest(token) || row.lease_until <= clock()) throw new V2QueueError("lease_lost", 409);
    return row;
  };
  return {
    get, online, leased,
    list(plugin: string, owner: string, limit: number, before?: { time: number; id: string }) {
      const stamp = "CASE WHEN status='succeeded' THEN updated_at ELSE created_at END";
      const rows = conn.prepare(`SELECT * FROM static_v2_jobs WHERE plugin_id=? AND owner_key=? ${before ? `AND (${stamp}<? OR (${stamp}=? AND id<?))` : ""} ORDER BY ${stamp} DESC,id DESC LIMIT ?`).all(
        plugin, owner, ...(before ? [before.time, before.time, before.id] : []), limit + 1,
      ) as V2Job[];
      const items = rows.slice(0, limit), last = items.at(-1);
      return { items, next: rows.length > limit && last ? { time: last.status === "succeeded" ? last.updated_at : last.created_at, id: last.id } : null };
    },
    submit: conn.transaction((input: { id: string; plugin: string; owner: string; task: string; source: string }) => {
      const old = get(input.plugin, input.id);
      if (old) {
        if (old.owner_key !== input.owner || old.source_task_id !== input.task || old.source_url !== input.source) throw new V2QueueError("idempotency_conflict", 409);
        return old;
      }
      if (!online(input.plugin)) throw new V2QueueError("worker_unavailable", 503);
      const count = (sql: string, ...args: Array<string | number>) => (conn.prepare(sql).get(...args) as { n: number }).n;
      if (count("SELECT count(*) n FROM static_v2_jobs WHERE plugin_id=? AND owner_key=? AND created_at>?", input.plugin, input.owner, clock() - 86400_000) >= V2_DAILY_LIMIT) throw new V2QueueError("daily_limit", 429);
      if (count("SELECT count(*) n FROM static_v2_jobs WHERE plugin_id=? AND owner_key=? AND status IN ('queued','running')", input.plugin, input.owner)) throw new V2QueueError("owner_busy", 429);
      if (count("SELECT count(*) n FROM static_v2_jobs WHERE plugin_id=? AND owner_key=? AND source_task_id=? AND source_url=?", input.plugin, input.owner, input.task, input.source) >= 2) throw new V2QueueError("retry_limit", 429);
      if (count("SELECT count(*) n FROM static_v2_jobs WHERE status IN ('queued','running')") >= 16) throw new V2QueueError("queue_full", 429);
      conn.prepare("INSERT INTO static_v2_jobs(id,plugin_id,owner_key,source_task_id,source_url,status,stage,created_at,updated_at) VALUES(?,?,?,?,?,'queued','queued',?,?)").run(input.id, input.plugin, input.owner, input.task, input.source, clock(), clock());
      return get(input.plugin, input.id)!;
    }),
    claim: conn.transaction((plugin: string, worker: string, revision: string, enabled: boolean) => {
      conn.prepare("INSERT INTO static_v2_workers(plugin_id,worker_id,revision,seen_at) VALUES(?,?,?,?) ON CONFLICT(plugin_id) DO UPDATE SET worker_id=excluded.worker_id,revision=excluded.revision,seen_at=excluded.seen_at").run(plugin, worker, revision, clock());
      if (!enabled) return null;
      conn.prepare("UPDATE static_v2_jobs SET status='failed',stage='failed',error_code='pipeline_changed',updated_at=? WHERE plugin_id=? AND status='running' AND lease_until<=? AND pipeline_revision IS NOT NULL AND pipeline_revision<>?").run(clock(), plugin, clock(), revision);
      conn.prepare("UPDATE static_v2_jobs SET status='failed',stage='failed',error_code='recovery_limit',updated_at=? WHERE plugin_id=? AND status='running' AND lease_until<=? AND deliveries>=3").run(clock(), plugin, clock());
      if (conn.prepare("SELECT 1 FROM static_v2_jobs WHERE status='running' AND lease_until>?").get(clock())) return null;
      const row = conn.prepare("SELECT * FROM static_v2_jobs WHERE plugin_id=? AND (status='queued' OR (status='running' AND lease_until<=?)) ORDER BY created_at,id LIMIT 1").get(plugin, clock()) as V2Job | undefined;
      if (!row) return null;
      const token = randomBytes(32).toString("hex");
      conn.prepare("UPDATE static_v2_jobs SET status='running',stage='starting',lease_hash=?,lease_until=?,deliveries=deliveries+1,pipeline_revision=?,updated_at=? WHERE id=?").run(digest(token), clock() + 180_000, revision, clock(), row.id);
      return { ...get(plugin, row.id)!, leaseToken: token };
    }),
    renew(plugin: string, id: string, token: string, stage: string) {
      leased(plugin, id, token);
      conn.prepare("UPDATE static_v2_jobs SET stage=?,lease_until=?,updated_at=? WHERE plugin_id=? AND id=? AND lease_hash=?").run(stage, clock() + 180_000, clock(), plugin, id, digest(token));
      conn.prepare("UPDATE static_v2_workers SET seen_at=? WHERE plugin_id=?").run(clock(), plugin);
    },
    finish(plugin: string, id: string, token: string, result: { status: string; imageUrl?: string; geometry?: object; sourceSha256?: string; codeSha256?: string; errorCode?: string }) {
      const old = get(plugin, id);
      if (old && old.lease_hash === digest(token) && ["succeeded", "needs_review", "failed"].includes(old.status)) return old;
      leased(plugin, id, token);
      conn.prepare("UPDATE static_v2_jobs SET status=?,stage=?,image_url=?,geometry_json=?,source_sha256=?,code_sha256=?,error_code=?,updated_at=? WHERE plugin_id=? AND id=? AND lease_hash=?").run(result.status, result.status, result.imageUrl ?? null, result.geometry ? JSON.stringify(result.geometry) : null, result.sourceSha256 ?? null, result.codeSha256 ?? null, result.errorCode ?? null, clock(), plugin, id, digest(token));
      return get(plugin, id)!;
    },
  };
}
export const v2Store = () => createV2Store(db());
