import assert from "node:assert/strict";
import test from "node:test";

import {
  moderateText,
  validateTextModerationResult,
} from "../src/domain/text-moderation/index.js";
import type { CompleteJsonOptions, CompleteJsonResult } from "../src/drivers/llm/types.js";

function result<T>(data: T): CompleteJsonResult<T> {
  return { data, raw: JSON.stringify(data), backend: "openai-compatible", durationMs: 1 };
}

test("text moderation accepts only internally consistent structured decisions", () => {
  assert.equal(validateTextModerationResult({ decision: "allow", category: "none" }), null);
  assert.equal(validateTextModerationResult({ decision: "block", category: "political_public_figure" }), null);
  assert.equal(validateTextModerationResult({ decision: "review", category: "political_sensitive" }), null);
  assert.equal(validateTextModerationResult({ block: false, category: "none" }), null);
  assert.equal(validateTextModerationResult({ blocked: true, category: "political_sensitive" }), null);
  assert.match(validateTextModerationResult({ decision: "allow", category: "political_sensitive" }) ?? "", /invalid/);
  assert.match(validateTextModerationResult({ decision: "block", category: "none" }) ?? "", /invalid/);
  assert.match(validateTextModerationResult({ decision: "maybe", category: "none" }) ?? "", /invalid/);
});

test("text moderation forwards only the prompt and returns the classifier decision", async () => {
  let seen: CompleteJsonOptions | undefined;
  const fakeComplete = async <T>(opts: CompleteJsonOptions): Promise<CompleteJsonResult<T>> => {
    seen = opts;
    return result({ block: true, category: "political_public_figure" } as T);
  };
  const decision = await moderateText("测试输入", undefined, fakeComplete);
  assert.deepEqual(decision, { decision: "block", category: "political_public_figure" });
  assert.equal(seen?.userPrompt, "测试输入");
  assert.equal(seen?.images, undefined);
  assert.ok(seen?.schema);
});

test("text moderation propagates classifier outages for caller fail-closed handling", async () => {
  const unavailable = async <T>(): Promise<CompleteJsonResult<T>> => {
    throw new Error("backend unavailable");
  };
  await assert.rejects(() => moderateText("普通风景", undefined, unavailable), /backend unavailable/);
});
