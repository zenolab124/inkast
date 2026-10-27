import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { createHmac, createHash } from "node:crypto";
import sharp from "sharp";
import { createV2Store } from "../src/storage/v2-jobs.js";
import { createV2Routes } from "../src/server/routes/v2.js";
import type { InkastPlugin } from "../src/plugins/types.js";

test("direct creation is opt-in, private and lease-bound; callers cannot inject model or layer URLs", async () => {
  const conn = new Database(":memory:"); conn.exec(readFileSync(new URL("../src/storage/schema.sql", import.meta.url), "utf8"));
  const store = createV2Store(conn); store.heartbeat("snapub", "test-worker", "revision");
  const oldEnabled = process.env.INKAST_V2_ENABLED, oldDirect = process.env.INKAST_V2_GENERATION_ENABLED;
  process.env.INKAST_V2_ENABLED = "true"; delete process.env.INKAST_V2_GENERATION_ENABLED;
  const token = "test-token", owner = "a".repeat(64), jobId = "v2-33333333-3333-4333-8333-333333333333";
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const worker = { ...headers, "x-v2-worker": createHmac("sha256", token).update("static-v2-worker-v1").digest("hex") };
  const plugin: InkastPlugin = { id: "snapub", name: "Test", imageDefaults: {} };
  const app = new Hono(); app.use("*", async (c, next) => { c.set("plugin", plugin); await next(); });
  let calls = 0;
  app.route("/v2", createV2Routes({ store: () => store, layers: async () => { calls++; return { status: "submitted" }; } }));
  const post = (url: string, body: object, h = headers) => app.request(url, { method: "POST", headers: h, body: JSON.stringify(body) });
  const input = { id: jobId, owner_key: owner, prompt: "Original storm gardener", billing_version: 1 };
  try {
    assert.equal((await post("/v2/creations", input)).status, 503);
    process.env.INKAST_V2_GENERATION_ENABLED = "true";
    assert.equal((await post("/v2/creations", { ...input, provider: "injected" })).status, 400);
    const accepted = await (await post("/v2/creations", input)).json() as Record<string, unknown>;
    assert.equal(accepted.input_kind, "generated"); assert.equal(accepted.source_task_id, "");
    assert.equal(accepted.creation_json, undefined); assert.equal(accepted.prompt, undefined);
    assert.equal((await post("/v2/creations", { ...input, prompt: "different" })).status, 409);
    const job = store.claim("snapub", "test-worker", "revision", true)!;
    const body = { lease_token: job.leaseToken };
    assert.equal((await post(`/v2/worker/${jobId}/layers/foreground`, body)).status, 403);
    assert.equal((await post(`/v2/worker/${jobId}/layers/foreground`, { lease_token: owner }, worker)).status, 409);
    assert.equal((await post(`/v2/worker/${jobId}/layers/foreground`, { ...body, image_url: "https://evil.example/f.png" }, worker)).status, 400);
    assert.equal((await post(`/v2/worker/${jobId}/layers/foreground`, body, worker)).status, 200);
    assert.equal(calls, 1);
  } finally {
    if (oldEnabled === undefined) delete process.env.INKAST_V2_ENABLED; else process.env.INKAST_V2_ENABLED = oldEnabled;
    if (oldDirect === undefined) delete process.env.INKAST_V2_GENERATION_ENABLED; else process.env.INKAST_V2_GENERATION_ENABLED = oldDirect;
    conn.close();
  }
});

test("V2 routes reject wrong owner/worker/SSRF and publish one immutable alpha-preserving derivative", async () => {
  const conn = new Database(":memory:"); conn.exec(readFileSync(new URL("../src/storage/schema.sql", import.meta.url), "utf8"));
  const store = createV2Store(conn); store.heartbeat("snapub", "test-worker", "revision");
  const previous = process.env.INKAST_V2_ENABLED; process.env.INKAST_V2_ENABLED = "true";
  const token = "test-plugin-token", owner = "a".repeat(64), id = "v2-11111111-1111-4111-8111-111111111111";
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const worker = { ...headers, "x-v2-worker": createHmac("sha256", token).update("static-v2-worker-v1").digest("hex") };
  const stats = { region: "cn", cardKey: "ShangChi", sourceSha256: owner, cost: 0, power: null };
  const uploads: Buffer[] = []; const uploadTypes: string[] = [];
  const plugin: InkastPlugin = { id: "snapub", name: "Test", imageDefaults: {}, sourceImageHosts: ["https://images.example"], imageStorage: { kind: "r2", publicBase: "https://images.example", bucket: "test-only", keyPrefix: "aiVariants/", contentType: "image/png" } };
  const app = new Hono(); app.use("*", async (c, next) => { c.set("plugin", plugin); await next(); });
  app.route("/v2", createV2Routes({ store: () => store, upload: async input => { uploads.push(input.body); uploadTypes.push(input.contentType); return { bytes: input.body.length, attempts: 1, durationMs: 0 }; } }));
  const post = (route: string, body: object, h = headers) => app.request(route, { method: "POST", headers: h, body: JSON.stringify(body) });
  try {
    assert.equal((await post("/v2/worker/claim", { worker_id: "test-worker", revision: owner })).status, 403);
    assert.equal((await post("/v2/jobs", { id, owner_key: owner, task_id: "task-original", source_image_url: "http://127.0.0.1/private" })).status, 400);
    assert.equal((await post("/v2/jobs", { id, owner_key: owner, task_id: "task-original", source_image_url: "https://images.example/original.png", billing_version: 1, model: "injected" })).status, 400);
    assert.equal((await post("/v2/jobs", { id, owner_key: owner, task_id: "task-original", source_image_url: "https://images.example/original.png", billing_version: 1, card_stats: stats })).status, 202);
    assert.equal((await post("/v2/jobs", { id, owner_key: owner, task_id: "task-original", source_image_url: "https://images.example/original.png", billing_version: 1, card_stats: { ...stats, cost: 9 } })).status, 409);
    assert.equal((await app.request(`/v2/jobs/${id}`, { headers: { ...headers, "x-v2-owner": "b".repeat(64) } })).status, 404);
    assert.equal((await app.request('/v2/jobs', { headers })).status, 400);
    const ownList = await (await app.request('/v2/jobs?limit=1', { headers: { ...headers, 'x-v2-owner': owner } })).json() as { items: Array<Record<string, unknown>> };
    assert.equal(ownList.items[0]!.id, id);
    assert.equal(ownList.items[0]!.owner_key, undefined);
    assert.equal(ownList.items[0]!.lease_hash, undefined);
    assert.equal((await app.request('/v2/jobs?before_time=5', { headers: { ...headers, 'x-v2-owner': owner } })).status, 400);
    const claim = await (await post("/v2/worker/claim", { worker_id: "test-worker", revision: owner }, worker)).json() as { job: { lease_token: string } };
    const pixels = Buffer.alloc(1280 * 1280 * 4);
    for (let y = 250; y < 950; y++) for (let x = 200; x < 700; x++) { const i = (y * 1280 + x) * 4; pixels[i] = 200; pixels[i + 1] = y % 256; pixels[i + 2] = x % 256; pixels[i + 3] = 1 + (x + y) % 255; }
    // Even faint energy at the square boundary must survive without recentering.
    for (const [x, y] of [[128, 400], [1151, 400], [500, 128], [500, 1151]]) {
      const i = (y! * 1280 + x!) * 4; pixels[i] = 127; pixels[i + 3] = 1;
    }
    const body = await sharp(pixels, { raw: { width: 1280, height: 1280, channels: 4 } }).png().toBuffer();
    const imageHeaders = { ...worker, "content-type": "image/png", "x-v2-lease": claim.job.lease_token, "x-v2-source-sha256": owner, "x-v2-code-sha256": "c".repeat(64) };
    assert.equal((await app.request(`/v2/worker/${id}/image`, { method: "PUT", headers: imageHeaders, body })).status, 409);
    Object.assign(imageHeaders, { "x-v2-stats-sha256": createHash("sha256").update(JSON.stringify(stats)).digest("hex") });
    // Reject clipping before R2 upload or settlement; failed attempts keep the lease.
    for (const [x, y] of [[127, 400], [1152, 400], [500, 127], [500, 1152]]) {
      const overflow = Buffer.from(pixels); overflow[(y! * 1280 + x!) * 4 + 3] = 1;
      const png = await sharp(overflow, { raw: { width: 1280, height: 1280, channels: 4 } }).png().toBuffer();
      const rejected = await app.request(`/v2/worker/${id}/image`, { method: "PUT", headers: imageHeaders, body: png });
      assert.equal(rejected.status, 400); assert.equal((await rejected.json() as { error: { code: string } }).error.code, "delivery_overflow");
      assert.equal(uploads.length, 0); assert.notEqual(store.get("snapub", id)!.status, "succeeded");
    }
    const result = await app.request(`/v2/worker/${id}/image`, { method: "PUT", headers: imageHeaders, body });
    assert.equal(result.status, 200);
    const final = await result.json() as { geometry: { crop: { left: number; top: number; width: number; height: number } }; image_url: string };
    assert.equal((final as unknown as { stats_baked: boolean }).stats_baked, true);
    assert.deepEqual(final.geometry.crop, { left: 128, top: 128, width: 1024, height: 1024 });
    assert.match(final.image_url, /\/v2\/.*\/[a-f0-9]{64}\.webp$/);
    assert.equal(uploadTypes[0], "image/webp");
    const metadata = await sharp(uploads[0]).metadata();
    assert.equal(metadata.format, "webp"); assert.equal(metadata.hasAlpha, true);
    assert.equal(metadata.width, final.geometry.crop.width); assert.equal(metadata.height, final.geometry.crop.height);
    const delivered = await sharp(uploads[0]).raw().toBuffer();
    const expected = await sharp(body).extract(final.geometry.crop).raw().toBuffer();
    assert.equal(delivered.length, expected.length);
    let alphaDifferences = 0, visibleRgbDifferences = 0;
    for (let i = 0; i < expected.length; i += 4) {
      if (delivered[i + 3] !== expected[i + 3]) alphaDifferences++;
      if (expected[i + 3]! > 0 && [0,1,2].some(channel => delivered[i + channel] !== expected[i + channel])) visibleRgbDifferences++;
    }
    assert.equal(alphaDifferences, 0, "final WebP must preserve faint alpha and every out-of-frame boundary");
    assert.equal(visibleRgbDifferences, 0, "lossless WebP must retain all visible RGB");
    assert.equal((await app.request(`/v2/worker/${id}/image`, { method: "PUT", headers: imageHeaders, body })).status, 200);
    assert.equal(uploads.length, 1, "lost acknowledgement must not upload a second object");
  } finally { if (previous === undefined) delete process.env.INKAST_V2_ENABLED; else process.env.INKAST_V2_ENABLED = previous; conn.close(); }
});

test("check recovery endpoint is worker-only, validates cooldown and never exposes lease information", async () => {
  const conn = new Database(":memory:"); conn.exec(readFileSync(new URL("../src/storage/schema.sql", import.meta.url), "utf8"));
  const store = createV2Store(conn);
  const plugin: InkastPlugin = { id: "snapub", name: "test", imageDefaults: {} };
  const token = "test-token", proof = createHmac("sha256",token).update("static-v2-worker-v1").digest("hex");
  const headers = {authorization:`Bearer ${token}`,"content-type":"application/json"};
  const worker = {...headers,"x-v2-worker":proof};
  const app = new Hono(); app.use("*",async(c,next)=>{c.set("plugin",plugin);await next();});
  app.route("/v2",createV2Routes({store:()=>store}));
  const jobId="v2-22222222-2222-4222-8222-222222222222";
  try {
    store.heartbeat("snapub","test-worker","revision");
    store.submit({id:jobId,plugin:"snapub",owner:"owner",task:"task-original",source:"https://images.example/a.png",billingVersion:1});
    const job=store.claim("snapub","test-worker","revision",true)!;
    store.renew("snapub",jobId,job.leaseToken,"recovery_wait");
    const body={lease_token:job.leaseToken,stage:"check_retry_wait",retry_after_ms:60000};
    const post=(value:object,h:Record<string,string>=worker)=>app.request(`/v2/worker/${jobId}/defer`,{method:"POST",headers:h,body:JSON.stringify(value)});
    assert.equal((await post(body,headers)).status,403);
    assert.equal((await post({...body,retry_after_ms:1})).status,400);
    assert.equal((await post({...body,lease_token:"b".repeat(64)})).status,409);
    const result=await post(body); assert.equal(result.status,200);
    const data=await result.json() as Record<string,unknown>;
    assert.equal(data.status,"queued"); assert.equal(data.stage,"check_retry_wait");
    assert.equal(data.lease_hash,undefined); assert.equal(data.lease_token,undefined);
    assert.equal(data.owner_key,undefined);
    assert.equal((await post(body)).status,200);
    const next = store.claim("snapub", "test-worker", "revision", false);
    assert.equal(next, null);
    const planningId = "v2-33333333-3333-4333-8333-333333333333";
    store.submit({id:planningId,plugin:"snapub",owner:"other-owner",task:"task-another",source:"https://images.example/b.png",billingVersion:1});
    const planning = store.claim("snapub", "test-worker", "revision", true)!;
    store.renew("snapub", planning.id, planning.leaseToken, "plan_retry_wait");
    const planResponse = await app.request(`/v2/worker/${planningId}/defer`, {method:"POST",headers:worker,body:JSON.stringify({lease_token:planning.leaseToken,stage:"plan_retry_wait",retry_after_ms:60000})});
    assert.equal(planResponse.status, 200);
    assert.equal((await planResponse.json() as {stage:string}).stage, "plan_retry_wait");
  } finally { conn.close(); }
});


test("worker heartbeat is authenticated, version-bound and never claims or rewrites a job", async () => {
  const conn = new Database(":memory:"); conn.exec(readFileSync(new URL("../src/storage/schema.sql", import.meta.url), "utf8"));
  let now = 1000000; const store = createV2Store(conn, () => now);
  const plugin: InkastPlugin = { id: "snapub", name: "test", imageDefaults: {} };
  const token = "heartbeat-test", proof = createHmac("sha256",token).update("static-v2-worker-v1").digest("hex");
  const headers = {authorization:`Bearer ${token}`,"content-type":"application/json"};
  const app = new Hono(); app.use("*",async(c,next)=>{c.set("plugin",plugin);await next();});
  app.route("/v2",createV2Routes({store:()=>store}));
  const previous = process.env.INKAST_V2_REVISION; process.env.INKAST_V2_REVISION = "a".repeat(64);
  const identity = {worker_id:"test-worker", revision:"b".repeat(64), inkast_revision:"a".repeat(64)};
  const post = (body:object,h:Record<string,string>) => app.request('/v2/worker/heartbeat',{method:'POST',headers:h,body:JSON.stringify(body)});
  try {
    assert.equal((await post(identity,headers)).status,403); assert.equal(store.online("snapub"),false);
    const worker = {...headers,"x-v2-worker":proof};
    assert.equal((await post({...identity,inkast_revision:"c".repeat(64)},worker)).status,503);
    assert.equal(store.online("snapub"),false);
    assert.equal((await post(identity,worker)).status,200);
    store.submit({id:"heartbeat-queued",plugin:"snapub",owner:"owner",task:"source-original",source:"https://images.example/a.png",billingVersion:1});
    const before = store.get("snapub","heartbeat-queued");
    now += 121000; assert.equal(store.online("snapub"),false);
    assert.equal((await post(identity,worker)).status,200); assert.equal(store.online("snapub"),true);
    assert.deepEqual(store.get("snapub","heartbeat-queued"),before);
    assert.equal(store.get("snapub","heartbeat-queued")?.deliveries,0);
  } finally { if(previous===undefined)delete process.env.INKAST_V2_REVISION;else process.env.INKAST_V2_REVISION=previous;conn.close(); }
});


test("resource-aware claim is worker-only, strictly typed and leaves protected conversions queued", async () => {
  const conn = new Database(":memory:"); conn.exec(readFileSync(new URL("../src/storage/schema.sql", import.meta.url), "utf8"));
  const store = createV2Store(conn); store.heartbeat("snapub", "worker", "revision");
  const plugin: InkastPlugin = { id: "snapub", name: "test", imageDefaults: {} };
  const token = "resource-test", headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const worker = { ...headers, "x-v2-worker": createHmac("sha256", token).update("static-v2-worker-v1").digest("hex") };
  const identity = { worker_id: "test-worker", revision: "a".repeat(64), inkast_revision: "b".repeat(64) };
  const beforeEnabled = process.env.INKAST_V2_ENABLED, beforeRevision = process.env.INKAST_V2_REVISION;
  process.env.INKAST_V2_ENABLED = "true"; process.env.INKAST_V2_REVISION = identity.inkast_revision;
  const app = new Hono(); app.use("*", async(c,next) => { c.set("plugin",plugin); await next(); }); app.route("/v2", createV2Routes({store:()=>store}));
  const post = (body: object, h: Record<string, string> = worker) => app.request("/v2/worker/claim", {method:"POST", headers:h, body:JSON.stringify(body)});
  try {
    store.submit({id:"conversion",plugin:"snapub",owner:"one",task:"original",source:"https://images.example/a.png",billingVersion:1});
    store.submit({id:"native",plugin:"snapub",owner:"two",task:"",source:"",creation:{prompt:"Native scene"},billingVersion:1});
    assert.equal((await post({...identity,allow_existing:false},headers)).status,403);
    assert.equal((await post({...identity,allow_existing:"false"})).status,400);
    assert.equal((await post({...identity,allow_generated:"true"})).status,400);
    assert.equal((await (await post({...identity,allow_existing:false,allow_generated:false})).json() as {job:unknown}).job,null);
    assert.equal((await post({...identity,inkast_revision:"c".repeat(64),allow_existing:false})).status,503);
    assert.equal(store.get("snapub","conversion")?.deliveries,0);
    const response = await post({...identity,allow_existing:false}); assert.equal(response.status,200);
    const data = await response.json() as {job:{id:string;input_kind:string;lease_token:string;creation_json?:unknown}};
    assert.equal(data.job.id,"native"); assert.equal(data.job.input_kind,"generated"); assert.match(data.job.lease_token,/^[a-f0-9]{64}$/);
    assert.equal(data.job.creation_json,undefined);
    store.finish("snapub","native",data.job.lease_token,{status:"failed"});
    assert.equal((await (await post({...identity,allow_existing:false})).json() as {job:unknown}).job,null);
    const fallback = await (await post(identity)).json() as {job:{id:string}};
    assert.equal(fallback.job.id,"conversion");
  } finally {
    if(beforeEnabled===undefined)delete process.env.INKAST_V2_ENABLED;else process.env.INKAST_V2_ENABLED=beforeEnabled;
    if(beforeRevision===undefined)delete process.env.INKAST_V2_REVISION;else process.env.INKAST_V2_REVISION=beforeRevision;
    conn.close();
  }
});

test("recomposition HTTP route freezes server-side originals; claims carry prior composition; worker may request a bounded local repair", async () => {
  const conn = new Database(":memory:"); conn.exec(readFileSync(new URL("../src/storage/schema.sql", import.meta.url), "utf8"));
  const store = createV2Store(conn); store.heartbeat("snapub", "test-worker", "revision");
  const oldEnabled = process.env.INKAST_V2_ENABLED;
  process.env.INKAST_V2_ENABLED = "true";
  const owner = "a".repeat(64), sourceId = "v2-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", nextId = "v2-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const headers = { authorization: "Bearer token", "content-type": "application/json" };
  const worker = { ...headers, "x-v2-worker": createHmac("sha256", "token").update("static-v2-worker-v1").digest("hex") };
  const plugin: InkastPlugin = { id: "snapub", name: "Test", imageDefaults: {} };
  const app = new Hono(); app.use("*", async (c, next) => { c.set("plugin", plugin); await next(); });
  let drawings = 0;
  app.route("/v2", createV2Routes({ store: () => store, layers: async () => { drawings++; return { status: "failed", error_code: "repair_rejected" }; } }));
  const post = (url: string, body: object, h = headers) => app.request(url, { method: "POST", headers: h, body: JSON.stringify(body) });
  try {
    store.submit({ id: sourceId, plugin: "snapub", owner, task: "", source: "", billingVersion: 1, creation: { prompt: "Original" } });
    const first = store.claim("snapub", "test-worker", "revision", true)!;
    for (const name of ["foreground", "background"]) store.saveLayer("snapub", sourceId, first.leaseToken, name, JSON.stringify({ status: "succeeded", imageUrl: `https://images.example/${name}.png`, imageSha256: "b".repeat(64) }));
    const plan = { zoom: 1, centerX: .5, centerY: .5, rotationDeg: 0 };
    assert.equal((await post(`/v2/worker/${sourceId}/composition`, { lease_token: first.leaseToken, plan })).status, 403);
    assert.equal((await post(`/v2/worker/${sourceId}/composition`, { lease_token: first.leaseToken, plan }, worker)).status, 200);
    store.finish("snapub", sourceId, first.leaseToken, { status: "succeeded", imageUrl: "https://images.example/final.webp" });
    const input = { id: nextId, owner_key: owner, source_job_id: sourceId, instruction: "人物左移" };
    assert.equal((await post("/v2/recompositions", { ...input, foreground_url: "https://evil.example/f.png" })).status, 400);
    assert.equal((await post("/v2/recompositions", { ...input, owner_key: "c".repeat(64) })).status, 409);
    assert.equal((await post("/v2/recompositions", input)).status, 202);
    assert.equal((await post("/v2/recompositions", input)).status, 202);
    const claimed = await (await post("/v2/worker/claim", { worker_id: "test-worker", revision: "d".repeat(64) }, worker)).json() as { job: { id: string; lease_token: string; recomposition: { previousPlan: unknown; instruction: string } } };
    assert.equal(claimed.job.id, nextId); assert.deepEqual(claimed.job.recomposition.previousPlan, plan);
    assert.equal(claimed.job.recomposition.instruction, "人物左移");
    const repair = { lease_token: claimed.job.lease_token, foreground_sha256: "b".repeat(64), crop_png: "data", mask_png: "data", part: "sleeve", material: "solid" };
    assert.equal((await post(`/v2/worker/${nextId}/repair`, repair)).status, 403);
    assert.equal(drawings, 0);
    assert.equal((await post(`/v2/worker/${nextId}/repair`, repair, worker)).status, 200);
    assert.equal(drawings, 1);
  } finally {
    if (oldEnabled === undefined) delete process.env.INKAST_V2_ENABLED; else process.env.INKAST_V2_ENABLED = oldEnabled;
    conn.close();
  }
});

test("administrator recovery preserves original owner/layers, fences stale leases, prepares immutable candidates and adopts once", async () => {
  const conn = new Database(":memory:"); conn.exec(readFileSync(new URL("../src/storage/schema.sql", import.meta.url), "utf8"));
  const store = createV2Store(conn); store.heartbeat("snapub", "worker", "rev");
  const owner = "a".repeat(64), operator = "b".repeat(64), jobId = "v2-12345678-1234-4234-8234-123456789abc";
  const token = "test", headers = { authorization: `Bearer ${token}`, "content-type": "application/json" }, worker = { ...headers, "x-v2-worker": createHmac("sha256", token).update("static-v2-worker-v1").digest("hex") };
  const plugin: InkastPlugin = { id: "snapub", name: "test", imageDefaults: {}, imageStorage: { kind: "r2", bucket: "test", publicBase: "https://images.example", keyPrefix: "art/", contentType: "image/png" } };
  let uploads = 0;
  const app = new Hono(); app.use("*", async (c, next) => { c.set("plugin", plugin); await next(); });
  app.route("/v2", createV2Routes({ store: () => store, upload: async input => { uploads++; assert.equal(input.contentType, "image/webp"); return { bytes: input.body.length, attempts: 1, durationMs: 0 }; } }));
  const post = (route: string, body: object, h = headers) => app.request(route, { method: "POST", headers: h, body: JSON.stringify(body) });
  try {
    store.submit({ id: jobId, plugin: "snapub", owner, task: "", source: "", billingVersion: 1, creation: { prompt: "original" } });
    const first = store.claim("snapub", "worker", "old", true)!;
    const recovery = { task_id: jobId, owner_key: owner, operator, request_id: "recovery-request-1", mode: "preview" };
    assert.equal((await post("/v2/recoveries", recovery)).status, 409, "cannot reset running work");
    for (const [name, char] of [["foreground", "f"], ["background", "e"]]) store.saveLayer("snapub", jobId, first.leaseToken, name!, JSON.stringify({ status: "succeeded", imageUrl: `https://images.example/${name}.png`, imageSha256: char!.repeat(64) }));
    const fgBefore = store.layer("snapub", jobId, "foreground"), bgBefore = store.layer("snapub", jobId, "background");
    store.finish("snapub", jobId, first.leaseToken, { status: "failed", errorCode: "composition_validation_failed" });
    assert.equal((await post("/v2/recoveries", { ...recovery, owner_key: operator })).status, 409);
    assert.equal((await post("/v2/recoveries", { ...recovery, image_url: "https://evil.example/a.webp" })).status, 400);
    assert.equal((await post("/v2/recoveries", recovery)).status, 202);
    const lease = store.claim("snapub", "worker", "new", true)!;
    assert.equal((await post("/v2/recoveries", recovery)).status, 202, "same recovery ID does not reset a running lease");
    assert.equal(store.get("snapub", jobId)!.deliveries, 1);
    assert.throws(() => store.finish("snapub", jobId, first.leaseToken, { status: "failed" }), /lease_lost/);
    const pixels = Buffer.alloc(1280 * 1280 * 4); pixels[(500 * 1280 + 500) * 4 + 3] = 255;
    const png = await sharp(pixels, { raw: { width: 1280, height: 1280, channels: 4 } }).png().toBuffer();
    const input = { lease_token: lease.leaseToken, png_base64: png.toString("base64"), source_sha256: owner, code_sha256: operator,
      foreground_sha256: "f".repeat(64), background_sha256: "e".repeat(64), stats_sha256: null, plan: { zoom: 1, centerX: .5, centerY: .5, rotationDeg: 0 } };
    assert.equal((await post(`/v2/worker/${jobId}/candidates`, input)).status, 403);
    assert.equal((await post(`/v2/worker/${jobId}/candidates`, { ...input, foreground_sha256: owner }, worker)).status, 409);
    const overflow = Buffer.from(pixels); overflow[3] = 1;
    const bad = await sharp(overflow, { raw: { width: 1280, height: 1280, channels: 4 } }).png().toBuffer();
    assert.equal((await post(`/v2/worker/${jobId}/candidates`, { ...input, png_base64: bad.toString("base64") }, worker)).status, 400);
    const candidate = await (await post(`/v2/worker/${jobId}/candidates`, input, worker)).json() as { id: string };
    await post(`/v2/worker/${jobId}/candidates`, input, worker); assert.equal(uploads, 1);
    assert.equal((await app.request(`/v2/jobs/${jobId}/candidates`, { headers: { ...headers, "x-v2-owner": operator } })).status, 404);
    store.finish("snapub", jobId, lease.leaseToken, { status: "needs_review", errorCode: "recovery_candidates_ready" });
    const adopt = { ...recovery, request_id: "adoption-request-1", mode: "adopt", candidate_id: candidate.id };
    assert.equal((await post("/v2/recoveries", { ...adopt, candidate_id: "d".repeat(64) })).status, 409);
    assert.equal((await post("/v2/recoveries", adopt)).status, 202);
    const done = store.get("snapub", jobId)!; assert.equal(done.status, "succeeded"); assert.equal(done.owner_key, owner); assert.match(done.image_url!, /\.webp$/);
    assert.deepEqual(store.get("snapub", jobId), done);
    assert.equal((await post("/v2/recoveries", adopt)).status, 202);
    assert.deepEqual(store.get("snapub", jobId), done, "duplicate adopt does not change timeline or artwork");
    assert.equal((await post("/v2/recoveries", { ...adopt, request_id: "another-adoption" })).status, 409);
    assert.equal(store.layer("snapub", jobId, "foreground"), fgBefore); assert.equal(store.layer("snapub", jobId, "background"), bgBefore);
    assert.equal(store.list("snapub", owner, 12).items[0]!.status, "succeeded"); assert.equal(store.list("snapub", operator, 12).items.length, 0);
  } finally { conn.close(); }
});
