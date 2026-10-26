import type Database from "better-sqlite3";
import { randomBytes, createHash } from "node:crypto";
import { db } from "./db.js";

export interface V2Job {
  id: string; plugin_id: string; owner_key: string; source_task_id: string; source_url: string; input_kind: "existing" | "generated"; creation_json: string | null; card_stats_json: string | null;
  status: string; stage: string; lease_hash: string | null; lease_until: number;
  deliveries: number; created_at: number; updated_at: number; image_url: string | null; pipeline_revision: string | null;
  source_sha256: string | null; code_sha256: string | null; error_code: string | null; geometry_json: string | null;
}
export class V2QueueError extends Error {
  constructor(public code: string, public status: 409 | 429 | 503) { super(code); }
}
export const V2_BILLING_VERSION = 1;
export const V2_CONCURRENCY = { generated: 5, existing: 1 } as const;
const digest = (v: string) => createHash("sha256").update(v).digest("hex");
export function createV2Store(conn: Database.Database, clock = Date.now) {
  const get = (plugin: string, id: string) => conn.prepare("SELECT * FROM static_v2_jobs WHERE plugin_id=? AND id=?").get(plugin, id) as V2Job | undefined;
  const online = (plugin: string) => !!conn.prepare("SELECT 1 FROM static_v2_workers WHERE plugin_id=? AND seen_at>?").get(plugin, clock() - 120_000);
  const leased = (plugin: string, id: string, token: string) => {
    const row = get(plugin, id);
    if (!row || row.status !== "running" || row.lease_hash !== digest(token) || row.lease_until <= clock()) throw new V2QueueError("lease_lost", 409);
    return row;
  };
  const heartbeat = (plugin: string, worker: string, revision: string) => {
    conn.prepare("INSERT INTO static_v2_workers(plugin_id,worker_id,revision,seen_at) VALUES(?,?,?,?) ON CONFLICT(plugin_id) DO UPDATE SET worker_id=excluded.worker_id,revision=excluded.revision,seen_at=excluded.seen_at").run(plugin, worker, revision, clock());
  };
  return {
    get, online, leased, heartbeat,
    layer(plugin: string, id: string, name: string): string | undefined {
      if (!get(plugin, id)) return undefined;
      return (conn.prepare("SELECT state_json FROM static_v2_layers WHERE job_id=? AND layer=?").get(id, name) as { state_json: string } | undefined)?.state_json;
    },
    saveLayer(plugin: string, id: string, token: string, name: string, state: string) {
      leased(plugin, id, token);
      conn.prepare("INSERT INTO static_v2_layers(job_id,layer,state_json) VALUES(?,?,?) ON CONFLICT(job_id,layer) DO UPDATE SET state_json=excluded.state_json").run(id, name, state);
    },
    list(plugin: string, owner: string, limit: number, before?: { time: number; id: string }) {
      const stamp = "CASE WHEN status='succeeded' THEN updated_at ELSE created_at END";
      const rows = conn.prepare(`SELECT * FROM static_v2_jobs WHERE plugin_id=? AND owner_key=? ${before ? `AND (${stamp}<? OR (${stamp}=? AND id<?))` : ""} ORDER BY ${stamp} DESC,id DESC LIMIT ?`).all(
        plugin, owner, ...(before ? [before.time, before.time, before.id] : []), limit + 1,
      ) as V2Job[];
      const items = rows.slice(0, limit), last = items.at(-1);
      return { items, next: rows.length > limit && last ? { time: last.status === "succeeded" ? last.updated_at : last.created_at, id: last.id } : null };
    },
    submit: conn.transaction((input: { id: string; plugin: string; owner: string; task: string; source: string; billingVersion?: number; creation?: { prompt: string }; cardStats?: object }) => {
      const old = get(input.plugin, input.id);
      if (old) {
        if (old.card_stats_json !== (input.cardStats ? JSON.stringify(input.cardStats) : null) || old.owner_key !== input.owner || old.source_task_id !== input.task || old.source_url !== input.source || old.creation_json !== (input.creation ? JSON.stringify(input.creation) : null)) throw new V2QueueError("idempotency_conflict", 409);
        return old;
      }
      if (!online(input.plugin)) throw new V2QueueError("worker_unavailable", 503);
      if (input.billingVersion !== V2_BILLING_VERSION) throw new V2QueueError("billing_required", 409);
      if ((conn.prepare("SELECT count(*) n FROM static_v2_jobs WHERE status IN ('queued','running')").get() as { n: number }).n >= 16) throw new V2QueueError("queue_full", 429);
      conn.prepare("INSERT INTO static_v2_jobs(id,plugin_id,owner_key,source_task_id,source_url,input_kind,creation_json,card_stats_json,status,stage,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'queued','queued',?,?)").run(input.id, input.plugin, input.owner, input.task, input.source, input.creation ? "generated" : "existing", input.creation ? JSON.stringify(input.creation) : null, input.cardStats ? JSON.stringify(input.cardStats) : null, clock(), clock());
      return get(input.plugin, input.id)!;
    }),
    claim: conn.transaction((plugin: string, worker: string, revision: string, enabled: boolean, allowExisting = true, allowGenerated = true, excludeIds: string[] = []) => {
      if (!enabled) return null;
      const skip = excludeIds.length ? ` AND id NOT IN (${excludeIds.map(() => "?").join(",")})` : "";
      conn.prepare("UPDATE static_v2_jobs SET status='failed',stage='failed',error_code='pipeline_changed',updated_at=? WHERE plugin_id=? AND status IN ('queued','running') AND lease_until<=? AND pipeline_revision IS NOT NULL AND pipeline_revision<>?" + skip).run(clock(), plugin, clock(), revision, ...excludeIds);
      conn.prepare("UPDATE static_v2_jobs SET status='failed',stage='failed',error_code='recovery_limit',updated_at=? WHERE plugin_id=? AND status IN ('queued','running') AND lease_until<=? AND deliveries>=3" + skip).run(clock(), plugin, clock(), ...excludeIds);
      // Limits are global per route, independent of owner and worker. Only
      // valid running leases consume capacity; expired leases remain fenced.
      const active = conn.prepare("SELECT input_kind,count(*) n FROM static_v2_jobs WHERE status='running' AND lease_until>? GROUP BY input_kind").all(clock()) as Array<{input_kind: string; n: number}>;
      const available = (kind: keyof typeof V2_CONCURRENCY) => (active.find(row => row.input_kind === kind)?.n ?? 0) < V2_CONCURRENCY[kind];
      const existing = allowExisting && available("existing"), generated = allowGenerated && available("generated");
      if (!existing && !generated) return null;
      const row = conn.prepare(`SELECT j.* FROM static_v2_jobs j
        WHERE j.plugin_id=? AND j.status IN ('queued','running') AND j.lease_until<=? ${skip.replaceAll('id NOT IN', 'j.id NOT IN')}
        AND ((? AND j.input_kind='existing') OR (? AND j.input_kind='generated'))
        AND (j.input_kind='generated' OR NOT EXISTS (SELECT 1 FROM static_v2_jobs head
          WHERE head.plugin_id=j.plugin_id AND head.owner_key=j.owner_key AND head.input_kind='existing'
          AND head.status IN ('queued','running')
          AND (head.created_at<j.created_at OR (head.created_at=j.created_at AND head.rowid<j.rowid))))
        ORDER BY j.created_at,j.rowid LIMIT 1`).get(plugin, clock(), ...excludeIds, Number(existing), Number(generated)) as V2Job | undefined;
      if (!row) return null;
      const token = randomBytes(32).toString("hex");
      conn.prepare("UPDATE static_v2_jobs SET status='running',stage='starting',lease_hash=?,lease_until=?,deliveries=deliveries+1,pipeline_revision=?,updated_at=? WHERE id=?").run(digest(token), clock() + 180_000, revision, clock(), row.id);
      return { ...get(plugin, row.id)!, leaseToken: token };
    }),
    defer: conn.transaction((plugin: string, id: string, token: string, retryAfterMs: number, stage: 'check_retry_wait' | 'plan_retry_wait' = 'check_retry_wait') => {
      const old = get(plugin, id);
      // An acknowledgement retry cannot keep pushing the cooldown into the future.
      if (old?.lease_hash === digest(token) && ((old.status === "queued" && old.stage === stage) || (old.status === "failed" && old.error_code === "recovery_limit"))) return old;
      const row = leased(plugin, id, token);
      const allowedStage = stage === 'plan_retry_wait' ? /^plan/.test(row.stage) : stage === 'check_retry_wait' && (/^check/.test(row.stage) || row.stage === "recovery_wait");
      if (!Number.isSafeInteger(retryAfterMs) || retryAfterMs < 60000 || retryAfterMs > 300000 || !allowedStage) throw new V2QueueError("invalid_recovery", 409);
      if (row.deliveries >= 3) {
        conn.prepare("UPDATE static_v2_jobs SET status='failed',stage='failed',error_code='recovery_limit',updated_at=? WHERE plugin_id=? AND id=?").run(clock(), plugin, id);
      } else {
        conn.prepare("UPDATE static_v2_jobs SET status='queued',stage=?,lease_until=?,error_code=NULL,updated_at=? WHERE plugin_id=? AND id=?").run(stage, clock() + retryAfterMs, clock(), plugin, id);
      }
      return get(plugin, id)!;
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
