import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { createVisionJobStore } from "../src/storage/vision-jobs.js";
import { createVisionJobRunner, DURABLE_VISION_TIMEOUT_MS } from "../src/domain/vision/jobs.js";
import { createVisionRoutes } from "../src/server/routes/vision.js";
import type { analyzeVision } from "../src/domain/vision/index.js";
import type { InkastPlugin } from "../src/plugins/types.js";
const plugin: InkastPlugin = { id: "one", name: "One", imageDefaults: {}, sourceImageHosts: ["https://images.example"], visionTasks: { v2_plan: { systemPrompt: "Plan", providerIds: ["api"], maxImages: 2, outputSchema: { type: "object", additionalProperties: false, properties: {} } } } };
const input = { images: [{ url: "https://images.example/a.png" }], context: { stage: "plan" } };
const id = "vision-" + "a".repeat(64);
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(analyze: typeof analyzeVision) {
  const conn = new Database(":memory:"); conn.exec(readFileSync(new URL("../src/storage/schema.sql", import.meta.url), "utf8"));
  const store = createVisionJobStore(conn), runner = createVisionJobRunner(store, analyze, () => plugin);
  const app = new Hono(); let current = plugin;
  app.use("*", async (c, next) => { c.set("plugin", current); await next(); });
  app.route("/vision", createVisionRoutes(undefined, () => runner));
  const submit = (payload: object = {}) => app.request("/vision/tasks/v2_plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ request_id: id, ...input, ...payload }) });
  return { conn, store, runner, app, submit, asPlugin: (p: InkastPlugin) => { current = p; } };
}
test("durable vision survives client disconnect, repeated submissions and runner replacement without a second model call", async () => {
  let calls = 0, release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  const f = fixture((async (_p, _task, _input, signal, _complete, deadline) => {
    calls++; assert.equal(signal, undefined); assert.equal(deadline, DURABLE_VISION_TIMEOUT_MS);
    await gate; return { data: { plan: true }, raw: "{}", backend: "openai-compatible", durationMs: 600001 };
  }) as typeof analyzeVision);
  try {
    assert.equal((await f.submit()).status, 202);
    // The lost POST acknowledgement is retried with the same frozen identity.
    assert.equal((await f.submit()).status, 202);
    assert.equal(calls, 1);
    assert.equal(((await (await f.app.request(`/vision/tasks/${id}`)).json()) as {status:string}).status, "running");
    assert.equal((await f.submit({ context: { stage: "different" } })).status, 409);
    assert.equal((await f.submit({ reasoning_effort: "low" })).status, 400);
    assert.equal((await f.submit({ images: [{ url: "https://evil.example/private" }] })).status, 400);
    f.asPlugin({ ...plugin, id: "other" });
    assert.equal((await f.app.request(`/vision/tasks/${id}`)).status, 404);
    f.asPlugin(plugin);
    release(); await tick();
    const result = await (await f.app.request(`/vision/tasks/${id}`)).json() as {status:string;data:object;duration_ms:number};
    assert.equal(result.status, "succeeded"); assert.deepEqual(result.data, { plan: true });
    assert.equal(result.duration_ms, 600001);
    const newRunner = createVisionJobRunner(createVisionJobStore(f.conn), (async () => { throw Error("Must not replay completed task"); }) as typeof analyzeVision, () => plugin);
    newRunner.start();
    await f.submit(); assert.equal(calls, 1);
    assert.equal(newRunner.store.get(plugin.id, id)?.status, "succeeded");
  } finally { release(); await tick(); f.conn.close(); }
});
test("startup resumes queued vision but never replays a running call with an unknown billed outcome", async () => {
  let calls = 0;
  const f = fixture((async () => { calls++; return { data: {}, raw: "{}", backend: "openai-compatible", durationMs: 1 }; }) as typeof analyzeVision);
  f.store.submit(plugin.id, id, "v2_plan", input); f.store.claim(plugin.id, id);
  const second = "vision-" + "b".repeat(64); f.store.submit(plugin.id, second, "v2_plan", input);
  f.runner.start(); await tick();
  assert.equal(calls, 1);
  assert.equal(f.store.get(plugin.id, second)?.status, "succeeded");
  const interrupted = f.store.get(plugin.id, id)!;
  assert.equal(interrupted.status, "failed");
  assert.equal(JSON.parse(interrupted.error_json!).billing_unknown, true);
  await f.submit(); assert.equal(calls, 1);
  f.conn.close();
});

test("a failed durable operation is immutable and late results cannot overwrite an interrupted operation", async () => {
  let calls = 0;
  const f = fixture((async () => { calls++; throw Error("known failure"); }) as typeof analyzeVision);
  await f.submit(); await tick();
  assert.equal(f.store.get(plugin.id, id)?.status, "failed");
  await f.submit(); await tick(); assert.equal(calls, 1);
  assert.equal(f.store.get(plugin.id, id)?.input_json, "{}");
  assert.equal(f.store.finish(plugin.id, id, { data: { accepted: true } }, null), false);
  assert.equal(f.store.get(plugin.id, id)?.status, "failed");
  f.conn.close();
});

test("durable queue caps total reservations and only runs two operations per plugin", async () => {
  const releases: Array<() => void> = []; let calls = 0;
  const f = fixture((async () => {
    calls++; await new Promise<void>(resolve => releases.push(resolve));
    return { data: {}, raw: "{}", backend: "openai-compatible", durationMs: 1 };
  }) as typeof analyzeVision);
  try {
    for (let n = 0; n < 16; n++) await f.runner.submit(plugin, `vision-${n.toString(16).padStart(64, "0")}`, "v2_plan", input);
    assert.equal(calls, 2);
    assert.equal(f.store.queued().length, 14);
    await assert.rejects(f.runner.submit(plugin, `vision-${"f".repeat(64)}`, "v2_plan", input), { code: "vision_queue_full" });
    releases.shift()!(); await tick();
    assert.equal(calls, 3);
  } finally {
    while (releases.length) { releases.shift()!(); await tick(); }
    f.conn.close();
  }
});
