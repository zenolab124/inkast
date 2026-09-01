/**
 * Canonical structured-output contract for prose → image prompt expansion.
 *
 * OpenAI strict structured outputs require every object schema to be closed
 * (`additionalProperties: false`) and every declared property to be listed in
 * `required`. Optional prompt fields therefore travel as `null`; the prompt
 * engine removes those nulls before returning an ImagePrompt to callers.
 *
 * Keep this as the single source for both LLM drivers. The application may
 * still read historical/manual prompts with extra keys, but model-generated
 * drafts are intentionally limited to this stable field vocabulary.
 */

const NULLABLE_STRING_SCHEMA = {
  anyOf: [{ type: "string" }, { type: "null" }],
} as const;

const TEXT_ELEMENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["content", "position", "font", "color", "size"],
  properties: {
    content: { type: "string" },
    position: NULLABLE_STRING_SCHEMA,
    font: NULLABLE_STRING_SCHEMA,
    color: NULLABLE_STRING_SCHEMA,
    size: NULLABLE_STRING_SCHEMA,
  },
} as const;

export const PROMPT_DRAFT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["prompt", "hints"],
  properties: {
    prompt: {
      type: "object",
      additionalProperties: false,
      required: [
        "type",
        "style",
        "subject",
        "background",
        "layout",
        "text_elements",
        "lighting",
        "mood",
        "camera",
        "color_palette",
        "count",
        "environment_effects",
        "negative_constraints",
      ],
      properties: {
        type: { type: "string" },
        style: { type: "string" },
        subject: { type: "string" },
        background: NULLABLE_STRING_SCHEMA,
        layout: NULLABLE_STRING_SCHEMA,
        text_elements: {
          anyOf: [
            { type: "array", items: TEXT_ELEMENT_SCHEMA },
            { type: "null" },
          ],
        },
        lighting: NULLABLE_STRING_SCHEMA,
        mood: NULLABLE_STRING_SCHEMA,
        camera: NULLABLE_STRING_SCHEMA,
        color_palette: {
          anyOf: [
            { type: "array", items: { type: "string" } },
            { type: "null" },
          ],
        },
        count: {
          anyOf: [
            { type: "integer", minimum: 1 },
            { type: "null" },
          ],
        },
        environment_effects: NULLABLE_STRING_SCHEMA,
        negative_constraints: NULLABLE_STRING_SCHEMA,
      },
    },
    hints: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["field", "suggestion"],
        properties: {
          field: { type: "string" },
          suggestion: { type: "string" },
        },
      },
    },
  },
};
