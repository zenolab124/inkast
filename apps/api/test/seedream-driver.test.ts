import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import type { Provider, ProviderCapability } from "../src/storage/providers.js";
import {
  buildSeedreamRequestBody,
  callSeedreamApi,
} from "../src/drivers/image/seedream.js";
import { IMAGE_CLEANLINESS_INSTRUCTION } from "../src/drivers/image/prompt-cleanliness.js";

const capability: ProviderCapability = {
  kind: "image",
  model: "doubao-seedream-4-5-251128",
  priority: 1,
  disabled: false,
  extras: { mode: "seedream" },
};

test("Seedream body keeps all reference images on the generations endpoint contract", () => {
  const body = buildSeedreamRequestBody(capability, {
    promptText: "把人物变成纸雕风格",
    size: "ratio:3:4",
    referenceImages: [
      { buffer: Buffer.from("first"), mimeType: "image/PNG", filename: "first.png" },
      { buffer: Buffer.from("second"), mimeType: "image/jpeg", filename: "second.jpg" },
    ],
  });

  assert.equal(body.model, "doubao-seedream-4-5-251128");
  assert.match(body.prompt, /Target aspect ratio: 3:4\./);
  assert.equal(body.size, "2K");
  assert.deepEqual(body.image, [
    `data:image/png;base64,${Buffer.from("first").toString("base64")}`,
    `data:image/jpeg;base64,${Buffer.from("second").toString("base64")}`,
  ]);
  assert.equal(body.sequential_image_generation, "disabled");
  assert.equal(body.stream, false);
  assert.equal(body.response_format, "b64_json");
  assert.equal(body.watermark, false);
});

test("Seedream preserves an explicit pixel size accepted by Ark", () => {
  const body = buildSeedreamRequestBody(capability, {
    promptText: "一只橘猫",
    size: "1664x2304",
  });
  assert.equal(body.size, "1664x2304");
  assert.equal(body.image, undefined);
  assert.equal(
    body.prompt,
    `一只橘猫\n\n${IMAGE_CLEANLINESS_INSTRUCTION}`,
  );
});

test("Seedream converts a small final-output size to 2K plus an aspect-ratio hint", () => {
  const body = buildSeedreamRequestBody(capability, {
    promptText: "一只橘猫",
    size: "622x866",
  });
  assert.equal(body.size, "2K");
  assert.match(body.prompt, /Target aspect ratio: 311:433\./);
});

test("Seedream driver posts JSON to /images/generations and returns b64", async () => {
  let receivedPath = "";
  let receivedAuthorization = "";
  let receivedBody: Record<string, unknown> | undefined;
  const server = createServer((req, res) => {
    receivedPath = req.url ?? "";
    receivedAuthorization = String(req.headers.authorization ?? "");
    const chunks: Buffer[] = [];
    req.on("data", chunk => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      receivedBody = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ created: 1, data: [{ b64_json: "c2VlZHJlYW0=" }] }));
    });
  });

  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const provider: Provider = {
      id: "seedream-test",
      name: "Seedream test",
      baseUrl: `http://127.0.0.1:${address.port}/api/v3`,
      createdAt: 1,
      updatedAt: 1,
      capabilities: [capability],
    };

    const result = await callSeedreamApi(provider, capability, "test-key", {
      promptText: "test prompt",
      size: "ratio:1:1",
    });

    assert.equal(result, "c2VlZHJlYW0=");
    assert.equal(receivedPath, "/api/v3/images/generations");
    assert.equal(receivedAuthorization, "Bearer test-key");
    assert.equal(receivedBody?.model, "doubao-seedream-4-5-251128");
    assert.equal(receivedBody?.response_format, "b64_json");
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close(err => (err ? reject(err) : resolve()));
    });
  }
});
