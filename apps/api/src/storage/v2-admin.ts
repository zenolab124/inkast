import type Database from "better-sqlite3";
import { db } from "./db.js";

const creation = "CASE WHEN json_valid(j.creation_json) THEN j.creation_json ELSE '{}' END";
const layerState = "CASE WHEN json_valid(l.state_json) THEN l.state_json ELSE '{}' END";

/** Read the durable 3D queue directly; never create ordinary generation tasks
 * or count intermediate layers as successfully delivered cards. */
export function getV2AdminSnapshot(since: number, conn: Database.Database = db(), now = Date.now()) {
  const overview = conn.prepare("SELECT status, count(*) AS count FROM static_v2_jobs WHERE created_at>=? GROUP BY status").all(since) as Array<{ status: string; count: number }>;
  const byPlugin = conn.prepare("SELECT plugin_id AS pluginId,status,count(*) AS count FROM static_v2_jobs WHERE created_at>=? GROUP BY plugin_id,status").all(since) as Array<{ pluginId: string; status: string; count: number }>;
  const errors = conn.prepare("SELECT error_code AS code,count(*) AS count FROM static_v2_jobs WHERE created_at>=? AND error_code IS NOT NULL GROUP BY error_code").all(since) as Array<{ code: string; count: number }>;
  const buckets = conn.prepare(`SELECT strftime('%Y-%m-%d %H:00',created_at/1000,'unixepoch','+8 hours') AS hour,
    count(*) AS total,SUM(CASE WHEN status='succeeded' THEN 1 ELSE 0 END) AS succeeded,
    SUM(CASE WHEN status IN ('failed','needs_review') THEN 1 ELSE 0 END) AS failed
    FROM static_v2_jobs WHERE created_at>=? GROUP BY hour ORDER BY hour`).all(now - 24 * 60 * 60 * 1000) as Array<{ hour: string; total: number; succeeded: number; failed: number }>;
  const recent = conn.prepare(`SELECT id,plugin_id AS pluginId,input_kind AS inputKind,status,stage,
    deliveries,error_code AS errorCode,created_at AS createdAt,updated_at AS updatedAt,image_url AS imageUrl
    FROM static_v2_jobs ORDER BY created_at DESC,id DESC LIMIT 50`).all() as Array<{
      id: string; pluginId: string; inputKind: string; status: string; stage: string; deliveries: number;
      errorCode: string | null; createdAt: number; updatedAt: number; imageUrl: string | null;
    }>;
  return { overview, byPlugin, errors, buckets, total: overview.reduce((n, r) => n + r.count, 0), recent: recent.map(job => ({
    ...job, elapsedMs: Math.max(0, (["queued", "running"].includes(job.status) ? now : job.updatedAt) - job.createdAt),
    layers: (conn.prepare("SELECT layer,state_json FROM static_v2_layers WHERE job_id=? ORDER BY layer").all(job.id) as Array<{ layer: string; state_json: string }>).map(row => {
      let state: Record<string, unknown> = {};
      try { state = JSON.parse(row.state_json) ?? {}; } catch {}
      return { layer: row.layer, status: String(state.status ?? "unknown"), upstreamStatus: String(state.upstreamStatus ?? "unknown"),
        taskId: typeof state.taskId === "string" ? state.taskId : null,
        imageUrl: state.status === "succeeded" && typeof state.imageUrl === "string" ? state.imageUrl : null,
        errorCode: typeof state.errorCode === "string" ? state.errorCode : null,
        lastPolledAt: typeof state.lastPolledAt === "number" ? state.lastPolledAt : null };
    }),
  })) };
}
export type V2AdminSnapshot = ReturnType<typeof getV2AdminSnapshot>;

/** Common gallery row shape, queried without mutating historical tasks. */
export const V2_GALLERY_SQL = `
 SELECT j.id,j.plugin_id,NULL AS provider_id,NULL AS provider_name,j.image_url,CASE WHEN lower(j.image_url) LIKE '%.png' THEN 'image/png' ELSE 'image/webp' END AS mime,
   COALESCE(json_extract(${creation},'$.prompt'),'') AS prompt,NULL AS final_prompt_text,
   NULL AS prompt_json,NULL AS rewritten_prompts,0 AS success_round,0 AS post_review_edited,
   NULL AS llm_duration_ms,NULL AS image_duration_ms,j.updated_at AS created_at,'3d_card' AS artifact_kind
 FROM static_v2_jobs j WHERE j.status='succeeded' AND j.image_url IS NOT NULL
 UNION ALL
 SELECT j.id || ':' || l.layer,j.plugin_id,json_extract(${layerState},'$.providerId'),p.name,
   json_extract(${layerState},'$.imageUrl'),'image/png',
   COALESCE(json_extract(${creation},'$.prompt'),''),NULL,NULL,NULL,0,0,NULL,NULL,
   COALESCE(json_extract(${layerState},'$.completedAt'),json_extract(${layerState},'$.createdAt'),j.created_at),
   CASE WHEN l.layer='foreground' THEN '3d_foreground' ELSE '3d_background' END
 FROM static_v2_layers l JOIN static_v2_jobs j ON j.id=l.job_id
 LEFT JOIN providers p ON p.id=json_extract(${layerState},'$.providerId')
 WHERE l.layer IN ('foreground','background') AND json_extract(${layerState},'$.status')='succeeded'
   AND json_extract(${layerState},'$.imageUrl') IS NOT NULL`;
