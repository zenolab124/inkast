import { analyzeVision, VisionRequestError, validateVisionImage, type VisionInput } from "./index.js";
import type { InkastPlugin } from "../../plugins/types.js";
import { getPluginById } from "../../plugins/registry.js";
import { db } from "../../storage/db.js";
import { createVisionJobStore, type VisionJob } from "../../storage/vision-jobs.js";
import { LlmDriverError } from "../../drivers/llm/types.js";

export const DURABLE_VISION_TIMEOUT_MS = 20 * 60_000;
export function publicVisionJob(job: VisionJob) {
  return { id: job.id, status: job.status, created_at: job.created_at, updated_at: job.updated_at,
    ...(job.result_json ? JSON.parse(job.result_json) : {}),
    ...(job.error_json ? { error: JSON.parse(job.error_json) } : {}) };
}
export function createVisionJobRunner(store: ReturnType<typeof createVisionJobStore>, analyze = analyzeVision, resolvePlugin = getPluginById) {
  const active = new Map<string, string>();
  const plugins = new Map<string, InkastPlugin>();
  let scheduling = false;
  const pump = () => {
    if (scheduling) return;
    scheduling = true;
    try {
      store.expireQueued();
      for (const job of store.queued()) {
        if (active.size >= 4) break;
        if ([...active.values()].filter(p => p === job.plugin_id).length >= 2) continue;
        const plugin = plugins.get(job.plugin_id) ?? resolvePlugin(job.plugin_id);
        if (!store.claim(job.plugin_id, job.id)) continue;
        active.set(job.id, job.plugin_id);
        void (async () => {
          try {
            if (!plugin) throw Error("Plugin unavailable");
            // HTTP client disconnects do not cancel this persisted operation.
            const result = await analyze(plugin, job.task_name, JSON.parse(job.input_json), undefined, undefined, DURABLE_VISION_TIMEOUT_MS);
            store.finish(job.plugin_id, job.id, { data: result.data, duration_ms: result.durationMs,
              attempts: result.attempts ?? (result.receipt ? [result.receipt] : []) }, null);
          } catch (error) {
            const llm = error instanceof LlmDriverError;
            const code = llm ? error.code === "timeout" ? "vision_timeout" : "vision_unavailable" : error instanceof VisionRequestError ? error.code : "vision_failed";
            store.finish(job.plugin_id, job.id, null, { code,
              retryable: llm && ["timeout", "backend_unavailable", "rate_limited"].includes(error.code) || error instanceof VisionRequestError && error.status === 429,
              attempts: llm ? error.attempts ?? (error.receipt ? [error.receipt] : []) : [] });
          } finally { active.delete(job.id); pump(); }
        })();
      }
    } finally { scheduling = false; }
  };
  return {
    store,
    async submit(plugin: InkastPlugin, id: string, task: string, input: VisionInput) {
      if (!Object.hasOwn(plugin.visionTasks ?? {}, task)) throw new VisionRequestError("vision_task_unavailable", 403, "Vision task is not enabled");
      if (input.images.length < 1 || input.images.length > plugin.visionTasks![task]!.maxImages || JSON.stringify(input.context ?? {}).length > 96000) throw new VisionRequestError("invalid_input", 400, "Invalid vision input");
      for (const image of input.images) await validateVisionImage(image.url, plugin);
      plugins.set(plugin.id, plugin);
      const job = store.submit(plugin.id, id, task, input);
      pump();
      return job;
    },
    start() { store.interruptRunning(); pump(); },
  };
}
let runner: ReturnType<typeof createVisionJobRunner> | undefined;
export const visionJobRunner = () => runner ??= createVisionJobRunner(createVisionJobStore(db()));
