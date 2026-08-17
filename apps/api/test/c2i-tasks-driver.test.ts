import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { callC2iTasksApi } from "../src/drivers/image/c2i-tasks.js";
import type { Provider, ProviderCapability } from "../src/storage/providers.js";

test("c2i-tasks explicitly opts into upstream output optimization", async () => {
  let generationBody: Record<string, unknown> | undefined;
  const server = createServer((req, res) => {
    if (req.url?.startsWith("/api/image-tasks?")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        items: [{ id: "task-1", status: "success", data: [{ b64_json: "d2VicA==" }] }],
      }));
      return;
    }

    const chunks: Buffer[] = [];
    req.on("data", chunk => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      generationBody = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: "task-1", status: "queued" }));
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
    });

    assert.equal(result.b64, "d2VicA==");
    assert.equal(generationBody?.output_format, "webp");
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
          id: "task-r2",
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
      res.end(JSON.stringify({ id: "task-r2", status: "queued" }));
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
