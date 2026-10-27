import { createHash } from "node:crypto";
import type { InkastPlugin } from "../plugins/types.js";
import { getProviderCapability, listEnabledCapabilities } from "../storage/providers.js";
import { createV2Store, V2QueueError, type V2Job } from "../storage/v2-jobs.js";
import { validateVisionImage } from "./vision/index.js";
import { buildC2iPromptText } from "../drivers/image/c2i-tasks.js";
import { resolveExtraHeaders } from "../drivers/codex-header.js";
import sharp from "sharp";
import { rewriteBlockedPrompt, type RewriteRound } from "./rewrite-prompt/index.js";

type Layer = "foreground" | "background" | "repair";
export interface V2RepairInput { foreground_sha256: string; crop_png: string; mask_png: string; part: string; material: "solid" | "energy"; }
const repairPrompt = (repair: V2RepairInput) => `Edit only the small missing terminal of ${JSON.stringify(repair.part)} on the isolated transparent foreground in image 1. Image 2 is an edit guide: white is the only editable region, black must remain unchanged. Reconstruct a short natural rounded ending continuing the local anatomy, garment or prop and matching exact texture, focus, lighting and color. Do not alter the pose, identity, face, existing detail or any other part. Keep the restored silhouette away from the guide outer boundary; finish it naturally with transparent space beyond it. Genuine transparent RGBA PNG, square. ${repair.material === "solid" ? "Solid material remains fully opaque; never dissolve or fade anatomy or clothing." : "Preserve only the physically translucent energy as translucent."} No frame, numbers, text, backdrop or extra objects.`;
export interface V2LayerResult { status: "submitted" | "succeeded" | "failed"; image_url?: string; image_sha256?: string; error_code?: string; phase?: "awaiting_admission" | "preparing" | "queued" | "generating"; }
type ProviderEntry = NonNullable<ReturnType<typeof getProviderCapability>>;
interface LayerState {
  version: 1; taskId: string; providerId: string; providerHash: string; promptHash: string;
  createdAt: number; status: "submitted" | "succeeded" | "failed";
  referenceMode?: "url-sha256" | "inline"; admissionProtocol?: "durable-v1"; postAttempts?: number; lastPostAt?: number; admittedAt?: number; lastHttpStatus?: number;
  upstreamStatus?: string; lastPolledAt?: number; completedAt?: number;
  outputSize?: string; inputHash?: string; imageUrl?: string; imageSha256?: string; errorCode?: string;
  repairRetry?: { previousTaskId: string; errorCode?: string; detail: string; completedAt: number };
  rewrite?: {
    originalPromptHash: string; round: number; prompt: string;
    history: Array<{ round: number; taskId: string; prompt: string; promptHash: string; errorCode: string; detail: string; completedAt: number }>;
    results?: Array<{ round: number; calls: number; promptHash: string; llmDurationMs: number }>;
    pending?: { round: number; calls: number; startedAt: number; retryAfter?: number; errorCode?: string };
  };
}
const MAX_FOREGROUND_REWRITES = 3;
const REWRITE_STALE_MS = 120_000;
function contentRejected(code?: string, detail = ""): boolean {
  return ["request_rejected", "provider_blocked_content", "upstream_safety_rejected", "moderation", "content_policy_violation"].includes(code ?? "") ||
    /第三方内容.*?相似性|相似性.*?防护限制|裸露|色情|情色|similarity to third[- ]party content|content_policy_violation|may violate our guardrails|content rejection/i.test(detail);
}
// The image model can round a requested ratio by one pixel. Preserve the
// original dimensions/bytes instead of resizing a good transparent source.
function validPortraitSize(width: number | undefined, height: number | undefined, ratioWidth: number, ratioHeight: number): boolean {
  if (!width || !height || width < 512 || width > 2048 || height < 512 || height > 2048) return false;
  return Math.abs(width * ratioHeight - height * ratioWidth) <= ratioHeight;
}
class InvalidGeneratedLayer extends Error {}
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const providerHash = ({ provider, capability }: ProviderEntry) => digest(JSON.stringify({ id: provider.id, base: provider.baseUrl, model: capability.model, extras: capability.extras }));
const common = "Premium collectible-card artwork. ";
export function layerPrompt(prompt: string, layer: Exclude<Layer, "repair">, size = layer === "foreground" ? "1024x1280" : "1024x1536", independent = size === "1024x1280"): string {
  const brief = `Creative brief (subject, scene, style and lighting): ${JSON.stringify(prompt)}. `;
  return buildC2iPromptText({ promptText: common + (size === "1024x1280" ? "Portrait 4:5 (width:height), 1024x1280. Keep the subject at a useful portrait scale; use the extra lateral space for the natural silhouette, gesture, clothing and held objects without shrinking the subject into a small centered figure or imposing any pose. " : "Portrait 2:3, 1024x1536. ") + "No text, logo, watermark, numbers or card frame. " + brief + (layer === "foreground"
    ? "Create ONLY the foreground on genuine transparent RGBA alpha, no checkerboard, painted backing, ground or sky. Keep the subject, hair, accessories, clothing, hands and held objects as foreground with solid opaque material. Only actual energy, smoke, translucent materials and antialiased silhouette edges may use partial alpha. Let the character and creative brief determine the pose, gesture and framing; when no action is specified, choose a fitting action without a fixed pose template. This is an isolated source layer for later card composition. For a single-person composition, the entire head including the crown, both sides, facial features and jaw must be present; a torso crop is allowed but a head crop is not. Keep the visible contours of the subject and held objects complete inside the top and side source edges, with transparent space around their outermost silhouettes. Fit those contours by adjusting the framing only as needed while honoring the brief. Preserve the requested framing: full-body completeness is not required, and a natural torso crop at the bottom is allowed. Do not solve overflow by cutting off a visible part, flattening its contour against the canvas edge, or fading solid material. Space around important silhouettes is not a uniform border or fixed margin quota. Final frame-break placement is decided later during card composition. Light the subject for the scene in the brief."
    : "Create ONLY the separate environment background for the attached foreground. Match its painting style, camera, direction and color of light. Use the scene from the brief; leave a natural central staging area, include local light spill from its luminous effects. No person, face, silhouette, clothing, hands, held objects or duplicated main energy ribbons. " + (independent ? "The attached foreground is a separate 4:5 portrait source; this background remains a 2:3 portrait. Match perspective and light, not its canvas boundaries. Foreground and background will be independently positioned during composition." : "The attached foreground will overlay this background unchanged.")), size });
}

/** One bounded upstream exchange per worker poll. No in-memory generation job
 * or callback is needed to recover after either server restarts. */
export function createV2Layers(deps: {
  providers?: (ids: readonly string[]) => ProviderEntry[]; provider?: (id: string) => ProviderEntry | null;
  fetch?: typeof fetch; now?: () => number; rewrite?: typeof rewriteBlockedPrompt;
} = {}) {
  const request = deps.fetch ?? fetch, now = deps.now ?? Date.now;
  const rewrite = deps.rewrite ?? rewriteBlockedPrompt;
  const active = new Set<string>();
  const candidates = deps.providers ?? ((ids: readonly string[]) => listEnabledCapabilities("image", { providerIds: ids }));
  const lookup = deps.provider ?? (id => getProviderCapability(id, "image"));
  const allowed = (plugin: InkastPlugin, entry: ProviderEntry) =>
    plugin.imageProviderIds?.includes(entry.provider.id) && !entry.capability.disabled && entry.capability.extras?.mode === "c2i-tasks";
  const readImage = async (url: string, plugin: InkastPlugin, repair = false, foregroundSize?: string) => {
    try { await validateVisionImage(url, plugin); } catch { throw new InvalidGeneratedLayer("Invalid layer URL"); }
    if (!url.startsWith("https://")) throw new InvalidGeneratedLayer("Invalid layer URL");
    const res = await request(url, { redirect: "error", signal: AbortSignal.timeout(8000) });
    if (!res.ok || !res.body) throw Error("Layer download unavailable");
    let size = 0; const chunks: Uint8Array[] = [];
    for await (const chunk of res.body) { size += chunk.length; if (size > 8 * 1024 * 1024) { await res.body.cancel().catch(() => {}); throw new InvalidGeneratedLayer("Layer too large"); } chunks.push(chunk); }
    const bytes = Buffer.concat(chunks);
    let meta;
    try { meta = await sharp(bytes, { limitInputPixels: repair || foregroundSize ? 2048 * 2048 : 1024 * 1536 }).metadata(); } catch { throw new InvalidGeneratedLayer("Invalid generated image"); }
    const dimensionsValid = repair
      ? !!meta.width && meta.width >= 512 && meta.width <= 2048 && meta.width === meta.height && meta.hasAlpha
      : foregroundSize === "1024x1280" ? validPortraitSize(meta.width, meta.height, 4, 5)
        : foregroundSize === "background-portrait" ? validPortraitSize(meta.width, meta.height, 2, 3)
          : meta.width === 1024 && meta.height === 1536;
    if (meta.format !== "png" || !dimensionsValid || (meta.pages ?? 1) !== 1) throw new InvalidGeneratedLayer("Invalid generated PNG");
    return bytes;
  };
  return async (store: ReturnType<typeof createV2Store>, plugin: InkastPlugin, job: V2Job, token: string, layer: Layer, repair?: V2RepairInput): Promise<V2LayerResult> => {
    if (job.input_kind !== "generated" || !job.creation_json) throw new V2QueueError("invalid_generation", 409);
    const { recomposition, recovery } = JSON.parse(job.creation_json);
    if (recovery && layer === "repair") throw new V2QueueError("recovery_no_generation", 409);
    if ((recomposition || recovery) && layer !== "repair") {
      store.leased(plugin.id, job.id, token);
      const raw = store.layer(plugin.id, job.id, layer);
      const frozen = raw ? JSON.parse(raw) as LayerState : null;
      if (frozen?.status !== "succeeded" || !frozen.imageUrl || !frozen.imageSha256) throw new V2QueueError("recomposition_layers_missing", 409);
      if (recovery && frozen.imageSha256 !== (layer === "foreground" ? recovery.foregroundSha256 : recovery.backgroundSha256)) throw new V2QueueError("recovery_layers_changed", 409);
      await validateVisionImage(frozen.imageUrl, plugin);
      return { status: "succeeded", image_url: frozen.imageUrl, image_sha256: frozen.imageSha256 };
    }
    const key = `${job.id}:${layer}`;
    if (active.has(key)) throw new V2QueueError("generation_busy", 409);
    active.add(key);
    try {
      if ((layer === "repair") !== !!repair) throw new V2QueueError("invalid_repair", 409);
      let previous = layer !== "foreground" ? JSON.parse(store.layer(plugin.id, job.id, "foreground") ?? "null") as LayerState | null : null;
      if (layer !== "foreground" && previous?.status !== "succeeded") throw new V2QueueError("foreground_required", 409);
      if (repair && previous?.imageSha256 !== repair.foreground_sha256) throw new V2QueueError("repair_source_mismatch", 409);
      // Frozen recompositions omit submission state. Resolve only the pinned
      // original provider, following same-owner, same-PNG provenance; never
      // recreate either original layer or switch an old image to another pool.
      if (repair && recomposition) {
        let sourceId = recomposition.sourceJobId;
        const seen = new Set<string>();
        while (!previous?.providerId && sourceId && seen.size < 32 && !seen.has(sourceId)) {
          seen.add(sourceId);
          const source = store.get(plugin.id, sourceId);
          const raw = source && store.layer(plugin.id, sourceId, "foreground");
          const sourceLayer = raw ? JSON.parse(raw) as LayerState : null;
          if (!source || source.owner_key !== job.owner_key || source.status !== "succeeded" || sourceLayer?.status !== "succeeded" || sourceLayer.imageSha256 !== repair.foreground_sha256 || sourceLayer.imageUrl !== previous?.imageUrl) throw new V2QueueError("repair_source_mismatch", 409);
          previous = sourceLayer;
          sourceId = source.creation_json ? JSON.parse(source.creation_json).recomposition?.sourceJobId : undefined;
        }
        if (!previous?.providerId || !previous.providerHash) throw new V2QueueError("generation_provider_unavailable", 503);
      }
      if (repair) {
        for (const url of [repair.crop_png, repair.mask_png]) {
          if (!url.startsWith("data:image/png;base64,")) throw new V2QueueError("invalid_repair", 409);
          await validateVisionImage(url, plugin);
          const meta = await sharp(Buffer.from(url.split(",")[1]!, "base64")).metadata();
          if (meta.width !== 1024 || meta.height !== 1024) throw new V2QueueError("invalid_repair", 409);
        }
      }
      const inputHash = repair ? digest(JSON.stringify(repair)) : undefined;
      const brief = (JSON.parse(job.creation_json) as { prompt: string }).prompt;
      let stored = store.layer(plugin.id, job.id, layer);
      let state = JSON.parse(stored ?? "null") as LayerState | null;
      const outputSize = repair ? "1024x1024" : layer === "foreground" ? (state ? state.outputSize ?? "1024x1536" : "1024x1280") : "1024x1536";
      const foregroundPrompt = (value: string) => layerPrompt(value, "foreground", outputSize);
      const originalPrompt = repair ? repairPrompt(repair) : layerPrompt(brief, layer as Exclude<Layer, "repair">, outputSize, layer === "foreground" ? outputSize === "1024x1280" : previous?.outputSize === "1024x1280");
      const save = () => {
        const next = JSON.stringify(state);
        if (!store.compareAndSaveLayer(plugin.id, job.id, token, layer, stored, next)) throw new V2QueueError("generation_busy", 409);
        stored = next;
      };
      let prompt = state?.rewrite ? foregroundPrompt(state.rewrite.prompt) : originalPrompt;
      if (state && state.inputHash !== inputHash) throw new V2QueueError("repair_input_changed", 409);
      if (state?.status === "succeeded" || state?.status === "failed") return { status: state.status, image_url: state.imageUrl, image_sha256: state.imageSha256, error_code: state.errorCode };
      if (state && now() - state.createdAt > 45 * 60_000) {
        state.status = "failed"; state.completedAt = now();
        state.errorCode = state.upstreamStatus === "awaiting_admission" ? "generation_task_missing" : "generation_timeout";
        save();
        return { status: state.status, error_code: state.errorCode };
      }
      // Explicit configured allowlist only. Pin the same channel for both layers;
      // foreground rewrite rounds stay on that channel and preserve durable IDs.
      const entry = state ? lookup(state.providerId) : previous ? lookup(previous.providerId) : candidates(plugin.imageProviderIds ?? [])
        .filter(item => allowed(plugin, item)).sort((a, b) => plugin.imageProviderIds!.indexOf(a.provider.id) - plugin.imageProviderIds!.indexOf(b.provider.id))[0];
      if (!entry || !allowed(plugin, entry)) throw new V2QueueError("generation_provider_unavailable", 503);
      if ((state && (state.providerHash !== providerHash(entry) || state.promptHash !== digest(prompt))) || (previous && previous.providerHash !== providerHash(entry))) throw new V2QueueError("generation_policy_changed", 409);
      if (state?.rewrite && (layer !== "foreground" || state.rewrite.originalPromptHash !== digest(originalPrompt) || state.rewrite.round < 0 || state.rewrite.round > MAX_FOREGROUND_REWRITES)) throw new V2QueueError("generation_policy_changed", 409);
      if (state?.rewrite?.pending) {
        const pending = state.rewrite.pending;
        if (pending.round !== state.rewrite.round + 1 || pending.round > MAX_FOREGROUND_REWRITES) throw new V2QueueError("generation_policy_changed", 409);
        const failRewrite = (errorCode: string) => {
          state!.status = "failed"; state!.errorCode = errorCode; state!.completedAt = now(); save();
          return { status: "failed" as const, error_code: errorCode };
        };
        if (pending.retryAfter ? now() < pending.retryAfter : pending.calls > 0 && now() - pending.startedAt < REWRITE_STALE_MS) return { status: "submitted", phase: "preparing" };
        if (pending.calls >= 2) return failRewrite("generation_rewrite_failed");
        pending.calls++; pending.startedAt = now(); delete pending.retryAfter;
        save(); // Claim the rewrite before awaiting the LLM; competing polls cannot run it twice.
        let result;
        try {
          result = await rewrite({ originalPromptText: brief, round: pending.round as RewriteRound,
            previousRewrittens: state.rewrite.history.filter(item => item.round > 0).map(item => item.prompt), previousAnalysis: null,
            foregroundConstraints: foregroundPrompt(""),
            llmPolicy: { providerIds: plugin.visionTasks?.v2_plan?.providerIds ?? (typeof plugin.llmBackend === "object" ? [plugin.llmBackend.providerId] : []), apiOnly: true, maxCalls: 1 },
          });
        } catch (error) {
          const code = (error as { code?: string }).code;
          if (pending.calls < 2 && ["timeout", "aborted", "rate_limited", "backend_unavailable"].includes(code ?? "")) {
            pending.retryAfter = now() + 60_000; pending.errorCode = code; save();
            return { status: "submitted", phase: "preparing" };
          }
          return failRewrite("generation_rewrite_failed");
        }
        const rewritten = result.rewrittenPromptText?.trim();
        if (!rewritten || rewritten.length > 16000 || rewritten === state.rewrite.prompt || state.rewrite.history.some(item => item.promptHash === digest(foregroundPrompt(rewritten)))) return failRewrite("generation_rewrite_failed");
        const round = pending.round;
        (state.rewrite.results ??= []).push({ round, calls: pending.calls, promptHash: digest(foregroundPrompt(rewritten)), llmDurationMs: result.llmDurationMs });
        state.rewrite.round = round; state.rewrite.prompt = rewritten; delete state.rewrite.pending;
        prompt = foregroundPrompt(rewritten);
        state.taskId = `inkast-3d-${digest(`${plugin.id}:${job.id}:${layer}:rewrite:${round}`).slice(0, 40)}`;
        state.promptHash = digest(prompt); state.status = "submitted";
        for (const name of ["postAttempts", "lastPostAt", "admittedAt", "lastHttpStatus", "upstreamStatus", "lastPolledAt", "completedAt", "errorCode", "admissionProtocol"] as const) delete state[name];
        state.postAttempts = 0;
        save(); // Persist the exact new prompt/ID before any image submission.
        return { status: "submitted", phase: "preparing" };
      }
      const root = new URL(entry.provider.baseUrl).origin;
      const headers: Record<string, string> = { Authorization: `Bearer ${entry.apiKey}`, "Content-Type": "application/json", ...(resolveExtraHeaders(entry.capability) ?? {}) };
      // Retry only after a successful GET explicitly advertises durable admission
      // and confirms absence. The same owner/ID/payload is deduplicated upstream.
      const first = !state;
      const submit = !state || state.postAttempts === 0 || (state.upstreamStatus === "awaiting_admission" &&
        state.admissionProtocol === "durable-v1" && !state.admittedAt &&
        (state.postAttempts ?? 1) < 3 && now() - (state.lastPostAt ?? state.createdAt) >= 10_000);
      let foreground: Buffer | undefined;
      const referenceMode = repair ? "inline" : state?.referenceMode ?? (first && previous?.admissionProtocol === "durable-v1" ? "url-sha256" : "inline");
      if (submit && !repair && previous?.imageUrl && referenceMode === "inline") {
        foreground = await readImage(previous.imageUrl, plugin, false, previous.outputSize);
        if (digest(foreground) !== previous.imageSha256) throw new V2QueueError("invalid_generated_layer", 409);
      }
      if (!state) {
        state = { version: 1, taskId: `inkast-3d-${digest(`${plugin.id}:${job.id}:${layer}`).slice(0, 40)}`, providerId: entry.provider.id,
          outputSize, inputHash, providerHash: providerHash(entry), promptHash: digest(prompt), referenceMode, createdAt: now(), status: "submitted",
          ...(layer === "foreground" ? { rewrite: { originalPromptHash: digest(originalPrompt), round: 0, prompt: brief, history: [] } } : {}) };
        // Reserve BEFORE the POST. A lost response is recovered by GET of the
        // deterministic ID; never blindly submit again after uncertain delivery.
        save();
      }
      if (submit && previous?.imageUrl && referenceMode === "url-sha256") {
        if (!/^[a-f0-9]{64}$/.test(previous.imageSha256 ?? "")) throw new V2QueueError("invalid_generated_layer", 409);
        headers["X-Reference-Image-Sha256"] = previous.imageSha256!;
      }
      if (submit) {
        state.postAttempts = (state.postAttempts ?? (first ? 0 : 1)) + 1;
        state.lastPostAt = now();
        save();
      }
      const res = submit
        ? await request(`${root}/api/image-tasks/${layer === "foreground" ? "generations" : "edits"}`, { method: "POST", headers, signal: AbortSignal.timeout(previous && referenceMode === "inline" ? 25_000 : 8000), body: JSON.stringify({
          client_task_id: state.taskId, prompt, model: entry.capability.model, size: outputSize, quality: "high", output_format: "png",
          background: layer !== "background" ? "transparent" : "opaque", response_format: "url", url_source: "r2", optimize_output: false,
          ...(repair ? { images: [repair.crop_png, repair.mask_png] } : previous?.imageUrl ? { images: [referenceMode === "url-sha256" ? previous.imageUrl : `data:image/png;base64,${foreground!.toString("base64")}`] } : {}),
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
          save();
          return { status: "failed", error_code: state.errorCode };
        }
        save();
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
        const detail = typeof task.error === "string" ? task.error.slice(0, 2000) : "";
        const rejected = contentRejected(code, detail);
        state.errorCode = code === "request_preparation_failed" ? "generation_submission_failed" :
          code === "admission_capacity" ? "generation_queue_full" :
          rejected ? "generation_rejected" : "generation_failed";
        // Only a confirmed terminal transport failure without a result permits
        // a second edit. Unknown acknowledgements keep querying the same ID.
        const resultUrls = (task as { data?: Array<{ url?: string }> }).data;
        const transportFailure = ["network_error", "connection_error", "upstream_timeout", "ETIMEDOUT", "ECONNRESET"].includes(code ?? "") ||
          /curl: \((?:5|6|7|18|28|35|52|55|56)\)|connection (?:closed|reset|aborted)|socket hang up|ETIMEDOUT|ECONNRESET|network error/i.test(detail);
        if (layer === "repair" && !rejected && transportFailure && !resultUrls?.some(item => item.url) &&
            !state.imageUrl && !state.repairRetry && now() - state.createdAt < 45 * 60_000) {
          state.repairRetry = { previousTaskId: state.taskId, errorCode: code, detail, completedAt: now() };
          state.taskId = `inkast-3d-${digest(`${plugin.id}:${job.id}:repair:network-retry:1`).slice(0, 40)}`;
          state.status = "submitted";
          for (const field of ["lastPostAt", "admittedAt", "lastHttpStatus", "upstreamStatus", "lastPolledAt", "completedAt", "errorCode", "admissionProtocol"] as const) delete state[field];
          state.postAttempts = 0;
          save();
          return { status: "submitted", phase: "preparing" };
        }
        if (layer === "foreground" && state.rewrite && state.errorCode === "generation_rejected") {
          state.rewrite.history.push({ round: state.rewrite.round, taskId: state.taskId, prompt: state.rewrite.prompt,
            promptHash: state.promptHash, errorCode: state.errorCode, detail, completedAt: now() });
          if (state.rewrite.round < MAX_FOREGROUND_REWRITES) {
            state.status = "submitted";
            state.rewrite.pending = { round: state.rewrite.round + 1, calls: 0, startedAt: now() };
            delete state.errorCode;
          }
        }
      } else if (task?.status === "success") {
        state.upstreamStatus = "success";
        const result = task as { data?: Array<{ url?: string }> }, url = result.data?.[0]?.url;
        if (!url) throw Error("Missing generated layer URL");
        try {
          const bytes = await readImage(url, plugin, !!repair, layer === "foreground" ? outputSize : layer === "background" && previous?.outputSize === "1024x1280" ? "background-portrait" : undefined); // Freeze bytes before publishing any layer URL.
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
      save();
      const progress = (task as { progress?: string } | undefined)?.progress;
      const phase = state.upstreamStatus === "awaiting_admission" ? "awaiting_admission" :
        progress === "checking_request" || progress === "reading_references" ? "preparing" :
        state.upstreamStatus === "queued" ? "queued" : "generating";
      return { status: state.status, image_url: state.imageUrl, image_sha256: state.imageSha256, error_code: state.errorCode, phase };
    } finally { active.delete(key); }
  };
}
