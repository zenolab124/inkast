import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import test, { after } from "node:test";
import { createProvider } from "../src/storage/providers.js";
import { db } from "../src/storage/db.js";
import { OpenAiCompatibleDriver } from "../src/drivers/llm/openai-compatible.js";
import { completeJsonWithFallover } from "../src/drivers/llm/with-fallover.js";
import { LlmDriverError, type CompleteJsonOptions } from "../src/drivers/llm/types.js";

const dir = mkdtempSync(join(tmpdir(), "inkast-llm-vision-"));
process.env.INKAST_DATA_DIR = dir;
after(() => { db().close(); rmSync(dir, { recursive: true, force: true }); });

async function mockUpstream(reply: (body: Record<string, unknown>) => string) {
  const bodies: Record<string, unknown>[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
    bodies.push(body);
    const completion = {
      id: "mock-completion", object: "chat.completion", created: 1, model: body.model,
      choices: [{ index: 0, message: { role: "assistant", content: reply(body) }, finish_reason: "stop" }],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120,
        prompt_tokens_details: { cached_tokens: 30 }, completion_tokens_details: { reasoning_tokens: 7 } },
    };
    if (body.stream) {
      res.writeHead(200, { "Content-Type": "text/event-stream", "x-request-id": "mock-request-id" });
      const content = reply(body);
      const halfway = Math.floor(content.length / 2);
      res.write(": heartbeat\n\n");
      for (const part of [content.slice(0, halfway), content.slice(halfway)]) {
        res.write(`data: ${JSON.stringify({ id: completion.id, choices: [{ index: 0, delta: { content: part }, finish_reason: null }] })}\n\n`);
      }
      res.write(`data: ${JSON.stringify({ id: completion.id, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ id: completion.id, choices: [], usage: completion.usage })}\n\n`);
      res.end("data: [DONE]\n\n");
    } else {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(completion));
    }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return { bodies, baseUrl: `http://127.0.0.1:${address.port}/v1`, close: () => close(server) };
}
function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
}
function provider(baseUrl: string, extras: Record<string, unknown> = {}) {
  return createProvider({ name: `test-${randomUUID()}`, baseUrl, apiKey: "fake-test-key",
    capabilities: [{ kind: "llm", model: "test-vision-model", extras }] });
}
const opts: CompleteJsonOptions = {
  systemPrompt: "Return JSON", userPrompt: "inspect",
  schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false },
  images: [{ url: "https://images.example/source.png" }, { url: "https://images.example/mask.png" }],
  requireVision: true,
};

test("private V2 peer transport applies only to the exact vision provider; ordinary LLM keeps its public endpoint", async () => {
  const ordinary = await mockUpstream(() => '{"ok":true}');
  const peer = await mockUpstream(() => '{"ok":true}');
  try {
    const record = provider(ordinary.baseUrl), driver = new OpenAiCompatibleDriver(record.id);
    const endpointOverride = { providerId: record.id, baseUrl: peer.baseUrl };
    await driver.completeJson({ ...opts, endpointOverride });
    assert.equal(peer.bodies.length, 1); assert.equal(ordinary.bodies.length, 0);
    await driver.completeJson({ ...opts, requireVision: false, endpointOverride });
    assert.equal(peer.bodies.length, 1); assert.equal(ordinary.bodies.length, 1);
    await driver.completeJson({ ...opts, endpointOverride: { providerId: "another-provider", baseUrl: peer.baseUrl } });
    assert.equal(peer.bodies.length, 1); assert.equal(ordinary.bodies.length, 2);
  } finally { await ordinary.close(); await peer.close(); }
});

test("vision driver sends images and explicit high, overriding provider medium and retaining usage", async () => {
  const upstream = await mockUpstream(() => '{"ok":true}');
  try {
    const p = provider(upstream.baseUrl, { reasoning_effort: "medium" });
    const result = await new OpenAiCompatibleDriver(p.id).completeJson({ ...opts, reasoningEffort: "high" });
    assert.equal(upstream.bodies[0]?.reasoning_effort, "high");
    assert.equal(upstream.bodies[0]?.stream, true);
    assert.deepEqual(upstream.bodies[0]?.stream_options, { include_usage: true });
    const messages = upstream.bodies[0]?.messages as Array<{ content: unknown[] }>;
    assert.deepEqual(messages[1]?.content.slice(1), opts.images!.map(image => ({ type: "image_url", image_url: image })));
    assert.deepEqual(result.receipt?.usage, { inputTokens: 100, cachedInputTokens: 30, outputTokens: 20, reasoningOutputTokens: 7, totalTokens: 120 });
    assert.equal(result.receipt?.reasoningEffort, "high");
    assert.equal(result.receipt?.providerId, p.id);
    assert.equal(result.receipt?.outcome, "succeeded");
    assert.equal(result.receipt?.requestId, "mock-request-id");
  } finally { await upstream.close(); }
});

test("ordinary LLM calls keep configured effort and do not force unsupported defaults", async () => {
  const upstream = await mockUpstream(() => '{"ok":true}');
  try {
    const p = provider(upstream.baseUrl, { reasoning_effort: "high" });
    await new OpenAiCompatibleDriver(p.id).completeJson({ ...opts, requireVision: false });
    const plain = provider(upstream.baseUrl);
    await new OpenAiCompatibleDriver(plain.id).completeJson({ ...opts, requireVision: false });
    assert.equal(upstream.bodies[0]?.reasoning_effort, "high");
    assert.equal(Object.hasOwn(upstream.bodies[1]!, "reasoning_effort"), false);
  } finally { await upstream.close(); }
});

test("vision pool excludes unrelated providers and stops at two charged invalid outputs", async () => {
  const upstream = await mockUpstream(() => '{"ok":"wrong type"}');
  try {
    provider(upstream.baseUrl); // Enabled but not allowed for this task.
    const allowed = provider(upstream.baseUrl);
    let error: unknown;
    try {
      await completeJsonWithFallover(opts, "test vision", value => (value as { ok: unknown }).ok === true ? null : "bad decision", {
        apiOnly: true, providerIds: [allowed.id], maxCalls: 2,
      });
    } catch (caught) { error = caught; }
    assert.ok(error instanceof LlmDriverError);
    assert.equal(upstream.bodies.length, 2);
    assert.equal(error.attempts?.length, 2);
    assert.ok(error.attempts?.every(a => a.providerId === allowed.id && a.outcome === "invalid_json" && a.usage?.inputTokens === 100));
    await assert.rejects(() => completeJsonWithFallover(opts, "empty", undefined, {
      apiOnly: true, providerIds: [], maxCalls: 2,
    }), /no eligible API backend/);
    assert.equal(upstream.bodies.length, 2);
  } finally { await upstream.close(); }
});

test("invalid JSON retains the billable receipt; a text-only provider is never used for vision", async () => {
  const upstream = await mockUpstream(() => "not JSON");
  try {
    const p = provider(upstream.baseUrl);
    await assert.rejects(() => new OpenAiCompatibleDriver(p.id).completeJson(opts), error => {
      assert.ok(error instanceof LlmDriverError);
      assert.equal(error.receipt?.outcome, "invalid_json");
      assert.equal(error.receipt?.usage?.outputTokens, 20);
      return true;
    });
    const text = provider(upstream.baseUrl, { supportsVision: false });
    await assert.rejects(() => completeJsonWithFallover(opts, "text only", undefined, {
      providerIds: [text.id], apiOnly: true, maxCalls: 2,
    }), /no eligible API backend/);
    assert.equal(upstream.bodies.length, 1);
  } finally { await upstream.close(); }
});

test("API-only vision never falls back to an enabled local OAuth backend", async () => {
  db().prepare("UPDATE provider_capabilities SET disabled=0 WHERE provider_id='__builtin_claude_code__' AND kind='llm'").run();
  await assert.rejects(() => completeJsonWithFallover(opts, "no local", undefined, {
    providerIds: ["__builtin_claude_code__"], apiOnly: true, maxCalls: 2,
  }), /no eligible API backend/);
});
