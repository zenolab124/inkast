import { createHash } from "node:crypto";
import type { InkastPlugin } from "../plugins/types.js";
import { getProviderCapability, listEnabledCapabilities } from "../storage/providers.js";
import { createV2Store, V2QueueError, type V2Job } from "../storage/v2-jobs.js";
import { validateVisionImage } from "./vision/index.js";
import { buildC2iPromptText } from "../drivers/image/c2i-tasks.js";
import { resolveExtraHeaders } from "../drivers/codex-header.js";
import sharp from "sharp";

type Layer = "foreground" | "background";
export interface V2LayerResult { status: "submitted" | "succeeded" | "failed"; image_url?: string; image_sha256?: string; error_code?: string; phase?: "awaiting_admission" | "preparing" | "queued" | "generating"; }
type ProviderEntry = NonNullable<ReturnType<typeof getProviderCapability>>;
interface LayerState {
  version: 1; taskId: string; providerId: string; providerHash: string; promptHash: string;
  createdAt: number; status: "submitted" | "succeeded" | "failed";
  referenceMode?: "url-sha256" | "inline"; admissionProtocol?: "durable-v1"; postAttempts?: number; lastPostAt?: number; admittedAt?: number; lastHttpStatus?: number;
  upstreamStatus?: string; lastPolledAt?: number; completedAt?: number;
  imageUrl?: string; imageSha256?: string; errorCode?: string;
}
class InvalidGeneratedLayer extends Error {}
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const providerHash = ({ provider, capability }: ProviderEntry) => digest(JSON.stringify({ id: provider.id, base: provider.baseUrl, model: capability.model, extras: capability.extras }));
const common = "Premium collectible-card artwork. Portrait 2:3, 1024x1536. No text, logo, watermark, numbers or card frame. ";
export function layerPrompt(prompt: string, layer: Layer): string {
  const brief = `Creative brief (subject, scene, style and lighting): ${JSON.stringify(prompt)}. `;
  return buildC2iPromptText({ promptText: common + brief + (layer === "foreground"
    ? "Create ONLY the foreground on genuine transparent RGBA alpha, no checkerboard, painted backing, ground or sky. Keep head, hair, horns, hands, clothing and held objects as foreground with solid opaque material. Only actual energy, smoke, translucent materials and antialiased silhouette edges may use partial alpha. This is an isolated source layer for later card composition. Preserve the requested portrait framing and close-up impact: waist-up, bust and medium close-up compositions are welcome; do not switch to a distant full-body shot just to include legs or feet. A natural torso crop at the bottom is allowed. Compose the head, hair, headwear, expressive hands and held objects comfortably inside the top and side canvas edges. When an arm is raised, bent behind the head or extended sideways, show its full shoulder-to-elbow-to-hand gesture inside the image: especially leave transparent space beyond the outermost elbow, do not let that elbow run off the left or right edge. Prefer a slightly roomier upper-body framing or bring the bent elbow gently inward while preserving the pose; pull the camera back only enough to fit that gesture. Do not solve overflow by cutting off the arm, flattening its silhouette against the canvas edge, or fading solid anatomy. Space around important silhouettes is a composition preference, not a uniform border or fixed margin quota. Final top/side frame-break and torso framing are decided later during card composition. Light the subject for the scene in the brief."
    : "Create ONLY the separate environment background for the attached foreground. Match its painting style, camera, direction and color of light. Use the scene from the brief; leave a natural central staging area, include local light spill from its luminous effects. No person, face, silhouette, clothing, hands, held objects or duplicated main energy ribbons. The attached foreground will overlay this background unchanged."), size: "1024x1536" });
}

/** One bounded upstream exchange per worker poll. No in-memory generation job
 * or callback is needed to recover after either server restarts. */
export function createV2Layers(deps: {
  providers?: (ids: readonly string[]) => ProviderEntry[]; provider?: (id: string) => ProviderEntry | null;
  fetch?: typeof fetch; now?: () => number;
} = {}) {
  const request = deps.fetch ?? fetch, now = deps.now ?? Date.now;
  const active = new Set<string>();
  const candidates = deps.providers ?? ((ids: readonly string[]) => listEnabledCapabilities("image", { providerIds: ids }));
  const lookup = deps.provider ?? (id => getProviderCapability(id, "image"));
  const allowed = (plugin: InkastPlugin, entry: ProviderEntry) =>
    plugin.imageProviderIds?.includes(entry.provider.id) && !entry.capability.disabled && entry.capability.extras?.mode === "c2i-tasks";
  const readImage = async (url: string, plugin: InkastPlugin) => {
    try { await validateVisionImage(url, plugin); } catch { throw new InvalidGeneratedLayer("Invalid layer URL"); }
    if (!url.startsWith("https://")) throw new InvalidGeneratedLayer("Invalid layer URL");
    const res = await request(url, { redirect: "error", signal: AbortSignal.timeout(8000) });
    if (!res.ok || !res.body) throw Error("Layer download unavailable");
    let size = 0; const chunks: Uint8Array[] = [];
    for await (const chunk of res.body) { size += chunk.length; if (size > 8 * 1024 * 1024) { await res.body.cancel().catch(() => {}); throw new InvalidGeneratedLayer("Layer too large"); } chunks.push(chunk); }
    const bytes = Buffer.concat(chunks);
    let meta;
    try { meta = await sharp(bytes, { limitInputPixels: 1024 * 1536 }).metadata(); } catch { throw new InvalidGeneratedLayer("Invalid generated image"); }
    if (meta.format !== "png" || meta.width !== 1024 || meta.height !== 1536 || (meta.pages ?? 1) !== 1) throw new InvalidGeneratedLayer("Invalid generated PNG");
    return bytes;
  };
  return async (store: ReturnType<typeof createV2Store>, plugin: InkastPlugin, job: V2Job, token: string, layer: Layer): Promise<V2LayerResult> => {
    if (job.input_kind !== "generated" || !job.creation_json) throw new V2QueueError("invalid_generation", 409);
    const key = `${job.id}:${layer}`;
    if (active.has(key)) throw new V2QueueError("generation_busy", 409);
    active.add(key);
    try {
      const prompt = layerPrompt((JSON.parse(job.creation_json) as { prompt: string }).prompt, layer);
      let state = JSON.parse(store.layer(plugin.id, job.id, layer) ?? "null") as LayerState | null;
      if (state?.status === "succeeded" || state?.status === "failed") return { status: state.status, image_url: state.imageUrl, image_sha256: state.imageSha256, error_code: state.errorCode };
      if (state && now() - state.createdAt > 45 * 60_000) {
        state.status = "failed"; state.completedAt = now();
        state.errorCode = state.upstreamStatus === "awaiting_admission" ? "generation_task_missing" : "generation_timeout";
        store.saveLayer(plugin.id, job.id, token, layer, JSON.stringify(state));
        return { status: state.status, error_code: state.errorCode };
      }
      const previous = layer === "background" ? JSON.parse(store.layer(plugin.id, job.id, "foreground") ?? "null") as LayerState | null : null;
      if (layer === "background" && previous?.status !== "succeeded") throw new V2QueueError("foreground_required", 409);
      // Explicit configured allowlist only. Pin the same channel for both layers;
      // content rejections never switch providers or rewrite the creative brief.
      const entry = state ? lookup(state.providerId) : previous ? lookup(previous.providerId) : candidates(plugin.imageProviderIds ?? [])
        .filter(item => allowed(plugin, item)).sort((a, b) => plugin.imageProviderIds!.indexOf(a.provider.id) - plugin.imageProviderIds!.indexOf(b.provider.id))[0];
      if (!entry || !allowed(plugin, entry)) throw new V2QueueError("generation_provider_unavailable", 503);
      if ((state && (state.providerHash !== providerHash(entry) || state.promptHash !== digest(prompt))) || (previous && previous.providerHash !== providerHash(entry))) throw new V2QueueError("generation_policy_changed", 409);
      const root = new URL(entry.provider.baseUrl).origin;
      const headers: Record<string, string> = { Authorization: `Bearer ${entry.apiKey}`, "Content-Type": "application/json", ...(resolveExtraHeaders(entry.capability) ?? {}) };
      // Retry only after a successful GET explicitly advertises durable admission
      // and confirms absence. The same owner/ID/payload is deduplicated upstream.
      const first = !state;
      const submit = !state || (state.upstreamStatus === "awaiting_admission" &&
        state.admissionProtocol === "durable-v1" && !state.admittedAt &&
        (state.postAttempts ?? 1) < 3 && now() - (state.lastPostAt ?? state.createdAt) >= 10_000);
      let foreground: Buffer | undefined;
      const referenceMode = state?.referenceMode ?? (first && previous?.admissionProtocol === "durable-v1" ? "url-sha256" : "inline");
      if (submit && previous?.imageUrl && referenceMode === "inline") {
        foreground = await readImage(previous.imageUrl, plugin);
        if (digest(foreground) !== previous.imageSha256) throw new V2QueueError("invalid_generated_layer", 409);
      }
      if (!state) {
        state = { version: 1, taskId: `inkast-3d-${digest(`${plugin.id}:${job.id}:${layer}`).slice(0, 40)}`, providerId: entry.provider.id,
          providerHash: providerHash(entry), promptHash: digest(prompt), referenceMode, createdAt: now(), status: "submitted" };
        // Reserve BEFORE the POST. A lost response is recovered by GET of the
        // deterministic ID; never blindly submit again after uncertain delivery.
        store.saveLayer(plugin.id, job.id, token, layer, JSON.stringify(state));
      }
      if (submit && previous?.imageUrl && referenceMode === "url-sha256") {
        if (!/^[a-f0-9]{64}$/.test(previous.imageSha256 ?? "")) throw new V2QueueError("invalid_generated_layer", 409);
        headers["X-Reference-Image-Sha256"] = previous.imageSha256!;
      }
      if (submit) {
        state.postAttempts = (state.postAttempts ?? (first ? 0 : 1)) + 1;
        state.lastPostAt = now();
        store.saveLayer(plugin.id, job.id, token, layer, JSON.stringify(state));
      }
      const res = submit
        ? await request(`${root}/api/image-tasks/${layer === "foreground" ? "generations" : "edits"}`, { method: "POST", headers, signal: AbortSignal.timeout(previous && referenceMode === "inline" ? 25_000 : 8000), body: JSON.stringify({
          client_task_id: state.taskId, prompt, model: entry.capability.model, size: "1024x1536", quality: "high", output_format: "png",
          background: layer === "foreground" ? "transparent" : "opaque", response_format: "url", url_source: "r2", optimize_output: false,
          ...(previous?.imageUrl ? { images: [referenceMode === "url-sha256" ? previous.imageUrl : `data:image/png;base64,${foreground!.toString("base64")}`] } : {}),
        }) })
        : await request(`${root}/api/image-tasks?ids=${encodeURIComponent(state.taskId)}`, { headers, signal: AbortSignal.timeout(8000) });
      if (!res.ok) {
        state.lastHttpStatus = res.status;
        // JSON 4xx is an explicit refusal before admission. HTML 403/530 and
        // timeouts are transport failures, not content rejection or proof of absence.
        if (submit && [400, 401, 403, 409, 413, 422].includes(res.status) &&
          res.headers.get("content-type")?.includes("application/json")) {
          state.status = "failed"; state.completedAt = now();
          state.errorCode = res.status === 401 || res.status === 403 ? "generation_auth_failed" :
            res.status === 409 ? "generation_submission_conflict" : "generation_submission_failed";
          store.saveLayer(plugin.id, job.id, token, layer, JSON.stringify(state));
          return { status: "failed", error_code: state.errorCode };
        }
        store.saveLayer(plugin.id, job.id, token, layer, JSON.stringify(state));
        throw new V2QueueError("generation_connection_pending", 503);
      }
      if (res.headers.get("x-image-task-admission") === "durable-v1") state.admissionProtocol = "durable-v1";
      const data = await res.json() as { id?: string; status?: string; progress?: string; error_code?: string; error?: string; items?: Array<{ id: string; status: string; progress?: string; error_code?: string; error?: string; data?: Array<{ url?: string }> }>; missing_ids?: string[] };
      const task = submit ? data : data.items?.find(item => item.id === state!.taskId);
      if (task?.id && task.id !== state.taskId) throw Error("Unexpected upstream task ID");
      state.lastPolledAt = now();
      if (data.missing_ids?.includes(state.taskId)) {
        state.upstreamStatus = "awaiting_admission";
        if (res.headers.get("x-image-task-admission") === "durable-v1") {
          state.admissionProtocol = "durable-v1";
          if (state.admittedAt || (state.postAttempts ?? 1) >= 3) {
            state.status = "failed";
            state.errorCode = state.admittedAt ? "generation_task_missing" : "generation_submission_failed";
          }
        }
      } else if (task?.status === "error") {
        state.upstreamStatus = "error";
        state.status = "failed";
        const code = task.error_code;
        // Some upstreams use a generic execution code even for an explicit model refusal.
        // Classify the known refusal; never retry it or move it to another channel.
        const detail = typeof task.error === "string" ? task.error.slice(0, 2000) : "";
        const rejected = code === "request_rejected" || !code ||
          /第三方内容.*?相似性|相似性.*?防护限制|similarity to third[- ]party content|content_policy_violation|may violate our guardrails/i.test(detail);
        state.errorCode = code === "request_preparation_failed" ? "generation_submission_failed" :
          code === "admission_capacity" ? "generation_queue_full" :
          rejected ? "generation_rejected" : "generation_failed";
      } else if (task?.status === "success") {
        state.upstreamStatus = "success";
        const result = task as { data?: Array<{ url?: string }> }, url = result.data?.[0]?.url;
        if (!url) throw Error("Missing generated layer URL");
        try {
          const bytes = await readImage(url, plugin); // Freeze bytes before publishing any layer URL.
          state.status = "succeeded"; state.imageUrl = url; state.imageSha256 = digest(bytes);
        } catch (error) {
          if (!(error instanceof InvalidGeneratedLayer)) throw error;
          state.status = "failed"; state.errorCode = "invalid_generated_layer";
        }
      } else if (now() - state.createdAt > 45 * 60_000) {
        state.status = "failed"; state.errorCode = "generation_timeout";
      } else if (task?.status) state.upstreamStatus = task.status;
      if (task?.id) state.admittedAt ??= now();
      if (state.status !== "submitted") state.completedAt = now();
      store.saveLayer(plugin.id, job.id, token, layer, JSON.stringify(state));
      const progress = (task as { progress?: string } | undefined)?.progress;
      const phase = state.upstreamStatus === "awaiting_admission" ? "awaiting_admission" :
        progress === "checking_request" || progress === "reading_references" ? "preparing" :
        state.upstreamStatus === "queued" ? "queued" : "generating";
      return { status: state.status, image_url: state.imageUrl, image_sha256: state.imageSha256, error_code: state.errorCode, phase };
    } finally { active.delete(key); }
  };
}
