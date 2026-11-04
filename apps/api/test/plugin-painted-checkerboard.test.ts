import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import sharp from "sharp";

import { db } from "../src/storage/db.js";
import { createProvider } from "../src/storage/providers.js";
import { driveWithRewriteFallback } from "../src/domain/generate/with-rewrite.js";
import {
  createPaintedCheckerboardGate,
  pluginRequiresTransparentOutput,
} from "../src/domain/plugin-async/index.js";
import { ImageGenError, ImageOutputRejectedError } from "../src/drivers/image/types.js";
import type { InkastPlugin } from "../src/plugins/types.js";

const dir = mkdtempSync(join(tmpdir(), "inkast-checkerboard-"));
process.env.INKAST_DATA_DIR = dir;
const servers: Server[] = [];
after(async () => {
  await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
  db().close();
  rmSync(dir, { recursive: true, force: true });
});

async function checkerboardPng(): Promise<Buffer> {
  const width = 256;
  const height = 256;
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const v = (Math.floor(x / 16) + Math.floor(y / 16)) % 2 === 0 ? 255 : 204;
      raw.fill(v, (y * width + x) * 3, (y * width + x) * 3 + 3);
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

async function plainPng(): Promise<Buffer> {
  return sharp({ create: { width: 256, height: 256, channels: 3, background: { r: 40, g: 90, b: 160 } } })
    .png()
    .toBuffer();
}

/** Mock OpenAI-compatible images endpoint; counts generation calls. */
async function imageProvider(png: Buffer): Promise<{ id: string; calls: () => number }> {
  let calls = 0;
  const server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      calls += 1;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ created: 1, data: [{ b64_json: png.toString("base64") }] }));
    });
  });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const provider = createProvider({
    name: `img-${randomUUID()}`,
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    apiKey: "fake-test-key",
    capabilities: [{ kind: "image", model: "gpt-image-2", extras: { mode: "images" } }],
  });
  return { id: provider.id, calls: () => calls };
}

const opaquePlugin = { id: "opaque", name: "Opaque", imageDefaults: {} } as InkastPlugin;
const logoPlugin = {
  id: "logo",
  name: "Logo",
  imageDefaults: { background: "transparent" },
  outputDimensions: { width: 1024, height: 512, fit: "contain-alpha" },
} as InkastPlugin;

test("checkerboard from the first provider is recorded as its failure and falls over to the next", async () => {
  const painted = await imageProvider(await checkerboardPng());
  const clean = await imageProvider(await plainPng());

  const outcome = await driveWithRewriteFallback(
    {
      promptText: "a hero",
      allowedProviderIds: [painted.id, clean.id],
      providerOrder: "allowlist",
      validateOutput: createPaintedCheckerboardGate(opaquePlugin, "task-fallover"),
    },
    { maxRound: 0 },
  );

  assert.equal(outcome.providerId, clean.id);
  assert.equal(outcome.successRound, 0);
  assert.equal(outcome.attempts.length, 2);
  assert.equal(outcome.attempts[0]!.providerId, painted.id);
  assert.equal(outcome.attempts[0]!.ok, false);
  assert.equal(outcome.attempts[0]!.errorCode, "painted_transparency_checkerboard");
  assert.match(outcome.attempts[0]!.errorMessage ?? "", /painted transparency checkerboard/);
  assert.equal(outcome.attempts[1]!.ok, true);
  // No same-provider retry of a rejected artifact.
  assert.equal(painted.calls(), 1);
  assert.equal(clean.calls(), 1);
});

test("checkerboard on every provider ends in the normal all-providers-failed path", async () => {
  const painted = await imageProvider(await checkerboardPng());

  await assert.rejects(
    driveWithRewriteFallback(
      {
        promptText: "a hero",
        allowedProviderIds: [painted.id],
        providerOrder: "allowlist",
        validateOutput: createPaintedCheckerboardGate(opaquePlugin, "task-exhausted"),
      },
      { maxRound: 3 },
    ),
    (err: unknown) => {
      assert.ok(err instanceof ImageGenError);
      // Not a rewrite trigger: the rewrite rounds are not entered.
      assert.equal(err.code, "all_providers_failed");
      assert.deepEqual(err.attempts.map(a => a.errorCode), ["painted_transparency_checkerboard"]);
      return true;
    },
  );
});

test("transparent assets (contain-alpha / transparent background) are never checked", async () => {
  assert.equal(pluginRequiresTransparentOutput(logoPlugin), true);
  assert.equal(
    pluginRequiresTransparentOutput({ ...opaquePlugin, imageDefaults: { background: "transparent" } }),
    true,
  );
  assert.equal(pluginRequiresTransparentOutput(opaquePlugin), false);
  const gate = createPaintedCheckerboardGate(logoPlugin, "task-logo");
  assert.equal(gate, undefined);

  const painted = await imageProvider(await checkerboardPng());
  const outcome = await driveWithRewriteFallback(
    {
      promptText: "a logo",
      allowedProviderIds: [painted.id],
      providerOrder: "allowlist",
      validateOutput: gate,
    },
    { maxRound: 0 },
  );
  assert.equal(outcome.providerId, painted.id);
  assert.equal(outcome.attempts[0]!.ok, true);
});

test("URL-only artifacts are downloaded for the check; download failure fails open", async () => {
  const png = await checkerboardPng();
  const gate = createPaintedCheckerboardGate(opaquePlugin, "task-url", async () =>
    new Response(png, { status: 200 }));
  assert.ok(gate);
  await assert.rejects(
    gate({ imageB64: "", imageUrl: "https://img.example.com/a.png", providerId: "p", providerName: "p" }),
    ImageOutputRejectedError,
  );

  const brokenGate = createPaintedCheckerboardGate(opaquePlugin, "task-url-broken", async () =>
    new Response("nope", { status: 502 }));
  assert.ok(brokenGate);
  await brokenGate({ imageB64: "", imageUrl: "https://img.example.com/a.png", providerId: "p", providerName: "p" });
});
