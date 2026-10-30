import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPluginConfigsFromDir } from "../src/plugins/loader.js";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { rewriteBlockedPrompt } from "../src/domain/rewrite-prompt/index.js";
import { LlmDriverError } from "../src/drivers/llm/types.js";
import { createV2Layers, layerPrompt } from "../src/domain/v2-layers.js";
import { createV2Store } from "../src/storage/v2-jobs.js";
import type { InkastPlugin } from "../src/plugins/types.js";

async function fixture() {
  const conn = new Database(":memory:"); conn.exec(readFileSync(new URL("../src/storage/schema.sql", import.meta.url), "utf8"));
  let now = Date.now(); const store = createV2Store(conn, () => now);
  store.heartbeat("snapub", "worker", "revision");
  const input = { id: "direct-job", plugin: "snapub", owner: "owner", task: "", source: "", billingVersion: 1, creation: { prompt: "Original storm gardener with translucent magical ribbons" } };
  const job = store.submit(input), claim = store.claim("snapub", "worker", "revision", true)!;
  const entry = { provider: { id: "gpt", name: "GPT", baseUrl: "https://upstream.example/v1", createdAt: 1, updatedAt: 1, capabilities: [] }, capability: { kind: "image" as const, model: "gpt-image-2", priority: 0, disabled: false, extras: { mode: "c2i-tasks" } }, apiKey: "test-secret" };
  const plugin: InkastPlugin = { id: "snapub", name: "test", imageDefaults: {}, imageProviderIds: ["gpt"], sourceImageHosts: ["https://images.example"] };
  const subject = await sharp({ create: { width: 300, height: 600, channels: 4, background: "#cf7842" } }).png().toBuffer();
  const png = await sharp({ create: { width: 1024, height: 1280, channels: 4, background: "transparent" } }).composite([{ input: subject, left: 360, top: 400 }]).png().toBuffer();
  const backgroundPng = await sharp({ create: { width: 1024, height: 1536, channels: 4, background: "#184851" } }).png().toBuffer();
  return { conn, store, input, job, claim, plugin, entry, png, backgroundPng, advance: (ms: number) => { now += ms; } };
}

test("native-layer submit survives a lost acknowledgement/restart and background reuses foreground/channel", async () => {
  const f = await fixture(); const requests: Array<{ url: string; body: Record<string, unknown> | null }> = [];
  let loseAck = true, upstreamId = "";
  const request: typeof fetch = async (url, init) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    requests.push({ url: String(url), body });
    if (String(url).startsWith("https://images.example")) return new Response(new Uint8Array(String(url).endsWith("background.png") ? f.backgroundPng : f.png));
    if (init?.method === "POST") {
      upstreamId = body.client_task_id;
      if (loseAck) { loseAck = false; throw Error("ack lost after admission"); }
      return Response.json({ id: upstreamId, status: "queued" });
    }
    const taskId = new URL(String(url)).searchParams.get("ids");
    const background = requests.some(r => r.body?.client_task_id === taskId && r.body?.background === "opaque");
    return Response.json({ items: [{ id: taskId, status: "success", data: [{ url: background ? "https://images.example/background.png" : "https://images.example/layer.png" }] }] });
  };
  const make = () => createV2Layers({ providers: () => [f.entry], provider: () => f.entry, fetch: request });
  try {
    await assert.rejects(make()(f.store, f.plugin, f.job, f.claim.leaseToken, "background"), /foreground_required/);
    await assert.rejects(make()(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground"), /ack lost/);
    const resumed = await make()(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground");
    assert.equal(resumed.status, "succeeded");
    assert.equal(requests.filter(r => r.body?.client_task_id).length, 1, "restart must GET the original task without a second submission");
    await make()(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground");
    assert.equal(requests.filter(r => r.url.includes("?ids=")).length, 1, "completed layers are durable");
    await make()(f.store, f.plugin, f.job, f.claim.leaseToken, "background");
    const posts = requests.filter(r => r.body?.client_task_id);
    assert.equal(posts.length, 2); assert.notEqual(posts[0]!.body!.client_task_id, posts[1]!.body!.client_task_id);
    assert.equal(posts[0]!.body!.background, "transparent"); assert.equal(posts[1]!.body!.background, "opaque");
    assert.equal(posts[0]!.body!.optimize_output, false);
    assert.equal(posts[0]!.body!.size, "1024x1280"); assert.equal(posts[1]!.body!.size, "1024x1536");
    assert.deepEqual(posts[1]!.body!.images, [`data:image/png;base64,${f.png.toString("base64")}`]);
    assert.throws(() => f.store.submit({ ...f.input, creation: { prompt: "changed creative brief" } }), /idempotency_conflict/);
    f.advance(181000);
    const fresh = f.store.claim("snapub", "worker", "revision", true)!;
    assert.throws(() => f.store.saveLayer("snapub", f.job.id, f.claim.leaseToken, "foreground", "{}"), /lease_lost/);
    assert.equal((await make()(f.store, f.plugin, f.job, fresh.leaseToken, "background")).status, "succeeded");
  } finally { f.conn.close(); }
});

test("missing admission record keeps polling the original ID and fails only at the bounded deadline", async () => {
  const f = await fixture(); let posts = 0;
  let now = Date.now();
  const run = createV2Layers({ providers: () => [f.entry], provider: () => f.entry, now: () => now, fetch: async (url, init) => {
    if (init?.method === "POST") { posts++; throw Error("connection lost"); }
    return Response.json({ missing_ids: [new URL(String(url)).searchParams.get("ids")] });
  } });
  try {
    await assert.rejects(run(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground"));
    assert.equal((await run(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground")).status, "submitted");
    assert.equal(JSON.parse(f.store.layer("snapub", f.job.id, "foreground")!).upstreamStatus, "awaiting_admission");
    now += 46 * 60_000;
    assert.equal((await run(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground")).error_code, "generation_task_missing");
    assert.equal(posts, 1);
    await assert.rejects(run(f.store, { ...f.plugin, imageProviderIds: [] }, f.job, f.claim.leaseToken, "background"), /foreground_required/);
  } finally { f.conn.close(); }
});

test("upstream execution failure, corrupt PNG and timeout are durable terminal stages without regeneration", async () => {
  for (const failure of ["error", "invalid", "timeout"] as const) {
    const f = await fixture(); let posts = 0;
    const run = createV2Layers({ providers: () => [f.entry], provider: () => f.entry, now: () => failure === "timeout" && posts ? Date.now() + 46 * 60_000 : Date.now(), fetch: async (url, init) => {
      if (String(url).startsWith("https://images.example")) return new Response("not a png");
      if (init?.method === "POST") { posts++; const body = JSON.parse(String(init.body)); return Response.json({ id: body.client_task_id, status: "queued" }); }
      return Response.json({ items: [{ id: new URL(String(url)).searchParams.get("ids"), status: failure === "error" ? "error" : "success", error_code: "generation_failed", error: "image execution failed", data: [{ url: "https://images.example/bad.png" }] }] });
    } });
    try {
      await run(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground");
      const failed = await run(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground");
      assert.equal(failed.status, "failed");
      assert.equal(failed.error_code, failure === "error" ? "generation_failed" : failure === "invalid" ? "invalid_generated_layer" : "generation_timeout");
      assert.equal((await run(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground")).status, "failed");
      assert.equal(posts, 1);
    } finally { f.conn.close(); }
  }
});


test("delayed background admission after a lost POST acknowledgement reuses both successful layers without regeneration", async () => {
  const f = await fixture(); let foregroundId = "", backgroundId = "", misses = 0;
  const posts: string[] = [];
  const request: typeof fetch = async (url, init) => {
    if (String(url).startsWith("https://images.example")) return new Response(new Uint8Array(String(url).endsWith("background.png") ? f.backgroundPng : f.png));
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body)); posts.push(body.client_task_id);
      if (body.background === "transparent") { foregroundId = body.client_task_id; return Response.json({id:foregroundId,status:"success",data:[{url:"https://images.example/foreground.png"}]}); }
      backgroundId = body.client_task_id; throw Error("POST timed out while upstream fetches reference");
    }
    const id = new URL(String(url)).searchParams.get("ids"); assert.equal(id, backgroundId);
    if (misses++ < 8) return Response.json({items:[],missing_ids:[id]});
    return Response.json({items:[{id,status:"success",data:[{url:"https://images.example/background.png"}]}],missing_ids:[]});
  };
  const make = () => createV2Layers({providers:()=>[f.entry],provider:()=>f.entry,fetch:request});
  try {
    assert.equal((await make()(f.store,f.plugin,f.job,f.claim.leaseToken,"foreground")).status,"succeeded");
    await assert.rejects(make()(f.store,f.plugin,f.job,f.claim.leaseToken,"background"),/POST timed out/);
    for (let i=0;i<8;i++) assert.equal((await make()(f.store,f.plugin,f.job,f.claim.leaseToken,"background")).status,"submitted");
    assert.equal((await make()(f.store,f.plugin,f.job,f.claim.leaseToken,"background")).status,"succeeded");
    assert.deepEqual(posts,[foregroundId,backgroundId]);
    assert.equal(JSON.parse(f.store.layer("snapub",f.job.id,"background")!).upstreamStatus,"success");
  } finally { f.conn.close(); }
});

test("durable admission permits bounded identical-ID resubmission only after confirmed missing", async () => {
  const f = await fixture(); let now = Date.now(), posts = 0; const bodies: unknown[] = [];
  const run = () => createV2Layers({ providers: () => [f.entry], provider: () => f.entry, now: () => now, fetch: async (url, init) => {
    if (String(url).startsWith("https://images.example")) return new Response(new Uint8Array(String(url).endsWith("background.png") ? f.backgroundPng : f.png));
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body)); bodies.push(body); posts++;
      if (posts === 1) throw Error("POST did not reach admission");
      return Response.json({ id: body.client_task_id, status: "queued" });
    }
    const id = new URL(String(url)).searchParams.get("ids");
    return posts === 1 ? Response.json({ items: [], missing_ids: [id] }, { headers: { "x-image-task-admission": "durable-v1" } }) :
      Response.json({ items: [{ id, status: "success", data: [{ url: "https://images.example/layer.png" }] }] });
  } });
  try {
    await assert.rejects(run()(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground"));
    assert.equal((await run()(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground")).phase, "awaiting_admission");
    assert.equal(posts, 1);
    now += 10_001;
    assert.equal((await run()(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground")).phase, "queued");
    assert.deepEqual(bodies[0], bodies[1]);
    assert.equal((await run()(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground")).status, "succeeded");
    assert.equal(posts, 2);
  } finally { f.conn.close(); }
});

test("durable missing after three unacknowledged posts terminates without a fourth submit", async () => {
  const f = await fixture(); let now = Date.now(), posts = 0;
  const run = createV2Layers({ providers: () => [f.entry], provider: () => f.entry, now: () => now, fetch: async (url, init) => {
    if (init?.method === "POST") { posts++; throw Error("lost request"); }
    return Response.json({ items: [], missing_ids: [new URL(String(url)).searchParams.get("ids")] }, { headers: { "x-image-task-admission": "durable-v1" } });
  } });
  try {
    for (let i = 0; i < 3; i++) {
      await assert.rejects(run(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground"));
      const result = await run(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground");
      assert.equal(result.status, i === 2 ? "failed" : "submitted");
      if (i === 2) assert.equal(result.error_code, "generation_submission_failed");
      now += 10_001;
    }
    await run(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground");
    assert.equal(posts, 3);
  } finally { f.conn.close(); }
});

test("an acknowledged task that disappears is never regenerated, even on the new protocol", async () => {
  const f = await fixture(); let posts = 0;
  const run = createV2Layers({ providers: () => [f.entry], provider: () => f.entry, fetch: async (url, init) => {
    if (init?.method === "POST") { posts++; return Response.json({ id: JSON.parse(String(init.body)).client_task_id, status: "queued" }); }
    return Response.json({ items: [], missing_ids: [new URL(String(url)).searchParams.get("ids")] }, { headers: { "x-image-task-admission": "durable-v1" } });
  } });
  try {
    await run(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground");
    assert.equal((await run(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground")).error_code, "generation_task_missing");
    await run(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground"); assert.equal(posts, 1);
  } finally { f.conn.close(); }
});

test("explicit JSON refusal terminates; Cloudflare HTML errors remain transport uncertainty", async () => {
  for (const [status, html, expected] of [[413, false, "generation_submission_failed"], [403, false, "generation_auth_failed"], [409, false, "generation_submission_conflict"], [403, true, null], [530, true, null]] as const) {
    const f = await fixture(); let calls = 0;
    const run = createV2Layers({ providers: () => [f.entry], provider: () => f.entry, fetch: async (_url, init) => {
      calls++;
      if (init?.method === "POST") return html ? new Response("<html>Cloudflare error</html>", { status, headers: { "content-type": "text/html" } }) : Response.json({ detail: { error: "refused" } }, { status });
      return Response.json({ items: [], missing_ids: ["unknown"] });
    } });
    try {
      if (expected) {
        assert.equal((await run(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground")).error_code, expected);
        await run(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground"); assert.equal(calls, 1);
      } else {
        await assert.rejects(run(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground"), /generation_connection_pending/);
        assert.equal(JSON.parse(f.store.layer("snapub", f.job.id, "foreground")!).status, "submitted");
      }
    } finally { f.conn.close(); }
  }
});

test("durable preparation errors are distinguished from image-model rejection", async () => {
  for (const [error_code, expected] of [["request_preparation_failed", "generation_submission_failed"], ["admission_capacity", "generation_queue_full"], ["generation_failed", "generation_failed"]]) {
    const f = await fixture();
    const run = createV2Layers({ providers: () => [f.entry], provider: () => f.entry, fetch: async (_url, init) => Response.json({ id: JSON.parse(String(init!.body)).client_task_id, status: "error", error_code }) });
    try { assert.equal((await run(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground")).error_code, expected); }
    finally { f.conn.close(); }
  }
});

test("new admission protocol sends a compact foreground URL with the frozen byte hash", async () => {
  const f = await fixture(); let downloads = 0; const posts: Array<{body: any; headers: any; bytes: number}> = [];
  const run = createV2Layers({providers:()=>[f.entry],provider:()=>f.entry,fetch:async(url,init)=>{
    if(String(url).startsWith('https://images.example')) { downloads++; return new Response(new Uint8Array(String(url).endsWith("background.png") ? f.backgroundPng : f.png)); }
    const body=JSON.parse(String(init?.body));posts.push({body,headers:init?.headers,bytes:Buffer.byteLength(String(init?.body))});
    return Response.json({id:body.client_task_id,status:body.background==='transparent'?'success':'queued',data:[{url:'https://images.example/frozen.png'}]}, {headers:{'x-image-task-admission':'durable-v1'}});
  }});
  try {
    const fg=await run(f.store,f.plugin,f.job,f.claim.leaseToken,'foreground');
    assert.equal(fg.status,'succeeded');
    await run(f.store,f.plugin,f.job,f.claim.leaseToken,'background');
    assert.deepEqual(posts[1]!.body.images,['https://images.example/frozen.png']);
    assert.equal(posts[1]!.headers['X-Reference-Image-Sha256'],fg.image_sha256);
    assert.ok(posts[1]!.bytes < 6000);
    assert.equal(downloads,1,'background admission does not download and re-upload the foreground');
  } finally {f.conn.close();}
});


test("small source margins do not reject valid foregrounds or prevent background generation", async () => {
  for (const [left, top] of [[16, 400], [988, 400], [400, 16], [400, 1240]]) {
    const f = await fixture(); let posts = 0;
    const cut = await sharp({ create: { width: 20, height: 20, channels: 4, background: "#cf7842" } }).png().toBuffer();
    const png = await sharp(f.png).composite([{ input: cut, left, top }]).png().toBuffer();
    const run = createV2Layers({ providers: () => [f.entry], provider: () => f.entry, fetch: async (url, init) => {
      if (String(url).startsWith("https://images.example")) return new Response(new Uint8Array(String(url).endsWith("background.png") ? f.backgroundPng : png));
      posts++;
      return Response.json({ id: JSON.parse(String(init!.body)).client_task_id, status: "success", data: [{ url: posts === 1 ? "https://images.example/foreground.png" : "https://images.example/background.png" }] });
    } });
    try {
      const result = await run(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground");
      assert.equal(result.status, "succeeded");
      assert.equal((await run(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground")).status, "succeeded");
      assert.equal(posts, 1);
      assert.equal((await run(f.store, f.plugin, f.job, f.claim.leaseToken, "background")).status, "succeeded");
      assert.equal(posts, 2);
    } finally { f.conn.close(); }
  }
});

test("local repair binds frozen foreground and payload, survives lost acknowledgement, and persists rejection without resubmission", async () => {
  const f = await fixture(); let posts = 0, repairId = "";
  const square = await sharp({ create: { width: 1024, height: 1024, channels: 4, background: "transparent" } }).png().toBuffer();
  const data = `data:image/png;base64,${square.toString("base64")}`;
  const input = { foreground_sha256: "a".repeat(64), crop_png: data, mask_png: data, part: "右侧袖口", material: "solid" as const };
  f.store.saveLayer("snapub", f.job.id, f.claim.leaseToken, "foreground", JSON.stringify({ status: "succeeded", imageSha256: input.foreground_sha256, providerId: f.entry.provider.id }));
  // First create the foreground through the real layer state to bind provider hash.
  f.store.saveLayer("snapub", f.job.id, f.claim.leaseToken, "foreground", "null");
  const base = createV2Layers({ providers: () => [f.entry], provider: () => f.entry, fetch: async (url, init) => {
    if (String(url).startsWith("https://images.example")) return new Response(new Uint8Array(String(url).endsWith("background.png") ? f.backgroundPng : f.png));
    if (init?.method === "POST") return Response.json({ id: JSON.parse(String(init.body)).client_task_id, status: "queued" });
    return Response.json({ items: [{ id: new URL(String(url)).searchParams.get("ids"), status: "success", data: [{ url: "https://images.example/layer.png" }] }] });
  } });
  const make = () => createV2Layers({ providers: () => [f.entry], provider: () => f.entry, fetch: async (_url, init) => {
    if (init?.method === "POST") {
      posts++; const body = JSON.parse(String(init.body)); repairId = body.client_task_id;
      assert.equal(body.size, "1024x1024"); assert.equal(body.background, "transparent"); assert.equal(body.images.length, 2);
      throw Error("lost repair acknowledgement");
    }
    return Response.json({ items: [{ id: repairId, status: "error", error_code: "request_rejected", error: "request rejected" }] });
  } });
  try {
    await base(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground");
    const foreground = await base(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground"); input.foreground_sha256 = foreground.image_sha256!;
    await assert.rejects(make()(f.store, f.plugin, f.job, f.claim.leaseToken, "repair", { ...input, foreground_sha256: "b".repeat(64) }), /repair_source_mismatch/);
    await assert.rejects(make()(f.store, f.plugin, f.job, f.claim.leaseToken, "repair", input), /lost repair/);
    const failed = await make()(f.store, f.plugin, f.job, f.claim.leaseToken, "repair", input);
    assert.equal(failed.error_code, "generation_rejected");
    assert.equal((await make()(f.store, f.plugin, f.job, f.claim.leaseToken, "repair", input)).status, "failed");
    assert.equal(posts, 1);
    await assert.rejects(make()(f.store, f.plugin, f.job, f.claim.leaseToken, "repair", { ...input, part: "different part" }), /repair_input_changed/);
  } finally { f.conn.close(); }
});

const refusal = "非常抱歉，生成的图片可能违反了关于裸露、色情或情色内容的防护限制。";
const rewritten = (text: string) => ({ rewrittenPromptText: text, characterKey: null, usedImageUrls: [], llmDurationMs: 20, analysis: null });

function foregroundHarness(f: Awaited<ReturnType<typeof fixture>>, rewrite: typeof rewriteBlockedPrompt, request: typeof fetch, now?: () => number) {
  return () => createV2Layers({ providers: () => [f.entry], provider: () => f.entry, fetch: request, rewrite, now });
}

test("foreground rewrite uses the shared JSON backend without classic safe zones or cross-region reference lookup", async () => {
  const calls: any[] = [];
  const complete: any = async (opts: any, _label: any, _validation: any, policy: any) => {
    calls.push({ opts, policy });
    return { data: { rewritten: "An adult adventurer in a fully covering winter coat, holding a cup, waist-up." }, backend: "test" };
  };
  const input = { originalPromptText: "「ScarletWitch」. Style and theme: 「油画」. Winter holiday", round: 1 as const, previousRewrittens: [], previousAnalysis: null };
  const result = await rewriteBlockedPrompt({ ...input, foregroundConstraints: "Genuine transparent RGBA. Keep the chosen silhouettes complete. Framing follows the creative brief.", llmPolicy: { providerIds: ["llm"] } }, complete);
  assert.equal(result.rewrittenPromptText, "An adult adventurer in a fully covering winter coat, holding a cup, waist-up.");
  assert.deepEqual(result.usedImageUrls, []);
  assert.equal(calls[0].opts.images, undefined);
  assert.deepEqual(calls[0].policy, { providerIds: ["llm"], apiOnly: true, maxCalls: 1 });
  assert.match(calls[0].opts.systemPrompt, /实际调整服装覆盖/);
  assert.match(calls[0].opts.systemPrompt, /transparent RGBA/);
  assert.doesNotMatch(result.rewrittenPromptText, /safe zone|下 1\/4/);
  const normal = await rewriteBlockedPrompt({ ...input, originalPromptText: "An adult adventurer in winter" }, complete);
  assert.match(normal.rewrittenPromptText, /构图安全区/);
  const empty: any = async () => ({ data: { rewritten: " " }, backend: "test" });
  await assert.rejects(rewriteBlockedPrompt({ ...input, foregroundConstraints: "transparent" }, empty), /foreground_rewrite_unusable/);
});

test("a foreground refusal rewrites once, persists before POST, and resumes the rewritten task after acknowledgement loss", async () => {
  const f = await fixture(); const posts: any[] = [], inputs: any[] = []; let lost = true;
  const make = foregroundHarness(f, async input => { inputs.push(input); return rewritten("Adult gardener in a fully covering coat, holding a cup, waist-up watercolor."); }, async (url, init) => {
    if (String(url).startsWith("https://images.example")) return new Response(new Uint8Array(String(url).endsWith("background.png") ? f.backgroundPng : f.png));
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body)); posts.push(body);
      if (posts.length === 1) return Response.json({ id: body.client_task_id, status: "error", error_code: "generation_failed", error: refusal });
      const saved = JSON.parse(f.store.layer("snapub", f.job.id, "foreground")!);
      assert.equal(saved.taskId, body.client_task_id); assert.equal(saved.postAttempts, 1); assert.equal(saved.rewrite.round, 1);
      if (lost) { lost = false; throw Error("rewritten POST admitted; acknowledgement lost"); }
      return Response.json({ id: body.client_task_id, status: "queued" });
    }
    return Response.json({ items: [{ id: new URL(String(url)).searchParams.get("ids"), status: "success", data: [{ url: "https://images.example/done.png" }] }] });
  });
  try {
    assert.equal((await make()(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground")).status, "submitted");
    assert.equal(inputs.length, 0);
    await make()(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground");
    assert.equal(posts.length, 1, "rewriting persists an unsubmitted new round without generating an image");
    assert.equal(inputs.length, 1); assert.equal(inputs[0].originalPromptText, f.input.creation.prompt);
    await assert.rejects(make()(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground"), /acknowledgement lost/);
    assert.equal((await make()(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground")).status, "succeeded");
    await make()(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground");
    assert.equal(inputs.length, 1); assert.equal(posts.length, 2); assert.notEqual(posts[0].client_task_id, posts[1].client_task_id);
    const body = posts[1]; assert.equal(body.background, "transparent"); assert.equal(body.output_format, "png"); assert.equal(body.optimize_output, false);
    assert.match(body.prompt, /真正透明底的RGBA PNG/); assert.match(body.prompt, /头脸、身体、肢体和硬质道具保持不透明/);
    assert.match(body.prompt, /未指定的由角色和主题自由决定/); assert.match(body.prompt, /完整的头部/); assert.match(body.prompt, /需要下缘自然取景时/);
    assert.match(inputs[0].foregroundConstraints, /最外侧实体轮廓的左右/);
    assert.doesNotMatch(body.prompt.replace("Adult gardener in a fully covering coat, holding a cup, waist-up watercolor.", "USER_BRIEF"), /circular|elliptical|waist-up|half-body|portrait scale|细节克制/);
    assert.match(body.prompt, /不在左右边缘或底角形成平切断口/);
    assert.doesNotMatch(body.prompt, /behind the head|raised arm|bent elbow|shoulder-to-elbow-to-hand/);
    assert.doesNotMatch(body.prompt, /safe zone|上 3\/4|下 1\/4/);
    const state = JSON.parse(f.store.layer("snapub", f.job.id, "foreground")!);
    assert.equal(state.rewrite.history.length, 1); assert.equal(state.rewrite.history[0].taskId, posts[0].client_task_id);
    assert.equal(state.rewrite.history[0].detail, refusal);
  } finally { f.conn.close(); }
});

test("only explicit content rejection enters foreground rewriting; network, unknown and preparation failures do not", async () => {
  for (const [error_code, error, expected] of [["generation_failed", "HTTP 502 connection failed", "generation_failed"], ["request_preparation_failed", refusal, "generation_submission_failed"], ["admission_capacity", refusal, "generation_queue_full"], [undefined, "Unknown failure", "generation_failed"]] as const) {
    const f = await fixture(); let rewrites = 0, posts = 0;
    const make = foregroundHarness(f, async () => { rewrites++; return rewritten("safe coat"); }, async (_url, init) => {
      posts++; return Response.json({ id: JSON.parse(String(init!.body)).client_task_id, status: "error", error_code, error });
    });
    try {
      const result = await make()(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground");
      assert.equal(result.error_code, expected); assert.equal(result.status, "failed");
      await make()(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground"); assert.equal(posts, 1); assert.equal(rewrites, 0);
    } finally { f.conn.close(); }
  }
});

test("foreground rewrite stops after three rounds and never reopens exhausted or legacy failed tasks", async () => {
  const f = await fixture(); let rewrites = 0; const ids: string[] = [];
  const make = foregroundHarness(f, async input => { rewrites++; return rewritten(`Safe adult adventurer wearing a coat, revision ${input.round}`); }, async (_url, init) => {
    const body = JSON.parse(String(init!.body)); ids.push(body.client_task_id);
    return Response.json({ id: body.client_task_id, status: "error", error_code: "generation_failed", error: refusal });
  });
  try {
    let result;
    for (let i = 0; i < 10; i++) { result = await make()(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground"); if (result.status === "failed") break; }
    assert.equal(result?.error_code, "generation_rejected"); assert.equal(rewrites, 3); assert.equal(ids.length, 4); assert.equal(new Set(ids).size, 4);
    const state = JSON.parse(f.store.layer("snapub", f.job.id, "foreground")!); assert.equal(state.rewrite.history.length, 4);
    await make()(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground"); assert.equal(ids.length, 4);
    delete state.rewrite; f.store.saveLayer("snapub", f.job.id, f.claim.leaseToken, "foreground", JSON.stringify(state));
    await make()(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground"); assert.equal(rewrites, 3);
  } finally { f.conn.close(); }
});

test("a transient rewrite timeout resumes the same rewrite round without resubmitting the rejected image", async () => {
  const f = await fixture(); let clock = Date.now(), calls = 0, posts = 0;
  const make = foregroundHarness(f, async () => { if (++calls === 1) throw new LlmDriverError("timeout", "LLM connection timeout"); return rewritten("Adult gardener wearing a fully covering coat"); }, async (_url, init) => {
    posts++; return Response.json({ id: JSON.parse(String(init!.body)).client_task_id, status: "error", error_code: "request_rejected" });
  }, () => clock);
  try {
    await make()(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground");
    assert.equal((await make()(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground")).status, "submitted");
    await make()(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground"); assert.equal(calls, 1); assert.equal(posts, 1);
    clock += 60001;
    await make()(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground");
    assert.equal(calls, 2); assert.equal(posts, 1); assert.equal(JSON.parse(f.store.layer("snapub", f.job.id, "foreground")!).rewrite.round, 1);
  } finally { f.conn.close(); }
});

test("concurrent/restarted rewrite polls cannot overwrite a newer saved prompt or double-submit images", async () => {
  const f = await fixture(); let clock = Date.now(), calls = 0, posts = 0;
  let release!: (value: ReturnType<typeof rewritten>) => void, entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const make = foregroundHarness(f, async () => {
    calls++; if (calls === 1) { entered(); return new Promise(resolve => { release = resolve; }); }
    return rewritten("New saved adult gardener in a coat");
  }, async (_url, init) => { posts++; return Response.json({ id: JSON.parse(String(init!.body)).client_task_id, status: "error", error_code: "request_rejected" }); }, () => clock);
  try {
    await make()(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground");
    const old = make()(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground"); const fenced = assert.rejects(old, /generation_busy/);
    await started;
    await make()(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground"); assert.equal(calls, 1);
    clock += 120001;
    await make()(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground"); assert.equal(calls, 2);
    release(rewritten("Stale adult gardener prompt")); await fenced;
    const state = JSON.parse(f.store.layer("snapub", f.job.id, "foreground")!);
    assert.equal(state.rewrite.prompt, "New saved adult gardener in a coat"); assert.equal(state.postAttempts, 0); assert.equal(posts, 1);
  } finally { f.conn.close(); }
});

test("lease expiry during rewriting prevents the stale request from persisting or submitting a new image", async () => {
  const f = await fixture(); let posts = 0;
  const make = foregroundHarness(f, async () => { f.advance(181000); return rewritten("Adult gardener in a coat"); }, async (_url, init) => {
    posts++; return Response.json({ id: JSON.parse(String(init!.body)).client_task_id, status: "error", error_code: "request_rejected" });
  });
  try {
    await make()(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground");
    await assert.rejects(make()(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground"), /lease_lost/);
    assert.equal(posts, 1); assert.equal(JSON.parse(f.store.layer("snapub", f.job.id, "foreground")!).rewrite.round, 0);
  } finally { f.conn.close(); }
});

test("changed source or saved rewrite prompt fails closed before another model or image request", async () => {
  const f = await fixture(); let calls = 0;
  const make = foregroundHarness(f, async () => { calls++; return rewritten("Adult gardener in a coat"); }, async (_url, init) => Response.json({ id: JSON.parse(String(init!.body)).client_task_id, status: "error", error_code: "request_rejected" }));
  try {
    await make()(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground");
    await assert.rejects(make()(f.store, f.plugin, { ...f.job, creation_json: JSON.stringify({ prompt: "changed" }) }, f.claim.leaseToken, "foreground"), /generation_policy_changed/);
    const state = JSON.parse(f.store.layer("snapub", f.job.id, "foreground")!); state.rewrite.prompt = "tampered";
    f.store.saveLayer("snapub", f.job.id, f.claim.leaseToken, "foreground", JSON.stringify(state));
    await assert.rejects(make()(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground"), /generation_policy_changed/);
    assert.equal(calls, 0);
  } finally { f.conn.close(); }
});

test("empty or previously refused rewrite output stops without generating the same content again", async () => {
  for (const output of ["", "Original storm gardener with translucent magical ribbons"]) {
    const f = await fixture(); let posts = 0;
    const make = foregroundHarness(f, async () => rewritten(output), async (_url, init) => {
      posts++; return Response.json({ id: JSON.parse(String(init!.body)).client_task_id, status: "error", error_code: "request_rejected" });
    });
    try {
      await make()(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground");
      assert.equal((await make()(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground")).error_code, "generation_rewrite_failed");
      await make()(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground"); assert.equal(posts, 1);
    } finally { f.conn.close(); }
  }
});

test("repeated rewrite connection failure consumes the saved LLM budget rather than restarting it", async () => {
  const f = await fixture(); let clock = Date.now(), calls = 0, posts = 0;
  const make = foregroundHarness(f, async () => { calls++; throw new LlmDriverError("timeout", "upstream timeout"); }, async (_url, init) => {
    posts++; return Response.json({ id: JSON.parse(String(init!.body)).client_task_id, status: "error", error_code: "request_rejected" });
  }, () => clock);
  try {
    await make()(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground");
    await make()(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground"); clock += 60001;
    assert.equal((await make()(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground")).error_code, "generation_rewrite_failed");
    await make()(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground");
    assert.equal(calls, 2); assert.equal(posts, 1); assert.equal(JSON.parse(f.store.layer("snapub", f.job.id, "foreground")!).rewrite.pending.calls, 2);
  } finally { f.conn.close(); }
});

test("background reuses the completed foreground and retains terminal rejection without calling the foreground rewriter", async () => {
  const f = await fixture(); let calls = 0; const posts: any[] = [];
  const make = foregroundHarness(f, async () => { calls++; return rewritten("unused"); }, async (url, init) => {
    if (String(url).startsWith("https://images.example")) return new Response(new Uint8Array(String(url).endsWith("background.png") ? f.backgroundPng : f.png));
    const body = JSON.parse(String(init!.body)); posts.push(body);
    return Response.json(body.background === "transparent" ? { id: body.client_task_id, status: "success", data: [{ url: "https://images.example/final-foreground.png" }] } : { id: body.client_task_id, status: "error", error_code: "generation_failed", error: refusal });
  });
  try {
    await make()(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground");
    assert.equal((await make()(f.store, f.plugin, f.job, f.claim.leaseToken, "background")).error_code, "generation_rejected");
    await make()(f.store, f.plugin, f.job, f.claim.leaseToken, "background"); assert.equal(calls, 0); assert.equal(posts.length, 2);
    assert.deepEqual(posts[1].images, [`data:image/png;base64,${f.png.toString("base64")}`]);
  } finally { f.conn.close(); }
});


test("foreground and rewrite constraints do not prescribe a pose while preserving an explicitly requested gesture", async () => {
  const prompt = layerPrompt("Woodblock portrait of an adult character in a winter garden", "foreground");
  assert.match(prompt, /动作、镜头、人物取景范围、朝向、表情、服装、色彩、光影及画法遵循创作描述/);
  assert.match(prompt, /透明底的RGBA PNG/); assert.match(prompt, /完整的头部、发顶、头饰、手指和手持物/); assert.match(prompt, /最高实体轮廓上方/);
  assert.doesNotMatch(prompt, /behind the head|raised arm|bent elbow|shoulder-to-elbow-to-hand|pin-up/);
  const requested = layerPrompt("The character is reading a book with both hands", "foreground");
  assert.match(requested, /reading a book with both hands/);
  let system = "";
  const complete: any = async (opts: any) => { system = opts.systemPrompt; return { data: { rewritten: "Adult character reading a book" }, backend: "test" }; };
  await rewriteBlockedPrompt({ originalPromptText: "adult character", round: 1, previousRewrittens: [], previousAnalysis: null, foregroundConstraints: layerPrompt("", "foreground") }, complete);
  assert.match(system, /动作由角色和主题决定/); assert.match(system, /未指定时自由选择合适动作/);
  assert.match(system, /最外侧实体轮廓的左右/);
  assert.match(system, /未指定的维度保持开放/);
  assert.match(system, /需要下缘自然取景时/);
  assert.doesNotMatch(system, /behind the head|raised arm|bent elbow|shoulder-to-elbow-to-hand/);
});

test("neutral layer instructions leave unspecified art direction open and retain explicit user choices", () => {
  for (const brief of ["Adult character", "Full-body action, low-angle camera, back view, angular woodblock print", "Waist-up portrait, seated reading, muted colors and rough brushwork"]) {
    const generated = layerPrompt(brief, "foreground");
    assert.ok(generated.includes(brief), "the creative brief must not be silently neutralized");
    const constraints = generated.replace(brief, "USER_BRIEF");
    assert.doesNotMatch(constraints, /waist-up|half-body|portrait scale|circular|elliptical|centered|Premium collectible|平滑自然|细节克制/);
    assert.match(constraints, /完整的头部、发顶、头饰、手指和手持物/);
    assert.match(constraints, /下方两角保持透明/);
    assert.match(constraints, /不在左右边缘或底角形成平切断口/);
    assert.match(constraints, /衣物柔软末端可局部渐隐，不能让主体整体或实体肢体半透明/);
  }
  assert.doesNotMatch(layerPrompt("Moonlit observatory", "background"), /natural central staging|平滑自然|细节克制|Premium collectible/);
});


test("portrait foreground geometry is frozen across lost acknowledgements and all rewrite rounds", async () => {
  const f = await fixture(); const posts: Array<Record<string, any>> = []; let lose = true;
  const make = () => createV2Layers({ providers: () => [f.entry], provider: () => f.entry, rewrite: async () => ({ rewrittenPromptText: "A fully clothed adult storm gardener", llmDurationMs: 1 }) as any, fetch: async (url, init) => {
    if (String(url).startsWith("https://images.example")) return new Response(new Uint8Array(f.png));
    if (init?.method === "POST") { const body = JSON.parse(String(init.body)); posts.push(body); if (lose) { lose = false; throw Error("ack lost"); } return Response.json({ id: body.client_task_id, status: "success", data: [{ url: "https://images.example/foreground.png" }] }); }
    return Response.json({ items: [{ id: new URL(String(url)).searchParams.get("ids"), status: "error", error_code: "request_rejected" }] });
  } });
  try {
    await assert.rejects(make()(f.store,f.plugin,f.job,f.claim.leaseToken,"foreground"), /ack lost/);
    await make()(f.store,f.plugin,f.job,f.claim.leaseToken,"foreground");
    await make()(f.store,f.plugin,f.job,f.claim.leaseToken,"foreground");
    assert.equal((await make()(f.store,f.plugin,f.job,f.claim.leaseToken,"foreground")).status,"succeeded");
    assert.equal(posts.length,2); assert.ok(posts.every(p=>p.size==="1024x1280" && p.prompt.includes("4:5竖图")));
    assert.equal(JSON.parse(f.store.layer("snapub",f.job.id,"foreground")!).outputSize,"1024x1280");
  } finally { f.conn.close(); }
});

test("legacy in-flight 2:3 foreground resumes its original geometry and task ID without a second image submission", async () => {
  const f=await fixture();let posts=0,gets=0;
  const legacyPng=await sharp(f.png).extend({top:128,bottom:128,left:0,right:0,background:'transparent'}).png().toBuffer();
  const run=createV2Layers({providers:()=>[f.entry],provider:()=>f.entry,fetch:async(url,init)=>{
    if(String(url).startsWith('https://images.example'))return new Response(new Uint8Array(legacyPng));
    if(init?.method==='POST'){posts++;throw Error('lost acknowledgement')}
    gets++;return Response.json({items:[{id:new URL(String(url)).searchParams.get('ids'),status:'success',data:[{url:'https://images.example/legacy.png'}]}]});
  }});
  try{
    await assert.rejects(run(f.store,f.plugin,f.job,f.claim.leaseToken,'foreground'));
    const state=JSON.parse(f.store.layer('snapub',f.job.id,'foreground')!),id=state.taskId;
    const {createHash}=await import('node:crypto'),legacyHash=createHash('sha256').update(layerPrompt(f.input.creation.prompt,'foreground','1024x1536',false,'legacy')).digest('hex');
    delete state.outputSize;delete state.foregroundFraming;state.promptHash=legacyHash;state.rewrite.originalPromptHash=legacyHash;
    f.store.saveLayer('snapub',f.job.id,f.claim.leaseToken,'foreground',JSON.stringify(state));
    assert.equal((await run(f.store,f.plugin,f.job,f.claim.leaseToken,'foreground')).status,'succeeded');
    assert.equal(posts,1);assert.equal(gets,1);assert.equal(JSON.parse(f.store.layer('snapub',f.job.id,'foreground')!).taskId,id);
  }finally{f.conn.close()}
});

test("an already rewritten 4:5 layer keeps its legacy prompt and upstream ID across a framing-policy upgrade", async () => {
  const f = await fixture(); let posts = 0, gets = 0;
  const run = createV2Layers({ providers: () => [f.entry], provider: () => f.entry, fetch: async (url, init) => {
    if (String(url).startsWith("https://images.example")) return new Response(new Uint8Array(f.png));
    if (init?.method === "POST") { posts++; throw Error("lost acknowledgement"); }
    gets++; return Response.json({ items: [{ id: new URL(String(url)).searchParams.get("ids"), status: "success", data: [{ url: "https://images.example/legacy.png" }] }] });
  } });
  try {
    await assert.rejects(run(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground"), /lost acknowledgement/);
    const state = JSON.parse(f.store.layer("snapub", f.job.id, "foreground")!);
    assert.equal(state.foregroundFraming, "neutral-framing-v3");
    const { createHash } = await import("node:crypto");
    const hash = (prompt: string) => createHash("sha256").update(layerPrompt(prompt, "foreground", "1024x1280", true, "legacy")).digest("hex");
    delete state.foregroundFraming;
    state.rewrite.round = 1; state.rewrite.prompt = "An adult gardener with a cup in winter";
    state.rewrite.originalPromptHash = hash(f.input.creation.prompt); state.promptHash = hash(state.rewrite.prompt);
    const id = state.taskId;
    f.store.saveLayer("snapub", f.job.id, f.claim.leaseToken, "foreground", JSON.stringify(state));
    assert.equal((await run(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground")).status, "succeeded");
    assert.equal(posts, 1); assert.equal(gets, 1);
    assert.equal(JSON.parse(f.store.layer("snapub", f.job.id, "foreground")!).taskId, id);
  } finally { f.conn.close(); }
});

for (const policy of ["rounded-envelope-v1", "neutral-framing-v2"] as const) test(`${policy} in-flight layers retain their frozen prompt instead of resubmitting the new neutral policy`, async () => {
  const f = await fixture(); let posts = 0;
  const run = createV2Layers({ providers: () => [f.entry], provider: () => f.entry, fetch: async (url, init) => {
    if (String(url).startsWith("https://images.example")) return new Response(new Uint8Array(f.png));
    if (init?.method === "POST") { posts++; throw Error("lost acknowledgement"); }
    return Response.json({ items: [{ id: new URL(String(url)).searchParams.get("ids"), status: "success", data: [{ url: "https://images.example/frozen.png" }] }] });
  } });
  try {
    await assert.rejects(run(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground"), /lost acknowledgement/);
    const state = JSON.parse(f.store.layer("snapub", f.job.id, "foreground")!);
    const { createHash } = await import("node:crypto");
    const frozen = layerPrompt(f.input.creation.prompt, "foreground", "1024x1280", true, policy);
    const hash = createHash("sha256").update(frozen).digest("hex");
    state.foregroundFraming = policy; state.rewrite.originalPromptHash = hash;
    state.rewrite.round = 1; state.rewrite.prompt = "An adult gardener holding a cup";
    const rewrittenHash = createHash("sha256").update(layerPrompt(state.rewrite.prompt, "foreground", "1024x1280", true, policy)).digest("hex");
    state.promptHash = rewrittenHash;
    f.store.saveLayer("snapub", f.job.id, f.claim.leaseToken, "foreground", JSON.stringify(state));
    assert.equal((await run(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground")).status, "succeeded");
    assert.equal(posts, 1);
    const saved = JSON.parse(f.store.layer("snapub", f.job.id, "foreground")!);
    assert.equal(saved.taskId, state.taskId); assert.equal(saved.promptHash, rewrittenHash);
  } finally { f.conn.close(); }
});


test("native foreground accepts generated 4:5 pixel rounding but refuses a materially different aspect ratio", async () => {
  for(const [width,height,expected] of [[1122,1402,"succeeded"],[1024,1536,"failed"],[1280,1024,"failed"]] as const){
    const f=await fixture(),png=await sharp(f.png).resize(width,height,{fit:'contain',background:'transparent'}).png().toBuffer();
    const run=createV2Layers({providers:()=>[f.entry],provider:()=>f.entry,fetch:async(url,init)=>String(url).startsWith('https://images.example')?new Response(new Uint8Array(png)):Response.json({id:JSON.parse(String(init!.body)).client_task_id,status:'success',data:[{url:'https://images.example/new.png'}]})});
    try{assert.equal((await run(f.store,f.plugin,f.job,f.claim.leaseToken,'foreground')).status,expected)}finally{f.conn.close()}
  }
});

test("frozen recomposition reads bypass provider lookup and never regenerate originals", async () => {
  const f = await fixture(); let calls = 0;
  try {
    for (const name of ["foreground", "background"]) f.store.saveLayer("snapub", f.job.id, f.claim.leaseToken, name, JSON.stringify({ status: "succeeded", taskId: name, imageUrl: `https://images.example/${name}.png`, imageSha256: "a".repeat(64), outputSize: "1024x1536" }));
    f.store.finish("snapub", f.job.id, f.claim.leaseToken, { status: "succeeded", imageUrl: "https://images.example/final.webp" });
    const job = f.store.recompose({ id: "recomposed", plugin: "snapub", owner: f.job.owner_key, sourceId: f.job.id, instruction: "" });
    const lease = f.store.claim("snapub", "worker", "revision", true)!;
    const run = createV2Layers({ providers: () => { calls++; throw Error("no provider access"); }, provider: () => { calls++; throw Error("no provider access"); }, fetch: async () => { calls++; throw Error("no image request"); } });
    assert.equal((await run(f.store, f.plugin, job, lease.leaseToken, "foreground")).status, "succeeded");
    assert.equal((await run(f.store, f.plugin, job, lease.leaseToken, "background")).image_sha256, "a".repeat(64));
    await assert.rejects(run(f.store, f.plugin, job, lease.leaseToken, "repair"), /invalid_repair/);
    f.conn.prepare("DELETE FROM static_v2_layers WHERE job_id=? AND layer='foreground'").run(job.id);
    await assert.rejects(run(f.store, f.plugin, job, lease.leaseToken, "foreground"), /layers_missing/);
    assert.equal(calls, 0);
  } finally { f.conn.close(); }
});

test("recomposition repairs use the original pinned provider across reused ancestors, with one durable edit and no regeneration", async () => {
  const f = await fixture(); let phase = "original", edits = 0, id = "";
  const patchPng = await sharp({ create: { width: 1024, height: 1024, channels: 4, background: "transparent" } }).png().toBuffer();
  const request: typeof fetch = async (url, init) => {
    if (String(url).startsWith("https://images.example")) return new Response(new Uint8Array(phase === "original" ? f.png : patchPng));
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body)); id = body.client_task_id;
      if (phase === "repair") { assert.match(String(url), /\/edits$/); edits++; }
      return Response.json({ id, status: "queued" });
    }
    return Response.json({ items: [{ id, status: "success", data: [{ url: "https://images.example/output.png" }] }] });
  };
  const run = createV2Layers({ providers: () => [f.entry], provider: () => f.entry, fetch: request });
  try {
    await run(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground");
    await run(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground");
    f.store.saveLayer("snapub", f.job.id, f.claim.leaseToken, "background", f.store.layer("snapub", f.job.id, "foreground")!);
    f.store.finish("snapub", f.job.id, f.claim.leaseToken, { status: "succeeded", imageUrl: "https://images.example/final.webp" });
    const child = f.store.recompose({ id: "reuse", plugin: "snapub", owner: f.job.owner_key, sourceId: f.job.id, instruction: "" });
    const childLease = f.store.claim("snapub", "worker", "revision", true)!;
    f.store.finish("snapub", child.id, childLease.leaseToken, { status: "succeeded", imageUrl: "https://images.example/final.webp" });
    const next = f.store.recompose({ id: "reuse-again", plugin: "snapub", owner: f.job.owner_key, sourceId: child.id, instruction: "左侧衣角出框" });
    const lease = f.store.claim("snapub", "worker", "revision", true)!;
    const frozen = f.store.layer("snapub", next.id, "foreground")!;
    const input = { foreground_sha256: JSON.parse(frozen).imageSha256, crop_png: `data:image/png;base64,${patchPng.toString("base64")}`, mask_png: `data:image/png;base64,${patchPng.toString("base64")}`, part: "side terminal", material: "solid" as const };
    phase = "repair";
    await assert.rejects(run(f.store, f.plugin, next, lease.leaseToken, "repair", { ...input, foreground_sha256: "f".repeat(64) }), /source_mismatch/);
    await run(f.store, f.plugin, next, lease.leaseToken, "repair", input);
    assert.equal((await run(f.store, f.plugin, next, lease.leaseToken, "repair", input)).status, "succeeded");
    await run(f.store, f.plugin, next, lease.leaseToken, "repair", input);
    assert.equal(edits, 1);
    assert.equal(f.store.layer("snapub", next.id, "foreground"), frozen);
    await assert.rejects(run(f.store, f.plugin, next, lease.leaseToken, "repair", { ...input, part: "different" }), /input_changed/);
  } finally { f.conn.close(); }
});

test("repair retries only a confirmed terminal transport failure once; lost second acknowledgement resumes the same ID", async () => {
  for (const scenario of ["success", "second-network-error", "refusal", "has-result", "unknown-error"] as const) {
    const f = await fixture(); let phase: "foreground" | "repair" = "foreground";
    const repairPosts: string[] = []; let loseSecondAck = true;
    const square = await sharp({ create: { width: 1024, height: 1024, channels: 4, background: "transparent" } }).png().toBuffer();
    const png = `data:image/png;base64,${square.toString("base64")}`;
    const make = () => createV2Layers({ providers: () => [f.entry], provider: () => f.entry, fetch: async (url, init) => {
      if (String(url).startsWith("https://images.example")) return new Response(new Uint8Array(phase === "repair" ? square : f.png));
      if (init?.method === "POST") {
        const id = JSON.parse(String(init.body)).client_task_id as string;
        if (phase === "repair") {
          repairPosts.push(id);
          if (repairPosts.length === 2 && loseSecondAck) { loseSecondAck = false; throw Error("lost second acknowledgement"); }
        }
        return Response.json({ id, status: "queued" });
      }
      const id = new URL(String(url)).searchParams.get("ids");
      if (phase === "foreground" || repairPosts.length === 2 && scenario === "success") return Response.json({ items: [{ id, status: "success", data: [{ url: "https://images.example/layer.png" }] }] });
      return Response.json({ items: [{ id, status: "error", error_code: scenario === "refusal" ? "request_rejected" : "generation_failed",
        error: scenario === "unknown-error" ? "image execution failed" : "Failed to perform, curl: (56) Connection closed abruptly.",
        ...(scenario === "has-result" ? { data: [{ url: "https://images.example/reusable.png" }] } : {}),
      }] });
    } });
    try {
      await make()(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground");
      const fg = await make()(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground"); phase = "repair";
      const input = { foreground_sha256: fg.image_sha256!, crop_png: png, mask_png: png, part: "fan terminal", material: "solid" as const };
      await make()(f.store, f.plugin, f.job, f.claim.leaseToken, "repair", input);
      const firstState = JSON.parse(f.store.layer("snapub", f.job.id, "repair")!);
      const result = await make()(f.store, f.plugin, f.job, f.claim.leaseToken, "repair", input);
      if (["refusal", "has-result", "unknown-error"].includes(scenario)) {
        assert.equal(result.status, "failed");
        assert.equal((await make()(f.store, f.plugin, f.job, f.claim.leaseToken, "repair", input)).status, "failed");
        assert.equal(repairPosts.length, 1); continue;
      }
      assert.equal(result.status, "submitted");
      const retryState = JSON.parse(f.store.layer("snapub", f.job.id, "repair")!);
      assert.equal(retryState.createdAt, firstState.createdAt, "retry cannot reset the deadline");
      assert.equal(retryState.repairRetry.previousTaskId, repairPosts[0]);
      assert.equal(retryState.inputHash, firstState.inputHash); assert.equal(retryState.promptHash, firstState.promptHash);
      assert.equal(retryState.providerHash, firstState.providerHash); assert.notEqual(retryState.taskId, firstState.taskId);
      await assert.rejects(make()(f.store, f.plugin, f.job, f.claim.leaseToken, "repair", { ...input, part: "changed" }), /input_changed/);
      await assert.rejects(make()(f.store, f.plugin, f.job, f.claim.leaseToken, "repair", input), /lost second acknowledgement/);
      const resumed = await make()(f.store, f.plugin, f.job, f.claim.leaseToken, "repair", input);
      assert.equal(resumed.status, scenario === "success" ? "succeeded" : "failed");
      assert.equal((await make()(f.store, f.plugin, f.job, f.claim.leaseToken, "repair", input)).status, resumed.status);
      assert.equal(repairPosts.length, 2, "no third image task after recovery or another terminal network failure");
      assert.equal(repairPosts[1], retryState.taskId);
    } finally { f.conn.close(); }
  }
});

test("administrator recovery reads only frozen successful layers and forbids repairs even when providers are gone", async () => {
  const f = await fixture(); let calls = 0;
  try {
    for (const [name, char] of [["foreground", "f"], ["background", "e"]]) f.store.saveLayer("snapub", f.job.id, f.claim.leaseToken, name!, JSON.stringify({ status: "succeeded", imageUrl: `https://images.example/${name}.png`, imageSha256: char!.repeat(64) }));
    f.store.finish("snapub", f.job.id, f.claim.leaseToken, { status: "failed" });
    const restored = f.store.recover({ id: f.job.id, plugin: "snapub", owner: f.job.owner_key, operator: "admin", requestId: "recovery-one", mode: "recompose" });
    const lease = f.store.claim("snapub", "worker", "new", true)!;
    const run = createV2Layers({ providers: () => [], provider: () => null, fetch: async () => { calls++; throw Error("must not generate"); } });
    for (const name of ["foreground", "background"] as const) assert.equal((await run(f.store, f.plugin, { ...restored, status: "running" }, lease.leaseToken, name)).status, "succeeded");
    await assert.rejects(run(f.store, f.plugin, lease, lease.leaseToken, "repair"), /recovery_no_generation/);
    assert.equal(calls, 0);
  } finally { f.conn.close(); }
});

const drawingHeaders = { "x-image-task-admission": "durable-v1", "x-codex-drawing-session": "explicit-images-v1" };
const pngDigest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

test("Codex 3D shares a durable project and original foreground hash without re-uploading PNG/history", async () => {
  const f = await fixture(); f.entry.capability.model = "pro-codex-gpt-image-2.5";
  const posts: Record<string, any>[] = []; let reads = 0;
  const run = () => createV2Layers({ providers: () => [f.entry], provider: () => f.entry, fetch: async (url, init) => {
    if (String(url).startsWith("https://images.example")) { reads++; return new Response(new Uint8Array(String(url).endsWith("background.png") ? f.backgroundPng : f.png)); }
    if (init?.method !== "POST") return Response.json({ missing_ids: [new URL(String(url)).searchParams.get("ids")] }, { headers: drawingHeaders });
    const body = JSON.parse(String(init.body)); posts.push(body);
    assert.equal(new URL(String(url)).pathname, "/api/image-tasks/generations");
    const foreground = body.background === "transparent";
    return Response.json({ id: body.client_task_id, status: "success", drawing_session_id: body.drawing_session_id, drawing_context_status: "ready", drawing_image_sha256: pngDigest(foreground ? f.png : f.backgroundPng), data: [{ url: `https://images.example/${foreground ? "foreground" : "background"}.png` }] }, { headers: drawingHeaders });
  } });
  try {
    assert.equal((await run()(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground")).status, "succeeded");
    assert.equal((await run()(f.store, f.plugin, f.job, f.claim.leaseToken, "background")).status, "succeeded");
    assert.equal(posts.length, 2); assert.equal(reads, 2, "download each result only; no foreground re-download for the next request");
    assert.equal(posts[0]!.drawing_session_id, posts[1]!.drawing_session_id);
    assert.equal(posts[1]!.drawing_previous_step_id, posts[0]!.client_task_id);
    assert.equal(posts[1]!.drawing_previous_image_sha256, pngDigest(f.png));
    assert.ok(posts.every(p => !p.images && !p.context_items && !p.provider_account_identity));
    assert.equal(posts[0]!.size, "1024x1280"); assert.equal(posts[1]!.size, "1024x1536");
    assert.ok(posts.every(p => p.optimize_output === false && p.output_format === "png"));
    await run()(f.store, f.plugin, f.job, f.claim.leaseToken, "background"); assert.equal(posts.length, 2);
  } finally { f.conn.close(); }
});

test("Codex lost acknowledgement resumes the original session step and never submits a new generation", async () => {
  const f = await fixture(); f.entry.capability.model = "pro-codex-gpt-image-2.5";
  let body: any; let posts = 0;
  const run = () => createV2Layers({providers:()=>[f.entry],provider:()=>f.entry,fetch:async(url,init)=>{
    if (String(url).startsWith("https://images.example")) return new Response(new Uint8Array(f.png));
    if (init?.method==="POST") { posts++;body=JSON.parse(String(init.body));throw Error("ack lost after accepted session step"); }
    if (!body) return Response.json({items:[]},{headers:drawingHeaders});
    return Response.json({items:[{id:body.client_task_id,status:"success",drawing_session_id:body.drawing_session_id,drawing_context_status:"ready",drawing_image_sha256:pngDigest(f.png),data:[{url:"https://images.example/fg.png"}]}]},{headers:drawingHeaders});
  }});
  try {
    await assert.rejects(run()(f.store,f.plugin,f.job,f.claim.leaseToken,"foreground"),/ack lost/);
    const frozen=JSON.parse(f.store.layer(f.plugin.id,f.job.id,"foreground")!);
    assert.equal(frozen.codexDrawing.sessionId,body.drawing_session_id);
    assert.equal((await run()(f.store,f.plugin,f.job,f.claim.leaseToken,"foreground")).status,"succeeded");assert.equal(posts,1);
  }finally{f.conn.close();}
});

test("Codex session negotiation fails before generation on an old upstream",async()=>{
  const f=await fixture();f.entry.capability.model="pro-codex-gpt-image-2.5";let posts=0;
  const run=createV2Layers({providers:()=>[f.entry],fetch:async(_,init)=>{if(init?.method==="POST")posts++;return Response.json({items:[]});}});
  try{await assert.rejects(run(f.store,f.plugin,f.job,f.claim.leaseToken,"foreground"),/generation_session_unavailable/);assert.equal(posts,0);assert.equal(f.store.layer(f.plugin.id,f.job.id,"foreground"),undefined);}finally{f.conn.close();}
});

for(const defect of ["context","hash","session"] as const)test(`Codex ${defect} mismatch cannot publish a layer or start background`,async()=>{
  const f=await fixture();f.entry.capability.model="pro-codex-gpt-image-2.5";let posts=0;
  const run=createV2Layers({providers:()=>[f.entry],provider:()=>f.entry,fetch:async(url,init)=>{
    if(String(url).startsWith("https://images.example"))return new Response(new Uint8Array(f.png));
    if(init?.method!=="POST")return Response.json({items:[]},{headers:drawingHeaders});
    posts++;const b=JSON.parse(String(init.body));return Response.json({id:b.client_task_id,status:"success",drawing_session_id:defect==="session"?"different":b.drawing_session_id,drawing_context_status:defect==="context"?"unknown":"ready",drawing_image_sha256:defect==="hash"?"a".repeat(64):pngDigest(f.png),data:[{url:"https://images.example/fg.png"}]},{headers:drawingHeaders});
  }});
  try{const result=await run(f.store,f.plugin,f.job,f.claim.leaseToken,"foreground");assert.equal(result.status,"failed");await assert.rejects(run(f.store,f.plugin,f.job,f.claim.leaseToken,"background"),/foreground_required/);assert.equal(posts,1);}finally{f.conn.close();}
});

test("old Codex foreground retains original reference-edit path instead of inventing a new session",async()=>{
  const f=await fixture();f.entry.capability.model="pro-codex-gpt-image-2.5";let post:any;
  const hash=pngDigest(f.png);
  // Frozen pre-session state from an earlier accepted foreground.
  const run=createV2Layers({providers:()=>[f.entry],provider:()=>f.entry,fetch:async(url,init)=>{
    if(String(url).startsWith("https://images.example"))return new Response(new Uint8Array(f.png));
    if(init?.method==="POST"){post=JSON.parse(String(init.body));return Response.json({id:post.client_task_id,status:"queued"});}
    return Response.json({items:[]});
  }});
  try{
    // Produce a legitimate state with the legacy model, then freeze its pinned
    // Codex provider fingerprint as if it predated session support.
    f.entry.capability.model="gpt-image-2";
    await run(f.store,f.plugin,f.job,f.claim.leaseToken,"foreground");
    const raw=JSON.parse(f.store.layer(f.plugin.id,f.job.id,"foreground")!);
    raw.status="succeeded";raw.imageUrl="https://images.example/fg.png";raw.imageSha256=hash;
    f.entry.capability.model="pro-codex-gpt-image-2.5";
    raw.providerHash=pngDigest(Buffer.from(JSON.stringify({id:f.entry.provider.id,base:f.entry.provider.baseUrl,model:f.entry.capability.model,extras:f.entry.capability.extras})));
    f.store.saveLayer(f.plugin.id,f.job.id,f.claim.leaseToken,"foreground",JSON.stringify(raw));
    await run(f.store,f.plugin,f.job,f.claim.leaseToken,"background");
    assert.equal(post.drawing_session_id,undefined);assert.equal(post.images.length,1);
  }finally{f.conn.close();}
});

test("Codex explicit foreground rejection rewrites into a fresh isolated session; unknown outcomes never rewrite",async()=>{
  for(const unknown of [false,true]){
    const f=await fixture();f.entry.capability.model="pro-codex-gpt-image-2.5";const posts:any[]=[];let rewrites=0;
    const make=()=>createV2Layers({providers:()=>[f.entry],provider:()=>f.entry,rewrite:async()=>{rewrites++;return rewritten("An original adult gardener in a practical fully covering coat");},fetch:async(url,init)=>{
      if(init?.method!=="POST")return Response.json({items:[]},{headers:drawingHeaders});
      const body=JSON.parse(String(init.body));posts.push(body);
      return Response.json(posts.length===1?{id:body.client_task_id,status:"error",error_code:unknown?"CODEX_OUTCOME_UNKNOWN":"content_policy_violation"}:{id:body.client_task_id,status:"queued"},{headers:drawingHeaders});
    }});
    try{
      const first=await make()(f.store,f.plugin,f.job,f.claim.leaseToken,"foreground");
      if(unknown){assert.equal(first.status,"failed");await make()(f.store,f.plugin,f.job,f.claim.leaseToken,"foreground");assert.equal(rewrites,0);assert.equal(posts.length,1);}
      else{await make()(f.store,f.plugin,f.job,f.claim.leaseToken,"foreground");await make()(f.store,f.plugin,f.job,f.claim.leaseToken,"foreground");assert.equal(rewrites,1);assert.equal(posts.length,2);assert.notEqual(posts[0].client_task_id,posts[1].client_task_id);assert.notEqual(posts[0].drawing_session_id,posts[1].drawing_session_id);assert.equal(posts[1].background,"transparent");assert.equal(posts[1].drawing_previous_step_id,undefined);}
    }finally{f.conn.close();}
  }
});

test("3D has a separate configured provider route without changing the ordinary plugin pool",async()=>{
  const f=await fixture();const codex={...f.entry,provider:{...f.entry.provider,id:"codex"},capability:{...f.entry.capability,model:"pro-codex-gpt-image-2.5"}};
  const plugin={...f.plugin,v2ImageProviderIds:["codex"]};let model="";
  const selected:string[][]=[];
  const run=createV2Layers({providers:ids=>{selected.push([...ids]);return [f.entry,codex];},provider:id=>id==="codex"?codex:f.entry,fetch:async(_url,init)=>{
    if(init?.method!=="POST")return Response.json({items:[]},{headers:drawingHeaders});model=JSON.parse(String(init.body)).model;return Response.json({status:"queued"},{headers:drawingHeaders});
  }});
  try{
    await run(f.store,plugin,f.job,f.claim.leaseToken,"foreground");
    assert.deepEqual(selected,[["codex"]]);assert.equal(model,"pro-codex-gpt-image-2.5");assert.deepEqual(plugin.imageProviderIds,["gpt"]);
  }finally{f.conn.close();}
});

test("overlay retains the separate 3D route and rejects duplicate provider IDs",()=>{
  const dir=mkdtempSync(join(tmpdir(),"inkast-drawing-overlay-"));
  try{
    for(const ids of [["codex"],[],["codex","codex"]]){
      writeFileSync(join(dir,"test.json"),JSON.stringify({id:"snapub",name:"test",imageDefaults:{},imageProviderIds:["web"],v2ImageProviderIds:ids}));
      const plugins=loadPluginConfigsFromDir(dir);
      if(ids.length===2)assert.equal(plugins.length,0);
      else{assert.deepEqual(plugins[0]!.v2ImageProviderIds,ids);assert.deepEqual(plugins[0]!.imageProviderIds,["web"]);}
    }
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test("a complete PNG with interrupted drawing context stays recoverable but cannot start background",async()=>{
  const f=await fixture();f.entry.capability.model="pro-codex-gpt-image-2.5";let posts=0;
  const run=createV2Layers({providers:()=>[f.entry],provider:()=>f.entry,fetch:async(url,init)=>{
    if(String(url).startsWith("https://images.example"))return new Response(new Uint8Array(f.png));
    if(init?.method!=="POST")return Response.json({items:[]},{headers:drawingHeaders});
    posts++;const body=JSON.parse(String(init.body));return Response.json({id:body.client_task_id,status:"error",error_code:"CODEX_CONTEXT_INCOMPLETE",drawing_context_status:"incomplete",drawing_session_id:body.drawing_session_id,drawing_image_sha256:pngDigest(f.png),data:[{url:"https://images.example/saved.png"}]},{headers:drawingHeaders});
  }});
  try{
    const result=await run(f.store,f.plugin,f.job,f.claim.leaseToken,"foreground");
    assert.equal(result.status,"failed");assert.equal(result.error_code,"generation_context_incomplete");assert.equal(result.image_url,"https://images.example/saved.png");assert.equal(result.image_sha256,pngDigest(f.png));
    await assert.rejects(run(f.store,f.plugin,f.job,f.claim.leaseToken,"background"),/foreground_required/);
    assert.deepEqual(await run(f.store,f.plugin,f.job,f.claim.leaseToken,"foreground"),result);assert.equal(posts,1);
  }finally{f.conn.close();}
});

test("incomplete-context preview must match the project and original PNG hash",async()=>{
  for(const mismatch of ["session","hash","status"] as const){
    const f=await fixture();f.entry.capability.model="pro-codex-gpt-image-2.5";let posts=0;
    const run=createV2Layers({providers:()=>[f.entry],provider:()=>f.entry,fetch:async(url,init)=>{
      if(String(url).startsWith("https://images.example"))return new Response(new Uint8Array(f.png));
      if(init?.method!=="POST")return Response.json({items:[]},{headers:drawingHeaders});
      posts++;const b=JSON.parse(String(init.body));return Response.json({id:b.client_task_id,status:"error",error_code:"CODEX_CONTEXT_INCOMPLETE",drawing_context_status:mismatch==="status"?"ready":"incomplete",drawing_session_id:mismatch==="session"?"other":b.drawing_session_id,drawing_image_sha256:mismatch==="hash"?"a".repeat(64):pngDigest(f.png),data:[{url:"https://images.example/saved.png"}]},{headers:drawingHeaders});
    }});
    try{
      const result=await run(f.store,f.plugin,f.job,f.claim.leaseToken,"foreground");assert.equal(result.status,"failed");assert.equal(result.image_url,undefined);assert.equal(result.image_sha256,undefined);
      await assert.rejects(run(f.store,f.plugin,f.job,f.claim.leaseToken,"background"),/foreground_required/);assert.equal(posts,1);
    }finally{f.conn.close();}
  }
});

test("new native jobs plan the background around a frozen subject placement; pending/recovery never repost either image", async () => {
  const f = await fixture();
  const plugin: InkastPlugin = { ...f.plugin, visionTasks: { v2_plan: { providerIds: ["llm"], maxImages: 4, systemPrompt: "", outputSchema: {} } } };
  const layout = { version: 1 as const, foregroundSha256: createHash("sha256").update(f.png).digest("hex"), sourceWidth: 1024, sourceHeight: 1280,
    placement: { centerX: .48, centerY: .5, zoom: 1, rotationDeg: 0 }, subjectAnchor: [.5,.4] as [number,number], backgroundFocus: [.2,.3] as [number,number], backgroundIntent: "场景左侧环境结构承接人物的偏置", reason: "保留动作同时照顾整体画面" };
  let scenes = 0; const posts: any[] = [];
  const request: typeof fetch = async (url, init) => {
    if (String(url).startsWith("https://images.example")) return new Response(new Uint8Array(String(url).endsWith("bg.png") ? f.backgroundPng : f.png));
    const body = JSON.parse(String(init!.body)); posts.push(body);
    return Response.json({id:body.client_task_id,status:"success",data:[{url:body.background === "opaque" ? "https://images.example/bg.png" : "https://images.example/fg.png"}]});
  };
  const run = createV2Layers({ providers:()=>[f.entry],provider:()=>f.entry,fetch:request, scene:async()=>{
    scenes++;return scenes === 1 ? {status:"pending"} : {status:"succeeded",layout};
  }});
  try {
    assert.equal((await run(f.store,plugin,f.job,f.claim.leaseToken,"foreground")).status,"succeeded");
    assert.equal((await run(f.store,plugin,f.job,f.claim.leaseToken,"background")).status,"submitted");assert.equal(posts.length,1);
    const bg=await run(f.store,plugin,f.job,f.claim.leaseToken,"background");assert.equal(bg.status,"succeeded");assert.deepEqual(bg.scene_layout,layout);assert.equal(posts.length,2);
    assert.match(posts[1].prompt,/subjectCoreInSquareCard/);assert.match(posts[1].prompt,/环境结构承接/);
    await run(f.store,plugin,f.job,f.claim.leaseToken,"background");assert.equal(scenes,2);assert.equal(posts.length,2);
  } finally { f.conn.close(); }
});
