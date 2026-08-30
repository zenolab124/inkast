import assert from "node:assert/strict";
import test from "node:test";

import {
  IMAGE_CLEANLINESS_INSTRUCTION,
  appendImageCleanlinessInstruction,
} from "../src/drivers/image/prompt-cleanliness.js";
import { buildOpenAIImagePrompt } from "../src/drivers/image/openai-compatible.js";
import { wrapPromptForImageGen } from "../src/drivers/image/openai-responses.js";

test("cleanliness instruction stays concise and targets accidental scale-like texture", () => {
  assert.equal(
    IMAGE_CLEANLINESS_INSTRUCTION,
    "在不改变主题、构图、风格和用户要求的前提下，保持画面干净通透、细节克制。以平滑自然的明暗和色彩过渡塑造体积，轮廓清楚但边缘柔和，高光连续不过曝。保留真实材质与风格所需纹理，避免非题材需要的鳞片状重复纹理、随机斑点、脏灰和锐化光晕；不以假细节或过度锐化制造质感，避免塑料感与过度磨皮。",
  );
});

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
