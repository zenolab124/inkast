import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { passthroughGenerate } from "../src/drivers/passthrough-image.js";
import { IMAGE_CLEANLINESS_INSTRUCTION } from "../src/drivers/prompt-cleanliness.js";

test("public passthrough appends the cleanliness instruction to the upstream prompt", async () => {
  let receivedPrompt = "";
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", chunk => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { prompt?: string };
      receivedPrompt = body.prompt ?? "";
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [{ b64_json: "aW1hZ2U=" }] }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));

  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const result = await passthroughGenerate({
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      apiKey: "test-key",
      model: "gpt-image-2",
      prompt: "纸雕风格的橘猫",
    });

    assert.deepEqual(result.b64Images, ["aW1hZ2U="]);
    assert.equal(result.finalPromptText, receivedPrompt);
    assert.equal(receivedPrompt.endsWith(IMAGE_CLEANLINESS_INSTRUCTION), true);
    assert.equal(receivedPrompt.split(IMAGE_CLEANLINESS_INSTRUCTION).length - 1, 1);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
});
