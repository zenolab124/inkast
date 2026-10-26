import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { createV2Layers } from "../src/domain/v2-layers.js";
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
  const png = await sharp({ create: { width: 1024, height: 1536, channels: 4, background: "transparent" } }).composite([{ input: subject, left: 360, top: 400 }]).png().toBuffer();
  return { conn, store, input, job, claim, plugin, entry, png, advance: (ms: number) => { now += ms; } };
}

test("native-layer submit survives a lost acknowledgement/restart and background reuses foreground/channel", async () => {
  const f = await fixture(); const requests: Array<{ url: string; body: Record<string, unknown> | null }> = [];
  let loseAck = true, upstreamId = "";
  const request: typeof fetch = async (url, init) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    requests.push({ url: String(url), body });
    if (String(url).startsWith("https://images.example")) return new Response(new Uint8Array(f.png));
    if (init?.method === "POST") {
      upstreamId = body.client_task_id;
      if (loseAck) { loseAck = false; throw Error("ack lost after admission"); }
      return Response.json({ id: upstreamId, status: "queued" });
    }
    const taskId = new URL(String(url)).searchParams.get("ids");
    return Response.json({ items: [{ id: taskId, status: "success", data: [{ url: "https://images.example/layer.png" }] }] });
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

test("upstream content failure, corrupt PNG and timeout are durable terminal stages without regeneration", async () => {
  for (const failure of ["error", "invalid", "timeout"] as const) {
    const f = await fixture(); let posts = 0;
    const run = createV2Layers({ providers: () => [f.entry], provider: () => f.entry, now: () => failure === "timeout" && posts ? Date.now() + 46 * 60_000 : Date.now(), fetch: async (url, init) => {
      if (String(url).startsWith("https://images.example")) return new Response("not a png");
      if (init?.method === "POST") { posts++; const body = JSON.parse(String(init.body)); return Response.json({ id: body.client_task_id, status: "queued" }); }
      return Response.json({ items: [{ id: new URL(String(url)).searchParams.get("ids"), status: failure === "error" ? "error" : "success", error: "content rejection", data: [{ url: "https://images.example/bad.png" }] }] });
    } });
    try {
      await run(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground");
      const failed = await run(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground");
      assert.equal(failed.status, "failed");
      assert.equal(failed.error_code, failure === "error" ? "generation_rejected" : failure === "invalid" ? "invalid_generated_layer" : "generation_timeout");
      assert.equal((await run(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground")).status, "failed");
      assert.equal(posts, 1);
    } finally { f.conn.close(); }
  }
});


test("delayed background admission after a lost POST acknowledgement reuses both successful layers without regeneration", async () => {
  const f = await fixture(); let foregroundId = "", backgroundId = "", misses = 0;
  const posts: string[] = [];
  const request: typeof fetch = async (url, init) => {
    if (String(url).startsWith("https://images.example")) return new Response(new Uint8Array(f.png));
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
    if (String(url).startsWith("https://images.example")) return new Response(new Uint8Array(f.png));
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
  for (const [error_code, expected] of [["request_preparation_failed", "generation_submission_failed"], ["admission_capacity", "generation_queue_full"], ["request_rejected", "generation_rejected"], ["generation_failed", "generation_failed"]]) {
    const f = await fixture();
    const run = createV2Layers({ providers: () => [f.entry], provider: () => f.entry, fetch: async (_url, init) => Response.json({ id: JSON.parse(String(init!.body)).client_task_id, status: "error", error_code }) });
    try { assert.equal((await run(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground")).error_code, expected); }
    finally { f.conn.close(); }
  }
});

test("new admission protocol sends a compact foreground URL with the frozen byte hash", async () => {
  const f = await fixture(); let downloads = 0; const posts: Array<{body: any; headers: any; bytes: number}> = [];
  const run = createV2Layers({providers:()=>[f.entry],provider:()=>f.entry,fetch:async(url,init)=>{
    if(String(url).startsWith('https://images.example')) { downloads++; return new Response(new Uint8Array(f.png)); }
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


test("explicit model refusal with a generic upstream error remains terminal without resubmission", async () => {
  for (const [error, expected] of [
    ["非常抱歉，生成的图片可能违反了关于与第三方内容相似性的防护限制。", "generation_rejected"],
    ["This may violate our guardrails concerning similarity to third-party content", "generation_rejected"],
    ["HTTP 502 upstream connection failed", "generation_failed"],
  ]) {
    const f = await fixture(); let posts = 0;
    const run = createV2Layers({ providers: () => [f.entry], provider: () => f.entry, fetch: async (_url, init) => {
      posts++;
      return Response.json({ id: JSON.parse(String(init!.body)).client_task_id, status: "error", error_code: "generation_failed", error });
    } });
    try {
      const first = await run(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground");
      assert.equal(first.error_code, expected);
      assert.equal((await run(f.store, f.plugin, f.job, f.claim.leaseToken, "foreground")).error_code, expected);
      assert.equal(posts, 1);
    } finally { f.conn.close(); }
  }
});


test("small source margins do not reject valid foregrounds or prevent background generation", async () => {
  for (const [left, top] of [[16, 400], [988, 400], [400, 16], [400, 1500]]) {
    const f = await fixture(); let posts = 0;
    const cut = await sharp({ create: { width: 20, height: 20, channels: 4, background: "#cf7842" } }).png().toBuffer();
    const png = await sharp(f.png).composite([{ input: cut, left, top }]).png().toBuffer();
    const run = createV2Layers({ providers: () => [f.entry], provider: () => f.entry, fetch: async (url, init) => {
      if (String(url).startsWith("https://images.example")) return new Response(new Uint8Array(png));
      posts++;
      return Response.json({ id: JSON.parse(String(init!.body)).client_task_id, status: "success", data: [{ url: "https://images.example/foreground.png" }] });
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
    if (String(url).startsWith("https://images.example")) return new Response(new Uint8Array(f.png));
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
