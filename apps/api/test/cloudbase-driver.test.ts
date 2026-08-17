import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";
import test from "node:test";

import {
  buildCloudBaseRequestBody,
  callCloudBaseApi,
  resolveCloudBaseRatio,
} from "../src/drivers/image/cloudbase.js";
import type { Provider, ProviderCapability } from "../src/storage/providers.js";

const capability: ProviderCapability = {
  kind: "image",
  model: "hunyuan-image",
  priority: 1,
  disabled: false,
  extras: { mode: "cloudbase", maxConcurrency: 5 },
};

async function listen(server: Server): Promise<number> {
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return address.port;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
}

test("CloudBase maps supported ratios and requires an original URL for image-to-image", () => {
  assert.equal(resolveCloudBaseRatio("ratio:9:16"), "9:16");
  assert.equal(resolveCloudBaseRatio("1024x576"), "16:9");
  assert.equal(resolveCloudBaseRatio("auto"), "1:1");
  assert.throws(
    () => buildCloudBaseRequestBody({
      promptText: "test",
      referenceImages: [{ buffer: Buffer.from("ref"), mimeType: "image/png", filename: "ref.png" }],
    }),
    /original validated HTTPS source URL/,
  );
});

test("CloudBase signs the exact body and downloads the temporary output", async () => {
  const secret = "test-secret-that-is-longer-than-32-bytes";
  let receivedBody = "";
  let signatureValid = false;
  const server = createServer((req, res) => {
    if (req.url === "/output.jpg") {
      res.writeHead(200, { "Content-Type": "image/jpeg" });
      res.end(Buffer.from("cloudbase-image"));
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", chunk => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      receivedBody = Buffer.concat(chunks).toString("utf8");
      const timestamp = String(req.headers["x-inkast-timestamp"] ?? "");
      const expected = createHmac("sha256", secret)
        .update(`${timestamp}.${receivedBody}`)
        .digest("hex");
      signatureValid = req.headers["x-inkast-signature"] === expected;
      const address = server.address();
      assert.ok(address && typeof address === "object");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, url: `http://127.0.0.1:${address.port}/output.jpg` }));
    });
  });
  const port = await listen(server);
  const provider: Provider = {
    id: "cloudbase-test",
    name: "CloudBase",
    baseUrl: `http://127.0.0.1:${port}/generate`,
    createdAt: 1,
    updatedAt: 1,
    capabilities: [capability],
  };
  try {
    const b64 = await callCloudBaseApi(provider, capability, secret, {
      promptText: "纸雕风格小狗",
      size: "ratio:3:4",
      referenceImages: [{
        buffer: Buffer.from("validated-ref"),
        mimeType: "image/jpeg",
        filename: "source.jpg",
        sourceUrl: "https://source.example/signed.jpg?token=secret",
      }],
    });
    assert.equal(signatureValid, true);
    assert.equal(b64, Buffer.from("cloudbase-image").toString("base64"));
    const body = JSON.parse(receivedBody) as Record<string, unknown>;
    assert.equal(body.prompt, "纸雕风格小狗");
    assert.equal(body.ratio, "3:4");
    assert.deepEqual(body.imageUrls, ["https://source.example/signed.jpg?token=secret"]);
  } finally {
    await close(server);
  }
});
