import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { callC2iTasksApi } from "../src/drivers/image/c2i-tasks.js";
import { IMAGE_CLEANLINESS_INSTRUCTION } from "../src/drivers/image/prompt-cleanliness.js";
import type { Provider, ProviderCapability } from "../src/storage/providers.js";

test("c2i-tasks explicitly opts into upstream output optimization", async () => {
  let generationBody: Record<string, unknown> | undefined;
  const server = createServer((req, res) => {
    if (req.url?.startsWith("/api/image-tasks?")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        items: [{ id: generationBody?.client_task_id, status: "success", data: [{ b64_json: "d2VicA==" }] }],
      }));
      return;
    }

    const chunks: Buffer[] = [];
    req.on("data", chunk => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      generationBody = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: generationBody?.client_task_id, status: "queued" }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const capability: ProviderCapability = {
      kind: "image",
      model: "gpt-image-2",
      priority: 1,
      disabled: false,
      // The old provider-global setting must not force URL delivery.
      extras: { mode: "c2i-tasks", imageOutput: "url" },
    };
    const provider: Provider = {
      id: "c2i-test",
      name: "c2i test",
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      createdAt: 1,
      updatedAt: 1,
      capabilities: [capability],
    };

    const result = await callC2iTasksApi(provider, capability, "test-key", {
      promptText: "test",
      format: "webp",
      background: "transparent",
    });

    assert.equal(result.b64, "d2VicA==");
    assert.equal(generationBody?.output_format, "webp");
    assert.equal(generationBody?.background, "transparent");
    assert.equal(
      String(generationBody?.prompt).endsWith(IMAGE_CLEANLINESS_INSTRUCTION),
      true,
    );
    assert.equal(generationBody?.optimize_output, true);
    assert.equal(generationBody?.response_format, "b64_json");
    assert.equal(generationBody?.url_source, undefined);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test("c2i-tasks requests scoped R2 delivery only for a persistent-url call", async () => {
  let generationBody: Record<string, unknown> | undefined;
  const server = createServer((req, res) => {
    if (req.url?.startsWith("/api/image-tasks?")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        items: [{
          id: generationBody?.client_task_id,
          status: "success",
          data: [{ url: "https://img.124213.xyz/2026/08/17/result.png" }],
        }],
      }));
      return;
    }

    const chunks: Buffer[] = [];
    req.on("data", chunk => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      generationBody = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: generationBody?.client_task_id, status: "queued" }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const capability: ProviderCapability = {
      kind: "image",
      model: "gpt-image-2",
      priority: 1,
      disabled: false,
      // The old provider-global setting must not control V2 delivery.
      extras: { mode: "c2i-tasks", imageOutput: "b64" },
    };
    const provider: Provider = {
      id: "c2i-r2-test",
      name: "c2i r2 test",
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      createdAt: 1,
      updatedAt: 1,
      capabilities: [capability],
    };

    const result = await callC2iTasksApi(provider, capability, "scoped-test-key", {
      promptText: "test",
      format: "png",
      deliveryIntent: "persistent-url",
    });

    assert.equal(result.b64, "");
    assert.equal(result.url, "https://img.124213.xyz/2026/08/17/result.png");
    assert.equal(generationBody?.response_format, "url");
    assert.equal(generationBody?.url_source, "r2");
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test("Codex aliases keep original pixels and never use web resume-poll", async () => {
  const { isC2iCodexModel, resolveC2iOptimizeOutput } = await import("../src/drivers/image/c2i-tasks.js");
  assert.equal(isC2iCodexModel("pro-codex-gpt-image-2.5"), true);
  assert.equal(isC2iCodexModel("codex-gpt-image-2.5"), true);
  assert.equal(isC2iCodexModel("gpt-image-2.5"), false);
  const capability: ProviderCapability = {
    kind: "image", model: "pro-codex-gpt-image-2.5", priority: 1, disabled: false,
    extras: { mode: "c2i-tasks" },
  };
  const provider: Provider = {
    id: "codex-private", name: "Codex private", baseUrl: "https://upstream.example/v1",
    createdAt: 1, updatedAt: 1, capabilities: [capability],
  };
  for (const model of ["pro-codex-gpt-image-2.5", "gpt-image-2"]) {
    let now = 0, polls = 0;
    const submitted: Record<string, unknown>[] = [], resumed: string[] = [];
    const urls: string[] = [];
    const result = await callC2iTasksApi(provider, { ...capability, model }, "test-key", {
      promptText: "test", quality: "high", size: "1024x1280", format: "png",
      background: "transparent", deliveryIntent: "persistent-url",
    }, {
      now: () => now,
      sleep: async () => { now += 301_000; },
      fetch: async (url, init) => {
        urls.push(String(url));
        if (String(url).endsWith("/resume-poll")) {
          resumed.push(String(url));
          return Response.json({ ok: true });
        }
        if (init?.method === "POST") {
          const body = JSON.parse(String(init.body)); submitted.push(body);
          return Response.json({ id: body.client_task_id, status: "queued" });
        }
        polls++;
        return Response.json({ items: [{ id: submitted[0]!.client_task_id,
          status: polls === 1 ? "running" : "success",
          data: [{ url: "https://img.example/result.png" }],
        }] });
      },
    });
    assert.equal(result.url, "https://img.example/result.png");
    assert.equal(submitted.length, 1);
    assert.equal(submitted[0]!.model, model);
    assert.equal(submitted[0]!.batch_size, 1);
    assert.equal(submitted[0]!.quality, "high");
    assert.equal(submitted[0]!.background, "transparent");
    assert.equal(submitted[0]!.size, "1024x1280");
    assert.equal(submitted[0]!.optimize_output, model === "gpt-image-2");
    assert.equal(resumed.length, model === "gpt-image-2" ? 1 : 0);
    assert.ok(urls.filter(url => url.includes("?ids=")).every(url => url.includes(String(submitted[0]!.client_task_id))));
  }
  assert.equal(resolveC2iOptimizeOutput({ ...capability, extras: { optimizeOutput: true } }), true);
  assert.equal(resolveC2iOptimizeOutput({ ...capability, model: "gpt-image-2", extras: { optimizeOutput: false } }), false);
});

test("Codex reference editing preserves alpha request and returns bytes without R2", async () => {
  const capability: ProviderCapability = {
    kind: "image", model: "pro-codex-gpt-image-2.5", priority: 1, disabled: false,
    extras: { mode: "c2i-tasks", explicitAllowlistOnly: true },
  };
  const provider: Provider = { id: "codex", name: "Codex", baseUrl: "https://upstream.example/v1", createdAt: 1, updatedAt: 1, capabilities: [capability] };
  let body: Record<string, any>;
  const result = await callC2iTasksApi(provider, capability, "test-key", {
    promptText: "preserve the subject", size: "ratio:4:5", format: "png", background: "transparent",
    referenceImages: [{ buffer: Buffer.from("reference"), mimeType: "image/png", filename: "ref.png" }],
  }, {
    sleep: async () => {},
    fetch: async (url, init) => {
      if (init?.method === "POST") {
        assert.equal(String(url), "https://upstream.example/api/image-tasks/edits");
        body = JSON.parse(String(init.body));
        return Response.json({ id: body.client_task_id, status: "queued" });
      }
      return Response.json({ items: [{ id: body.client_task_id, status: "success", data: [{ b64_json: "aW1hZ2U=" }] }] });
    },
  });
  assert.equal(result.b64, "aW1hZ2U=");
  assert.equal(body!.response_format, "b64_json");
  assert.equal(body!.url_source, undefined);
  assert.equal(body!.background, "transparent");
  assert.equal(body!.optimize_output, false);
  assert.equal(body!.size, undefined);
  assert.match(body!.prompt, /Target aspect ratio: 4:5/);
  assert.deepEqual(body!.images, ["data:image/png;base64,cmVmZXJlbmNl"]);
});

test("durable caller identity resumes the original task after lost admission without another generation", async () => {
  const capability: ProviderCapability = { kind: "image", model: "pro-codex-gpt-image-2.5", priority: 1, disabled: false, extras: { mode: "c2i-tasks" } };
  const provider: Provider = { id: "codex-durable", name: "Codex", baseUrl: "https://upstream.example/v1", createdAt: 1, updatedAt: 1, capabilities: [capability] };
  const bodies: Record<string, any>[] = [];
  let knownId: string | undefined;
  const request: typeof fetch = async (url, init) => {
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body)); bodies.push(body); knownId = body.client_task_id;
      throw new Error("admission response lost");
    }
    const id = new URL(String(url)).searchParams.get("ids");
    return Response.json(knownId === id
      ? { items: [{ id, status: "success", data: [{ b64_json: "aW1hZ2U=" }] }] }
      : { missing_ids: [id] }, { headers: { "X-Image-Task-Admission": "durable-v1" } });
  };
  const input = { requestKey: "persisted-job-1", promptText: "same source", format: "png" as const };
  const deps = { fetch: request, sleep: async () => {} };
  assert.equal((await callC2iTasksApi(provider, capability, "test-key", input, deps)).b64, "aW1hZ2U=");
  assert.equal((await callC2iTasksApi(provider, capability, "test-key", input, deps)).b64, "aW1hZ2U=");
  assert.equal(bodies.length, 1);
  assert.match(knownId!, /^inkast-[a-f0-9]{48}$/);
});

test("unknown upstream state retains the receipt; no blind re-submit", async () => {
  const { C2iTaskPendingError } = await import("../src/drivers/image/c2i-tasks.js");
  const capability: ProviderCapability = { kind: "image", model: "codex-gpt-image-2.5", priority: 1, disabled: false, extras: { mode: "c2i-tasks" } };
  const provider: Provider = { id: "codex", name: "Codex", baseUrl: "https://upstream.example/v1", createdAt: 1, updatedAt: 1, capabilities: [capability] };
  let posts = 0;
  await assert.rejects(callC2iTasksApi(provider, capability, "key", {
    requestKey: "saved-job", promptText: "same request",
  }, {
    sleep: async () => {},
    fetch: async (_url, init) => {
      if (init?.method === "POST") posts++;
      throw new Error("status endpoint unreachable");
    },
  }), error => error instanceof C2iTaskPendingError && /^inkast-[a-f0-9]{48}$/.test(error.taskId));
  assert.equal(posts, 0);
});

test("content or model changes cannot reuse the previous request fingerprint", async () => {
  const capability: ProviderCapability = { kind: "image", model: "codex-gpt-image-2.5", priority: 1, disabled: false, extras: { mode: "c2i-tasks" } };
  const provider: Provider = { id: "codex", name: "Codex", baseUrl: "https://upstream.example/v1", createdAt: 1, updatedAt: 1, capabilities: [capability] };
  const ids: string[] = [];
  const deps = {
    sleep: async () => {},
    fetch: (async (url, init) => {
      const id = new URL(String(url)).searchParams.get("ids");
      if (init?.method === "POST") {
        const body = JSON.parse(String(init.body)); ids.push(body.client_task_id);
        return Response.json({ id: body.client_task_id, status: "queued" });
      }
      return Response.json(ids.includes(id!)
        ? { items: [{ id, status: "success", data: [{ b64_json: "aW1hZ2U=" }] }] }
        : { missing_ids: [id] }, { headers: { "X-Image-Task-Admission": "durable-v1" } });
    }) as typeof fetch,
  };
  for (const promptText of ["original", "rewritten"])
    await callC2iTasksApi(provider, capability, "key", { requestKey: "job", promptText }, deps);
  await callC2iTasksApi(provider, { ...capability, model: "codex-gpt-image-2" }, "key", { requestKey: "job", promptText: "original" }, deps);
  assert.equal(new Set(ids).size, 3);
});

test("Codex unknown outcomes and delivery errors retain original receipt without another POST", async () => {
  const { C2iTaskPendingError } = await import("../src/drivers/image/c2i-tasks.js");
  const capability: ProviderCapability = { kind: "image", model: "pro-codex-gpt-image-2.5", priority: 1, disabled: false, extras: { mode: "c2i-tasks" } };
  const provider: Provider = { id: "codex-stability", name: "Codex", baseUrl: "https://upstream.example/v1", createdAt: 1, updatedAt: 1, capabilities: [capability] };
  for (const error_code of ["CODEX_OUTCOME_UNKNOWN", "codex_invalid_image", "codex_result_delivery_failed"]) {
    let posts = 0;
    const input = { requestKey: "original-job", promptText: "same prompt" };
    const deps = {
      sleep: async () => {},
      fetch: (async (url, init) => {
        assert.notEqual(init?.method, "POST");
        if (init?.method === "POST") posts++;
        const id = new URL(String(url)).searchParams.get("ids");
        return Response.json({ items: [{ id, status: "error", error_code, error: "original result requires recovery" }] });
      }) as typeof fetch,
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      await assert.rejects(callC2iTasksApi(provider, capability, "test-key", input, deps), error =>
        error instanceof C2iTaskPendingError && /^inkast-[a-f0-9]{48}$/.test(error.taskId));
    }
    assert.equal(posts, 0);
  }
});
