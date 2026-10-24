import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import sharp from "sharp";
import { createV2Store } from "../src/storage/v2-jobs.js";
import { createV2Routes } from "../src/server/routes/v2.js";
import type { InkastPlugin } from "../src/plugins/types.js";

test("V2 routes reject wrong owner/worker/SSRF and publish one immutable alpha-preserving derivative", async () => {
  const conn = new Database(":memory:"); conn.exec(readFileSync(new URL("../src/storage/schema.sql", import.meta.url), "utf8"));
  const store = createV2Store(conn); store.claim("snapub", "test-worker", "revision", false);
  const previous = process.env.INKAST_V2_ENABLED; process.env.INKAST_V2_ENABLED = "true";
  const token = "test-plugin-token", owner = "a".repeat(64), id = "v2-11111111-1111-4111-8111-111111111111";
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const worker = { ...headers, "x-v2-worker": createHmac("sha256", token).update("static-v2-worker-v1").digest("hex") };
  const uploads: Buffer[] = [];
  const plugin: InkastPlugin = { id: "snapub", name: "Test", imageDefaults: {}, sourceImageHosts: ["https://images.example"], imageStorage: { kind: "r2", publicBase: "https://images.example", bucket: "test-only", keyPrefix: "aiVariants/", contentType: "image/png" } };
  const app = new Hono(); app.use("*", async (c, next) => { c.set("plugin", plugin); await next(); });
  app.route("/v2", createV2Routes({ store: () => store, upload: async input => { uploads.push(input.body); return { bytes: input.body.length, attempts: 1, durationMs: 0 }; } }));
  const post = (route: string, body: object, h = headers) => app.request(route, { method: "POST", headers: h, body: JSON.stringify(body) });
  try {
    assert.equal((await post("/v2/worker/claim", { worker_id: "test-worker", revision: owner })).status, 403);
    assert.equal((await post("/v2/jobs", { id, owner_key: owner, task_id: "task-original", source_image_url: "http://127.0.0.1/private" })).status, 400);
    assert.equal((await post("/v2/jobs", { id, owner_key: owner, task_id: "task-original", source_image_url: "https://images.example/original.png", model: "injected" })).status, 400);
    assert.equal((await post("/v2/jobs", { id, owner_key: owner, task_id: "task-original", source_image_url: "https://images.example/original.png" })).status, 202);
    assert.equal((await app.request(`/v2/jobs/${id}`, { headers: { ...headers, "x-v2-owner": "b".repeat(64) } })).status, 404);
    const claim = await (await post("/v2/worker/claim", { worker_id: "test-worker", revision: owner }, worker)).json() as { job: { lease_token: string } };
    const pixels = Buffer.alloc(1280 * 1280 * 4);
    for (let y = 300; y < 800; y++) for (let x = 200; x < 700; x++) { const i = (y * 1280 + x) * 4; pixels[i] = 200; pixels[i + 3] = 123; }
    const body = await sharp(pixels, { raw: { width: 1280, height: 1280, channels: 4 } }).png().toBuffer();
    const imageHeaders = { ...worker, "content-type": "image/png", "x-v2-lease": claim.job.lease_token, "x-v2-source-sha256": owner, "x-v2-code-sha256": "c".repeat(64) };
    const result = await app.request(`/v2/worker/${id}/image`, { method: "PUT", headers: imageHeaders, body });
    assert.equal(result.status, 200);
    const final = await result.json() as { geometry: { crop: { left: number; top: number; width: number; height: number } }; image_url: string };
    assert.deepEqual(final.geometry.crop, { left: 168, top: 268, width: 564, height: 564 });
    assert.match(final.image_url, /\/v2\/.*\/[a-f0-9]{64}\.png$/);
    const delivered = await sharp(uploads[0]).raw().toBuffer();
    const expected = await sharp(body).extract(final.geometry.crop).raw().toBuffer();
    assert.deepEqual(delivered, expected, "transparent padding removal must not change foreground RGBA");
    assert.equal((await app.request(`/v2/worker/${id}/image`, { method: "PUT", headers: imageHeaders, body })).status, 200);
    assert.equal(uploads.length, 1, "lost acknowledgement must not upload a second object");
  } finally { if (previous === undefined) delete process.env.INKAST_V2_ENABLED; else process.env.INKAST_V2_ENABLED = previous; conn.close(); }
});
