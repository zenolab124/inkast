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
      extras: { mode: "c2i-tasks" },
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
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
