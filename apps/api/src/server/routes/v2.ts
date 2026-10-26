import { Hono } from "hono";
import { z } from "zod";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import sharp from "sharp";
import { createV2Layers } from "../../domain/v2-layers.js";
import { v2Store, V2QueueError, V2_BILLING_VERSION, V2_CONCURRENCY, type V2Job } from "../../storage/v2-jobs.js";
import { validateVisionImage } from "../../domain/vision/index.js";
import { putImage } from "../../drivers/storage/r2.js";

const id = z.string().regex(/^[a-zA-Z0-9_-]{8,80}$/);
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const cardStats = z.object({ region: z.enum(["cn", "global"]), cardKey: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/), sourceSha256: sha, cost: z.number().int().safe().refine(v => String(v).length <= 4).nullable(), power: z.number().int().safe().refine(v => String(v).length <= 4).nullable() }).strict();
const statsHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const publicJob = (j: V2Job) => ({ id: j.id, source_task_id: j.source_task_id, created_at: j.created_at, status: j.status, stage: j.stage, image_url: j.image_url,
  input_kind: j.input_kind, source_image_url: j.source_url, source_sha256: j.source_sha256, code_sha256: j.code_sha256,
  stats_baked: !!j.geometry_json && JSON.parse(j.geometry_json).stats_baked === true,
  error_code: j.error_code, geometry: j.geometry_json ? JSON.parse(j.geometry_json) : null, updated_at: j.updated_at });
const enabled = () => process.env.INKAST_V2_ENABLED === "true";

export function createV2Routes(dependencies: { store?: typeof v2Store; upload?: typeof putImage; layers?: ReturnType<typeof createV2Layers> } = {}): Hono {
  const store = dependencies.store ?? v2Store;
  const upload = dependencies.upload ?? putImage;
  const layers = dependencies.layers ?? createV2Layers();
  const routes = new Hono();
  routes.onError((e, c) => {
      if (e instanceof V2QueueError) return c.json({ error: { code: e.code } }, e.status);
      if (e instanceof z.ZodError || e instanceof SyntaxError) return c.json({ error: { code: "invalid_input" } }, 400);
      console.warn("[static-v2] request did not complete", e instanceof Error ? e.name : "unknown");
      return c.json({ error: { code: "v2_unavailable" } }, 503);
  });
  routes.use("*", async (c, next) => {
    if (c.get("plugin").id !== "snapub") return c.json({ error: { code: "not_enabled" } }, 403);
    return next();
  });
  routes.get("/config", c => c.json({ enabled: enabled() && store().online(c.get("plugin").id), direct_generation_enabled: enabled() && store().online(c.get("plugin").id) && process.env.INKAST_V2_GENERATION_ENABLED === "true", billing_version: V2_BILLING_VERSION, energy_cost: 50, concurrency: V2_CONCURRENCY, daily_limit: null, max_attempts: null, revision: process.env.INKAST_V2_REVISION ?? null }));
  routes.get("/jobs", c => {
    const owner = sha.parse(c.req.header("x-v2-owner"));
    const input = z.object({ limit: z.coerce.number().int().min(1).max(24).default(12), before_time: z.coerce.number().int().nonnegative().optional(), before_id: id.optional() }).strict().parse(c.req.query());
    if ((input.before_time === undefined) !== (input.before_id === undefined)) return c.json({ error: { code: "invalid_input" } }, 400);
    const result = store().list(c.get("plugin").id, owner, input.limit, input.before_id ? { time: input.before_time!, id: input.before_id } : undefined);
    return c.json({ items: result.items.map(publicJob), next: result.next });
  });
  routes.post("/jobs", async c => {
    const input = z.object({ id, owner_key: sha, task_id: id, source_image_url: z.string().max(4096), billing_version: z.literal(V2_BILLING_VERSION).optional(), card_stats: cardStats.optional() }).strict().parse(await c.req.json());
    const plugin = c.get("plugin");
    if (!enabled() && !store().get(plugin.id, input.id)) throw new V2QueueError("v2_disabled", 503);
    try { await validateVisionImage(input.source_image_url, plugin); } catch { return c.json({ error: { code: "source_not_allowed" } }, 400); }
    if (!input.source_image_url.startsWith("https://")) return c.json({ error: { code: "source_not_allowed" } }, 400);
    const job = store().submit({ id: input.id, plugin: plugin.id, owner: input.owner_key, task: input.task_id, source: input.source_image_url, billingVersion: input.billing_version, cardStats: input.card_stats });
    return c.json(publicJob(job), 202);
  });
  routes.post("/creations", async c => {
    const input = z.object({ id, owner_key: sha, prompt: z.string().trim().min(2).max(4000), billing_version: z.literal(V2_BILLING_VERSION), card_stats: cardStats.optional() }).strict().parse(await c.req.json());
    const plugin = c.get("plugin");
    if ((!enabled() || process.env.INKAST_V2_GENERATION_ENABLED !== "true") && !store().get(plugin.id, input.id)) throw new V2QueueError("generation_disabled", 503);
    const job = store().submit({ id: input.id, plugin: plugin.id, owner: input.owner_key, task: "", source: "", billingVersion: input.billing_version, creation: { prompt: input.prompt }, cardStats: input.card_stats });
    return c.json(publicJob(job), 202);
  });
  routes.get("/jobs/:id", c => {
    const owner = sha.parse(c.req.header("x-v2-owner"));
    const job = store().get(c.get("plugin").id, id.parse(c.req.param("id")));
    if (!job || job.owner_key !== owner) return c.json({ error: { code: "not_found" } }, 404);
    return c.json(publicJob(job));
  });
  // Separate worker proof; never accepted from Mini Program clients. The raw
  // plugin token is already checked by pluginAuth before this router runs.
  routes.use("/worker/*", async (c, next) => {
    const token = (c.req.header("authorization") ?? "").slice(7).trim();
    const expected = createHmac("sha256", token).update("static-v2-worker-v1").digest("hex");
    const actual = c.req.header("x-v2-worker") ?? "";
    if (actual.length !== expected.length || !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) return c.json({ error: { code: "worker_unauthorized" } }, 403);
    return next();
  });
  const workerIdentity = z.object({ worker_id: id, revision: sha, inkast_revision: sha.optional() }).strict();
  const checkWorkerVersion = (revision: string | undefined) => {
    if (process.env.INKAST_V2_REVISION && revision !== process.env.INKAST_V2_REVISION) throw new V2QueueError("worker_version_mismatch", 503);
  };
  routes.post("/worker/heartbeat", async c => {
    const input = workerIdentity.parse(await c.req.json());
    checkWorkerVersion(input.inkast_revision);
    store().heartbeat(c.get("plugin").id, input.worker_id, input.revision);
    return c.json({ ok: true });
  });
  routes.post("/worker/claim", async c => {
    const input = workerIdentity.extend({ allow_existing: z.boolean().optional().default(true), allow_generated: z.boolean().optional().default(true), exclude_ids: z.array(id).max(6).optional().default([]) }).parse(await c.req.json());
    checkWorkerVersion(input.inkast_revision);
    const job = store().claim(c.get("plugin").id, input.worker_id, input.revision, enabled(), input.allow_existing, input.allow_generated, input.exclude_ids);
    return c.json({ job: job ? { ...publicJob(job), source_task_id: job.source_task_id, ...(job.card_stats_json ? { card_stats: JSON.parse(job.card_stats_json) } : {}), lease_token: job.leaseToken } : null });
  });
  routes.post("/worker/:id/layers/:layer", async c => {
    const input = z.object({ lease_token: sha }).strict().parse(await c.req.json());
    const layer = z.enum(["foreground", "background"]).parse(c.req.param("layer"));
    const plugin = c.get("plugin"), queue = store(), jobId = id.parse(c.req.param("id"));
    const job = queue.leased(plugin.id, jobId, input.lease_token);
    return c.json(await layers(queue, plugin, job, input.lease_token, layer));
  });
  routes.post("/worker/:id/renew", async c => {
    const input = z.object({ lease_token: sha, stage: z.string().regex(/^[a-z_0-9-]{1,40}$/) }).strict().parse(await c.req.json());
    store().renew(c.get("plugin").id, id.parse(c.req.param("id")), input.lease_token, input.stage);
    return c.json({ ok: true });
  });
  routes.post("/worker/:id/defer", async c => {
    const input = z.object({ lease_token: sha, stage: z.enum(["check_retry_wait", "plan_retry_wait"]), retry_after_ms: z.number().int().min(60000).max(300000) }).strict().parse(await c.req.json());
    return c.json(publicJob(store().defer(c.get("plugin").id, id.parse(c.req.param("id")), input.lease_token, input.retry_after_ms, input.stage)));
  });
  routes.post("/worker/:id/finish", async c => {
    const input = z.object({ lease_token: sha, status: z.enum(["needs_review", "failed"]), source_sha256: sha.optional(), code_sha256: sha.optional(), error_code: z.string().regex(/^[a-z_0-9]{1,60}$/) }).strict().parse(await c.req.json());
    return c.json(publicJob(store().finish(c.get("plugin").id, id.parse(c.req.param("id")), input.lease_token, { status: input.status, sourceSha256: input.source_sha256, codeSha256: input.code_sha256, errorCode: input.error_code })));
  });
  routes.put("/worker/:id/image", async c => {
    const plugin = c.get("plugin"), jobId = id.parse(c.req.param("id")), lease = sha.parse(c.req.header("x-v2-lease"));
    const sourceSha = sha.parse(c.req.header("x-v2-source-sha256")), codeSha = sha.parse(c.req.header("x-v2-code-sha256"));
    const existing = store().get(plugin.id, jobId);
    if (existing?.status === "succeeded" && existing.lease_hash === createHash("sha256").update(lease).digest("hex")) return c.json(publicJob(existing));
    const current = store().leased(plugin.id, jobId, lease);
    const baked = c.req.header("x-v2-stats-sha256");
    if (current.card_stats_json ? baked !== statsHash(JSON.parse(current.card_stats_json)) : baked !== undefined) throw new V2QueueError("stats_mismatch", 409);
    if (current.input_kind === "generated" && ["foreground", "background"].some(layer => JSON.parse(store().layer(plugin.id, jobId, layer) ?? "null")?.status !== "succeeded")) throw new V2QueueError("layers_incomplete", 409);
    const chunks: Uint8Array[] = []; let size = 0;
    if (c.req.raw.body) for await (const chunk of c.req.raw.body) { size += chunk.length; if (size > 8 * 1024 * 1024) return c.json({ error: { code: "image_too_large" } }, 413); chunks.push(chunk); }
    const body = Buffer.concat(chunks), meta = await sharp(body, { limitInputPixels: 1280 * 1280 }).metadata();
    if (meta.format !== "png" || meta.width !== 1280 || meta.height !== 1280 || !meta.hasAlpha || (meta.pages ?? 1) > 1) return c.json({ error: { code: "invalid_image" } }, 400);
    const storage = plugin.imageStorage;
    if (storage?.kind !== "r2") throw new V2QueueError("storage_unavailable", 503);
    // Match native V2's fixed square and frame origin. Reject any visible
    // overflow before extraction, including faint energy; never silently clip it.
    const pixels = await sharp(body).ensureAlpha().raw().toBuffer();
    const crop = { left: 128, top: 128, width: 1024, height: 1024 };
    let visible = false;
    for (let y = 0; y < 1280; y++) for (let x = 0; x < 1280; x++) if (pixels[(y * 1280 + x) * 4 + 3]! > 0) {
      visible = true;
      if (x < crop.left || y < crop.top || x >= crop.left + crop.width || y >= crop.top + crop.height) return c.json({ error: { code: "delivery_overflow" } }, 400);
    }
    if (!visible) return c.json({ error: { code: "empty_image" } }, 400);
    const delivered = await sharp(body).extract(crop).webp({ lossless: true, effort: 6 }).toBuffer();
    const hash = createHash("sha256").update(delivered).digest("hex"), key = `${storage.keyPrefix.replace(/\/$/, "")}/v2/${jobId}/${hash}.webp`;
    await upload({ bucket: storage.bucket, key, body: delivered, contentType: "image/webp" });
    const imageUrl = `${storage.publicBase.replace(/\/$/, "")}/${key}`;
    return c.json(publicJob(store().finish(plugin.id, jobId, lease, { status: "succeeded", imageUrl, geometry: { canvas_width: 1280, canvas_height: 1280, crop, ...(current.card_stats_json ? { stats_baked: true } : {}) }, sourceSha256: sourceSha, codeSha256: codeSha })));
  });
  return routes;
}
