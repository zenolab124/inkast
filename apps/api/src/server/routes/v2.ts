import { Hono } from "hono";
import { z } from "zod";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import sharp from "sharp";
import { v2Store, V2QueueError, V2_DAILY_LIMIT, type V2Job } from "../../storage/v2-jobs.js";
import { validateVisionImage } from "../../domain/vision/index.js";
import { putImage } from "../../drivers/storage/r2.js";

const id = z.string().regex(/^[a-zA-Z0-9_-]{8,80}$/);
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const publicJob = (j: V2Job) => ({ id: j.id, status: j.status, stage: j.stage, image_url: j.image_url,
  source_image_url: j.source_url, source_sha256: j.source_sha256, code_sha256: j.code_sha256,
  error_code: j.error_code, geometry: j.geometry_json ? JSON.parse(j.geometry_json) : null, updated_at: j.updated_at });
const enabled = () => process.env.INKAST_V2_ENABLED === "true";

export function createV2Routes(dependencies: { store?: typeof v2Store; upload?: typeof putImage } = {}): Hono {
  const store = dependencies.store ?? v2Store;
  const upload = dependencies.upload ?? putImage;
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
  routes.get("/config", c => c.json({ enabled: enabled() && store().online(c.get("plugin").id), energy_cost: 0, daily_limit: V2_DAILY_LIMIT, max_attempts: 2, revision: process.env.INKAST_V2_REVISION ?? null }));
  routes.post("/jobs", async c => {
    const input = z.object({ id, owner_key: sha, task_id: id, source_image_url: z.string().max(4096) }).strict().parse(await c.req.json());
    const plugin = c.get("plugin");
    if (!enabled() && !store().get(plugin.id, input.id)) throw new V2QueueError("v2_disabled", 503);
    try { await validateVisionImage(input.source_image_url, plugin); } catch { return c.json({ error: { code: "source_not_allowed" } }, 400); }
    if (!input.source_image_url.startsWith("https://")) return c.json({ error: { code: "source_not_allowed" } }, 400);
    const job = store().submit({ id: input.id, plugin: plugin.id, owner: input.owner_key, task: input.task_id, source: input.source_image_url });
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
  routes.post("/worker/claim", async c => {
    const input = z.object({ worker_id: id, revision: sha, inkast_revision: sha.optional() }).strict().parse(await c.req.json());
    if (process.env.INKAST_V2_REVISION && input.inkast_revision !== process.env.INKAST_V2_REVISION) throw new V2QueueError("worker_version_mismatch", 503);
    const job = store().claim(c.get("plugin").id, input.worker_id, input.revision, enabled());
    return c.json({ job: job ? { ...publicJob(job), source_task_id: job.source_task_id, lease_token: job.leaseToken } : null });
  });
  routes.post("/worker/:id/renew", async c => {
    const input = z.object({ lease_token: sha, stage: z.string().regex(/^[a-z_0-9-]{1,40}$/) }).strict().parse(await c.req.json());
    store().renew(c.get("plugin").id, id.parse(c.req.param("id")), input.lease_token, input.stage);
    return c.json({ ok: true });
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
    store().leased(plugin.id, jobId, lease);
    const chunks: Uint8Array[] = []; let size = 0;
    if (c.req.raw.body) for await (const chunk of c.req.raw.body) { size += chunk.length; if (size > 8 * 1024 * 1024) return c.json({ error: { code: "image_too_large" } }, 413); chunks.push(chunk); }
    const body = Buffer.concat(chunks), meta = await sharp(body, { limitInputPixels: 1280 * 1280 }).metadata();
    if (meta.format !== "png" || meta.width !== 1280 || meta.height !== 1280 || !meta.hasAlpha || (meta.pages ?? 1) > 1) return c.json({ error: { code: "invalid_image" } }, 400);
    const storage = plugin.imageStorage;
    if (storage?.kind !== "r2") throw new V2QueueError("storage_unavailable", 503);
    // Remove transparent padding only. The full alpha bounds plus 32px margin
    // survive, so display/save never crop out-of-frame anatomy to a rectangle.
    const pixels = await sharp(body).ensureAlpha().raw().toBuffer();
    let left = 1280, top = 1280, right = -1, bottom = -1;
    for (let y = 0; y < 1280; y++) for (let x = 0; x < 1280; x++) if (pixels[(y * 1280 + x) * 4 + 3]! > 0) { left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); }
    if (right < 0) return c.json({ error: { code: "empty_image" } }, 400);
    left = Math.max(0, left - 32); top = Math.max(0, top - 32); right = Math.min(1279, right + 32); bottom = Math.min(1279, bottom + 32);
    const crop = { left, top, width: right - left + 1, height: bottom - top + 1 };
    const delivered = await sharp(body).extract(crop).png().toBuffer();
    const hash = createHash("sha256").update(delivered).digest("hex"), key = `${storage.keyPrefix.replace(/\/$/, "")}/v2/${jobId}/${hash}.png`;
    await upload({ bucket: storage.bucket, key, body: delivered, contentType: "image/png" });
    const imageUrl = `${storage.publicBase.replace(/\/$/, "")}/${key}`;
    return c.json(publicJob(store().finish(plugin.id, jobId, lease, { status: "succeeded", imageUrl, geometry: { canvas_width: 1280, canvas_height: 1280, crop }, sourceSha256: sourceSha, codeSha256: codeSha })));
  });
  return routes;
}
