import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import type { Provider, ProviderCapability } from "../src/storage/providers.js";
import {
  buildSenseNovaRequestBody,
  callSenseNovaApi,
} from "../src/drivers/image/sensenova.js";

const capability: ProviderCapability = {
  kind: "image",
  model: "sensenova-u1-fast",
  priority: 1,
  disabled: false,
  extras: { mode: "sensenova" },
};

test("SenseNova maps Inkast ratios to supported 2K sizes", () => {
  const cases: Array<[string, string]> = [
    ["ratio:1:1", "2048x2048"],
    ["ratio:3:4", "1760x2368"],
    ["ratio:9:16", "1536x2752"],
  ];
  for (const [size, expected] of cases) {
    const body = buildSenseNovaRequestBody(capability, { promptText: "test", size });
    assert.equal(body.size, expected);
    assert.match(body.prompt, new RegExp(`Target aspect ratio: ${size.slice(6)}\\.`));
  }
});

test("SenseNova replaces auto and unsupported sizes with its documented default", () => {
  assert.equal(buildSenseNovaRequestBody(capability, { promptText: "test", size: "auto" }).size, "2752x1536");
  assert.equal(buildSenseNovaRequestBody(capability, { promptText: "test", size: "1024x1024" }).size, "2752x1536");
});

test("SenseNova rejects reference images defensively", () => {
  assert.throws(
    () => buildSenseNovaRequestBody(capability, {
      promptText: "test",
      referenceImages: [{ buffer: Buffer.from("ref"), mimeType: "image/png", filename: "ref.png" }],
    }),
    /does not support reference image input/,
  );
});

test("SenseNova sends only its documented generation fields and downloads the temporary URL", async () => {
  let generationBody: Record<string, unknown> | undefined;
  const server = createServer((req, res) => {
    if (req.url === "/v1/generated.png") {
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end(Buffer.from("image-bytes"));
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", chunk => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      generationBody = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
      const address = server.address();
      assert.ok(address && typeof address === "object");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [{ url: `http://127.0.0.1:${address.port}/v1/generated.png` }] }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const provider: Provider = {
      id: "sensenova-test",
      name: "SenseNova test",
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      createdAt: 1,
      updatedAt: 1,
      capabilities: [capability],
    };
    const result = await callSenseNovaApi(provider, capability, "test-key", {
      promptText: "test",
      size: "ratio:1:1",
    });
    assert.equal(result, Buffer.from("image-bytes").toString("base64"));
    assert.deepEqual(Object.keys(generationBody ?? {}).sort(), ["model", "n", "prompt", "size"]);
    assert.equal(generationBody?.size, "2048x2048");
  } finally {
    await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  }
});
