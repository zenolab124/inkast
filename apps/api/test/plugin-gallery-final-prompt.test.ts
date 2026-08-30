import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "inkast-plugin-gallery-prompt-"));
process.env.INKAST_DATA_DIR = dataDir;

const { listPluginGallery } = await import("../src/storage/plugin-gallery.js");
const {
  createPluginTask,
  getPluginTask,
  markTaskSucceeded,
} = await import("../src/storage/plugin-tasks.js");

after(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

test("plugin gallery archives the exact prompt sent to the successful provider", () => {
  const task = createPluginTask({
    pluginId: "test-plugin",
    prompt: "原始提示词",
    callbackUrl: "https://example.com/callback",
    callbackToken: "test-token",
  });

  markTaskSucceeded(task.id, {
    kind: "r2",
    imageUrl: "https://example.com/image.webp",
    mime: "image/webp",
    promptJson: "{}",
    finalPromptText: "重写后的提示词\n\n统一画面清洁度尾词",
    llmDurationMs: 12,
    imageDurationMs: 34,
    providerId: "provider-id",
    providerName: "Provider",
    attempts: [],
    rewrittenPrompts: ["重写后的提示词"],
    successRound: 1,
    postReviewEdited: false,
  });

  assert.equal(
    getPluginTask(task.id)?.finalPromptText,
    "重写后的提示词\n\n统一画面清洁度尾词",
  );
  const gallery = listPluginGallery({ limit: 10 });
  assert.equal(gallery.items.length, 1);
  assert.equal(
    gallery.items[0]?.finalPromptText,
    "重写后的提示词\n\n统一画面清洁度尾词",
  );
});
