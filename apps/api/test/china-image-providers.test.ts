import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";

import type { Provider, ProviderCapability } from "../src/storage/providers.js";
import {
  buildSiliconFlowRequestBody,
  callSiliconFlowApi,
} from "../src/drivers/image/siliconflow.js";
import {
  buildZhipuRequestBody,
  callZhipuApi,
} from "../src/drivers/image/zhipu.js";
import { IMAGE_CLEANLINESS_INSTRUCTION } from "../src/drivers/image/prompt-cleanliness.js";

const zhipuCapability: ProviderCapability = {
  kind: "image",
  model: "cogview-4-250304",
  priority: 1,
  disabled: false,
  extras: { mode: "zhipu" },
};

const siliconFlowCapability: ProviderCapability = {
  kind: "image",
  model: "Kwai-Kolors/Kolors",
  priority: 1,
  disabled: false,
  extras: { mode: "siliconflow" },
};

function provider(
  id: string,
  name: string,
  baseUrl: string,
  capability: ProviderCapability,
): Provider {
  return {
    id,
    name,
    baseUrl,
    createdAt: 1,
    updatedAt: 1,
    capabilities: [capability],
  };
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return address.port;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close(err => err ? reject(err) : resolve());
  });
}

test("CogView-4 maps ratios and sends only the documented Zhipu fields", async () => {
  const ratioBody = buildZhipuRequestBody(zhipuCapability, {
    promptText: "纸雕风格的橘猫",
    size: "ratio:3:4",
    quality: "high",
  });
  assert.equal(ratioBody.size, "864x1152");
  assert.equal(ratioBody.quality, "hd");
  assert.match(ratioBody.prompt, /Target aspect ratio: 3:4\./);

  let receivedPath = "";
  let receivedBody: Record<string, unknown> | undefined;
  const server = createServer((req, res) => {
    if (req.url === "/result.png") {
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end(Buffer.from("zhipu-image"));
      return;
    }
    receivedPath = req.url ?? "";
    const chunks: Buffer[] = [];
    req.on("data", chunk => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      receivedBody = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
      const address = server.address();
      assert.ok(address && typeof address === "object");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [{ url: `http://127.0.0.1:${address.port}/result.png` }] }));
    });
  });
  const port = await listen(server);
  try {
    const result = await callZhipuApi(
      provider("zhipu", "CogView-4", `http://127.0.0.1:${port}/api/paas/v4`, zhipuCapability),
      zhipuCapability,
      "test-key",
      { promptText: "test", size: "1024x1024", quality: "medium" },
    );
    assert.equal(result, Buffer.from("zhipu-image").toString("base64"));
    assert.equal(receivedPath, "/api/paas/v4/images/generations");
    assert.deepEqual(Object.keys(receivedBody ?? {}).sort(), ["model", "prompt", "quality", "size"]);
    assert.equal(receivedBody?.quality, "standard");
  } finally {
    await close(server);
  }
});

test("Kolors sends SiliconFlow image_size fields and downloads the one-hour URL", async () => {
  const body = buildSiliconFlowRequestBody(siliconFlowCapability, {
    promptText: "一只橘猫",
    size: "ratio:9:16",
  });
  assert.deepEqual(body, {
    model: "Kwai-Kolors/Kolors",
    prompt: `一只橘猫\n\nTarget aspect ratio: 9:16.\n\n${IMAGE_CLEANLINESS_INSTRUCTION}`,
    image_size: "720x1280",
    batch_size: 1,
    num_inference_steps: 20,
    guidance_scale: 7.5,
  });

  let receivedPath = "";
  let receivedAuthorization = "";
  let receivedBody: Record<string, unknown> | undefined;
  const server = createServer((req, res) => {
    if (req.url === "/kolors.png") {
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end(Buffer.from("kolors-image"));
      return;
    }
    receivedPath = req.url ?? "";
    receivedAuthorization = String(req.headers.authorization ?? "");
    const chunks: Buffer[] = [];
    req.on("data", chunk => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      receivedBody = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
      const address = server.address();
      assert.ok(address && typeof address === "object");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ images: [{ url: `http://127.0.0.1:${address.port}/kolors.png` }] }));
    });
  });
  const port = await listen(server);
  try {
    const result = await callSiliconFlowApi(
      provider("siliconflow", "Kolors", `http://127.0.0.1:${port}/v1`, siliconFlowCapability),
      siliconFlowCapability,
      "test-key",
      { promptText: "test", size: "ratio:1:1" },
    );
    assert.equal(result, Buffer.from("kolors-image").toString("base64"));
    assert.equal(receivedPath, "/v1/images/generations");
    assert.equal(receivedAuthorization, "Bearer test-key");
    assert.equal(receivedBody?.image_size, "1024x1024");
  } finally {
    await close(server);
  }
});

test("CogView-4 and Kolors reject reference images before making a request", () => {
  const input = {
    promptText: "test",
    referenceImages: [{ buffer: Buffer.from("ref"), mimeType: "image/png", filename: "ref.png" }],
  };
  assert.throws(() => buildZhipuRequestBody(zhipuCapability, input), /does not support reference/);
  assert.throws(() => buildSiliconFlowRequestBody(siliconFlowCapability, input), /does not support reference/);
});
