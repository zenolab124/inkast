import assert from "node:assert/strict";
import test from "node:test";

import {
  IMAGE_CLEANLINESS_INSTRUCTION,
  appendImageCleanlinessInstruction,
} from "../src/drivers/image/prompt-cleanliness.js";
import { buildOpenAIImagePrompt } from "../src/drivers/image/openai-compatible.js";
import { wrapPromptForImageGen } from "../src/drivers/image/openai-responses.js";

test("cleanliness instruction is the final prompt block and remains idempotent", () => {
  const first = appendImageCleanlinessInstruction(
    "纸雕风格的橘猫   ",
    ["Target aspect ratio: 3:4."],
  );
  assert.equal(
    first,
    `纸雕风格的橘猫\n\nTarget aspect ratio: 3:4.\n\n${IMAGE_CLEANLINESS_INSTRUCTION}`,
  );

  const retried = appendImageCleanlinessInstruction(first);
  assert.equal(retried, first);
  assert.equal(retried.split(IMAGE_CLEANLINESS_INSTRUCTION).length - 1, 1);
});

test("images generate and edit share a prompt ending in the cleanliness instruction", () => {
  const prompt = buildOpenAIImagePrompt({
    promptText: "纸雕风格的橘猫",
    size: "ratio:3:4",
  });

  assert.equal(
    prompt,
    `纸雕风格的橘猫\n\nTarget aspect ratio: 3:4.\n\n${IMAGE_CLEANLINESS_INSTRUCTION}`,
  );
});

test("responses mode keeps its tool hints before the final cleanliness instruction", () => {
  const prompt = wrapPromptForImageGen({
    promptText: "纸雕风格的橘猫",
    size: "ratio:3:4",
    quality: "high",
    n: 2,
  });

  assert.match(prompt, /Target aspect ratio: 3:4\./);
  assert.match(prompt, /Target quality: high\./);
  assert.match(prompt, /Generate 2 images\./);
  assert.equal(prompt.endsWith(IMAGE_CLEANLINESS_INSTRUCTION), true);
});
