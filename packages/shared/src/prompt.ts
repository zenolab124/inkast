/**
 * Structured JSON prompt schema. Derived from the imagegen methodology
 * (~/workspace/cc-skills/imagegen/reference/fields.md).
 *
 * Only `type / style / subject` are required — the rest are optional and
 * should be filled in based on the user's intent. The LLM driver is expected
 * to surface "ambiguity hints" pointing out which optional fields would
 * sharpen the prompt.
 */

export interface ImagePrompt {
  type: string;
  style: string;
  subject: string;
  background?: string;
  layout?: string;
  text_elements?: TextElement[];
  lighting?: string;
  mood?: string;
  camera?: string;
  color_palette?: string[];
  count?: number;
  [extra: string]: unknown;
}

export interface TextElement {
  content: string;
  position?: string;
  font?: string;
  color?: string;
  size?: string;
}

export interface AmbiguityHint {
  field: string;
  suggestion: string;
}

export interface PromptDraft {
  prompt: ImagePrompt;
  hints: AmbiguityHint[];
}
