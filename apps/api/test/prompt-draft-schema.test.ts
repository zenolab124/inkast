import assert from "node:assert/strict";
import test from "node:test";

import { normalizePromptDraft } from "../src/domain/prompt-engine/index.js";
import { PROMPT_DRAFT_SCHEMA } from "../src/drivers/llm/prompt-draft-schema.js";

test("default prompt schema recursively closes every object for strict structured output", () => {
  assertStrictObjectSchemas(PROMPT_DRAFT_SCHEMA, "root");

  const root = PROMPT_DRAFT_SCHEMA as {
    properties: { prompt: { properties: Record<string, unknown>; required: string[] } };
  };
  const prompt = root.properties.prompt;
  assert.deepEqual(new Set(prompt.required), new Set(Object.keys(prompt.properties)));
  assert.ok(prompt.required.includes("environment_effects"));
  assert.ok(prompt.required.includes("negative_constraints"));
});

test("prompt normalization strips null and undeclared model fields before persistence", () => {
  const draft = normalizePromptDraft({
    prompt: {
      type: "character illustration",
      style: "cinematic comic art",
      subject: "Storm summoning lightning above a ruined city",
      background: "storm clouds and distant towers",
      layout: null,
      text_elements: [
        {
          content: "ignored empty optional metadata",
          position: null,
          font: null,
          color: null,
          size: null,
        },
      ],
      lighting: "hard blue-white lightning from above",
      mood: "majestic and dangerous",
      camera: "low-angle medium-wide shot",
      color_palette: ["#18243A", "#DCEBFF"],
      count: null,
      environment_effects: "rain, wind and airborne debris",
      negative_constraints: "no text, no card frame",
      invented_field: "must not escape",
    },
    hints: [],
    invented_root: true,
  });

  assert.deepEqual(draft, {
    prompt: {
      type: "character illustration",
      style: "cinematic comic art",
      subject: "Storm summoning lightning above a ruined city",
      background: "storm clouds and distant towers",
      lighting: "hard blue-white lightning from above",
      mood: "majestic and dangerous",
      camera: "low-angle medium-wide shot",
      color_palette: ["#18243A", "#DCEBFF"],
      environment_effects: "rain, wind and airborne debris",
      negative_constraints: "no text, no card frame",
      text_elements: [{ content: "ignored empty optional metadata" }],
    },
    hints: [],
  });
});

test("prompt normalization rejects nested subjects from schema-ignoring proxies", () => {
  assert.throws(
    () => normalizePromptDraft({
      prompt: {
        type: "portrait",
        style: "comic",
        subject: { description: "nested legacy shape" },
      },
      hints: [],
    }),
    /type \/ style \/ subject/,
  );
});

function assertStrictObjectSchemas(value: unknown, path: string): void {
  if (!isRecord(value)) return;

  if (value.type === "object") {
    assert.equal(value.additionalProperties, false, `${path} must reject extra properties`);
    assert.ok(isRecord(value.properties), `${path} must declare properties`);
    assert.ok(Array.isArray(value.required), `${path} must declare required fields`);
    assert.deepEqual(
      new Set(value.required as string[]),
      new Set(Object.keys(value.properties as Record<string, unknown>)),
      `${path} must require every declared property`,
    );
  }

  if (isRecord(value.properties)) {
    for (const [key, child] of Object.entries(value.properties)) {
      assertStrictObjectSchemas(child, `${path}.properties.${key}`);
    }
  }
  if (isRecord(value.items)) {
    assertStrictObjectSchemas(value.items, `${path}.items`);
  }
  if (Array.isArray(value.anyOf)) {
    value.anyOf.forEach((child, index) => {
      assertStrictObjectSchemas(child, `${path}.anyOf[${index}]`);
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
