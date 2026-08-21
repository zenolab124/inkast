import assert from "node:assert/strict";
import test from "node:test";

import { parseRequestedRatio } from "../src/server/routes/plugins.js";

test("plugin request ratios keep presets and normalize bounded custom values", () => {
  assert.equal(parseRequestedRatio("16:9", false), "16:9");
  assert.equal(parseRequestedRatio("12:8", true), "3:2");
  assert.equal(parseRequestedRatio("32:11", true), "32:11");
  assert.equal(parseRequestedRatio("4:3", false), "4:3");
});

test("plugin request ratios reject unsupported or extreme custom values", () => {
  assert.equal(parseRequestedRatio("5:4", false), "invalid");
  assert.equal(parseRequestedRatio("33:10", true), "invalid");
  assert.equal(parseRequestedRatio("1:4", true), "invalid");
  assert.equal(parseRequestedRatio("0:1", true), "invalid");
  assert.equal(parseRequestedRatio("freeform", true), "invalid");
});
