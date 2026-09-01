import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { StageQueue } from "../src/domain/plugin-async/stage-queue.js";
import { loadPluginConfigsFromDir } from "../src/plugins/loader.js";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

async function flushQueue(): Promise<void> {
  await new Promise<void>(resolve => setImmediate(resolve));
}

test("LLM waiters do not consume image slots and expansion releases immediately", async () => {
  const llmGates = Array.from({ length: 6 }, deferred);
  const imageGates = Array.from({ length: 6 }, deferred);
  const activeLlm = new Set<number>();
  const activeImages = new Set<number>();
  let maxLlm = 0;
  let maxImages = 0;
  const errors: unknown[] = [];

  const imageQueue = new StageQueue<number>({
    name: "test-image",
    maxConcurrent: 25,
    getGroup: () => "all",
    getGroupLimit: () => 25,
    run: async id => {
      activeImages.add(id);
      maxImages = Math.max(maxImages, activeImages.size);
      await imageGates[id]!.promise;
      activeImages.delete(id);
    },
    onError: error => errors.push(error),
  });

  const llmQueue = new StageQueue<number>({
    name: "test-llm",
    maxConcurrent: 25,
    getGroup: () => "art-director",
    getGroupLimit: () => 2,
    run: async id => {
      activeLlm.add(id);
      maxLlm = Math.max(maxLlm, activeLlm.size);
      await llmGates[id]!.promise;
      activeLlm.delete(id);
      imageQueue.enqueue(id);
    },
    onError: error => errors.push(error),
  });

  for (let id = 0; id < 6; id += 1) llmQueue.enqueue(id);
  assert.deepEqual(llmQueue.snapshot(), { active: 2, queued: 4 });
  assert.deepEqual(imageQueue.snapshot(), { active: 0, queued: 0 });

  llmGates[0]!.resolve();
  llmGates[1]!.resolve();
  await flushQueue();

  assert.deepEqual(llmQueue.snapshot(), { active: 2, queued: 2 });
  assert.deepEqual(imageQueue.snapshot(), { active: 2, queued: 0 });
  assert.deepEqual([...activeLlm].sort(), [2, 3]);
  assert.deepEqual([...activeImages].sort(), [0, 1]);

  llmGates[2]!.resolve();
  llmGates[3]!.resolve();
  await flushQueue();
  assert.equal(activeLlm.size, 2);
  assert.equal(activeImages.size, 4);

  llmGates[4]!.resolve();
  llmGates[5]!.resolve();
  await flushQueue();
  assert.equal(activeLlm.size, 0);
  assert.equal(activeImages.size, 6);
  assert.equal(maxLlm, 2);
  assert.equal(maxImages, 6);
  assert.deepEqual(errors, []);

  for (const gate of imageGates) gate.resolve();
  await flushQueue();
  assert.deepEqual(imageQueue.snapshot(), { active: 0, queued: 0 });
});

test("a saturated plugin group does not block eligible work from another group", async () => {
  const gates = new Map<string, ReturnType<typeof deferred>>();
  const started: string[] = [];
  const errors: unknown[] = [];
  const items = ["art-1", "art-2", "art-3", "other-1"];
  for (const item of items) gates.set(item, deferred());

  const queue = new StageQueue<string>({
    name: "test-groups",
    maxConcurrent: 3,
    getGroup: item => item.split("-")[0]!,
    getGroupLimit: item => item.startsWith("art-") ? 2 : 3,
    run: async item => {
      started.push(item);
      await gates.get(item)!.promise;
    },
    onError: error => errors.push(error),
  });

  for (const item of items) queue.enqueue(item);
  assert.deepEqual(started, ["art-1", "art-2", "other-1"]);
  assert.deepEqual(queue.snapshot(), { active: 3, queued: 1 });

  for (const gate of gates.values()) gate.resolve();
  await flushQueue();
  await flushQueue();
  assert.deepEqual(started, ["art-1", "art-2", "other-1", "art-3"]);
  assert.deepEqual(queue.snapshot(), { active: 0, queued: 0 });
  assert.deepEqual(errors, []);
});

test("plugin overlay accepts only bounded LLM expansion concurrency", () => {
  const dir = mkdtempSync(join(tmpdir(), "inkast-llm-concurrency-"));
  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    for (const [id, value] of [["valid", 2], ["zero", 0], ["large", 26], ["fraction", 1.5]] as const) {
      writeFileSync(
        join(dir, `${id}.json`),
        JSON.stringify({
          id,
          name: id,
          imageDefaults: {},
          llmExpansionConcurrency: value,
        }),
      );
    }
    const plugins = loadPluginConfigsFromDir(dir);
    assert.deepEqual(plugins.map(plugin => plugin.id), ["valid"]);
    assert.equal(plugins[0]?.llmExpansionConcurrency, 2);
  } finally {
    console.error = originalConsoleError;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("plugin overlay accepts only a short non-empty gallery label", () => {
  const dir = mkdtempSync(join(tmpdir(), "inkast-gallery-label-"));
  const originalConsoleError = console.error;
  console.error = () => undefined;
  try {
    for (const [id, galleryLabel] of [
      ["valid", "艺术指导"],
      ["empty", "   "],
      ["long", "x".repeat(25)],
    ] as const) {
      writeFileSync(
        join(dir, `${id}.json`),
        JSON.stringify({ id, name: id, imageDefaults: {}, galleryLabel }),
      );
    }
    const plugins = loadPluginConfigsFromDir(dir);
    assert.deepEqual(plugins.map(plugin => plugin.id), ["valid"]);
    assert.equal(plugins[0]?.galleryLabel, "艺术指导");
  } finally {
    console.error = originalConsoleError;
    rmSync(dir, { recursive: true, force: true });
  }
});
