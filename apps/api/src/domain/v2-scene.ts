import { createHash } from "node:crypto";
import sharp from "sharp";
import type { InkastPlugin } from "../plugins/types.js";
import { createV2Store, V2QueueError, type V2Job } from "../storage/v2-jobs.js";
import { visionJobRunner } from "./vision/jobs.js";
import type { VisionInput } from "./vision/index.js";
import { parseSceneLayout, type SceneLayout } from "./vision/scene-layout.js";
interface State { version: 1; id: string; sha: string; createdAt: number; input: VisionInput; width: number; height: number; result?: SceneLayout; error?: string; admitted?: boolean; }
export async function pollV2Scene(args: { store: ReturnType<typeof createV2Store>; plugin: InkastPlugin; job: V2Job; token: string; sha: string; read: () => Promise<Buffer>; brief: string }, dependencies: { runner?: ReturnType<typeof visionJobRunner>; now?: () => number } = {}): Promise<{ status: "pending" | "failed" | "succeeded"; layout?: SceneLayout; errorCode?: string }> {
  const { store, plugin, job, token, sha, read, brief } = args, now = dependencies.now ?? Date.now;
  store.leased(plugin.id, job.id, token);
  let raw = store.layer(plugin.id, job.id, "scene-layout"), state = raw ? JSON.parse(raw) as State : null;
  const save = () => { const next = JSON.stringify(state); if (!store.compareAndSaveLayer(plugin.id, job.id, token, "scene-layout", raw, next)) throw new V2QueueError("generation_busy", 409); raw = next; };
  if (!state) {
    const bytes = await read();
    if (createHash("sha256").update(bytes).digest("hex") !== sha) throw new V2QueueError("invalid_generated_layer", 409);
    const meta = await sharp(bytes).metadata();
    if (!meta.width || !meta.height || !meta.hasAlpha) throw new V2QueueError("invalid_generated_layer", 409);
    const preview = await sharp(bytes).resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true }).flatten({ background: "#eee9df" }).jpeg({ quality: 86 }).toBuffer();
    state = { version: 1, id: `vision-scene-${createHash("sha256").update(JSON.stringify([plugin.id, job.owner_key, job.id, sha, "balanced-scene-v1"])).digest("hex").slice(0, 48)}`, sha, width: meta.width, height: meta.height, createdAt: now(),
      input: { images: [{ url: `data:image/jpeg;base64,${preview.toString("base64")}` }], context: { composition_mode: "scene-layout-v1", brief, foreground_sha256: sha, sourceWidth: meta.width, sourceHeight: meta.height } } };
    save(); // Reserve exact input before durable submission; a dropped caller only polls this ID.
  }
  if (state.sha !== sha) throw new V2QueueError("generation_policy_changed", 409);
  if (state.result) return { status: "succeeded", layout: parseSceneLayout(state.result, sha, state.width, state.height) };
  if (state.error) return { status: "failed", errorCode: state.error };
  const runner = dependencies.runner ?? visionJobRunner();
  let task = runner.store.get(plugin.id, state.id);
  if (!task && (state.admitted || now() - state.createdAt > 25 * 60_000)) { state.error = "generation_layout_unavailable"; save(); return { status: "failed", errorCode: state.error }; }
  if (!task) {
    try { task = await runner.submit(plugin, state.id, "v2_plan", state.input); }
    catch (error) {
      if ((error as { status?: number }).status === 429) return { status: "pending" };
      throw error;
    }
  }
  if (!state.admitted) { state.admitted = true; save(); }
  if (task.status === "queued" || task.status === "running") return { status: "pending" };
  if (task.status === "failed") { state.error = "generation_layout_failed"; state.input = { images: [] }; save(); return { status: "failed", errorCode: state.error }; }
  try { state.result = parseSceneLayout(JSON.parse(task.result_json!).data, sha, state.width, state.height); }
  catch { state.error = "generation_layout_failed"; }
  state.input = { images: [] }; save();
  return state.result ? { status: "succeeded", layout: state.result } : { status: "failed", errorCode: state.error };
}
