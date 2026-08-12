import { completeJsonWithFallover } from "../../drivers/llm/with-fallover.js";
import type { CompleteJsonOptions, CompleteJsonResult } from "../../drivers/llm/types.js";

export const TEXT_MODERATION_TIMEOUT_MS = 20_000;

export const TEXT_MODERATION_DECISIONS = ["allow", "block", "review"] as const;
export const TEXT_MODERATION_CATEGORIES = [
  "none",
  "political_public_figure",
  "political_sensitive",
  "sexual_minor",
  "sexual",
  "violence",
  "illegal",
  "hate",
  "self_harm",
  "other",
] as const;

export type TextModerationDecision = (typeof TEXT_MODERATION_DECISIONS)[number];
export type TextModerationCategory = (typeof TEXT_MODERATION_CATEGORIES)[number];

export interface TextModerationResult {
  decision: TextModerationDecision;
  category: TextModerationCategory;
}

type CompleteJson = <T = unknown>(
  opts: CompleteJsonOptions,
  contextLabel?: string,
  postValidate?: (data: T) => string | null,
) => Promise<CompleteJsonResult<T>>;

const DECISION_SET = new Set<string>(TEXT_MODERATION_DECISIONS);
const CATEGORY_SET = new Set<string>(TEXT_MODERATION_CATEGORIES);

const TEXT_MODERATION_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["decision", "category"],
  properties: {
    decision: { type: "string", enum: [...TEXT_MODERATION_DECISIONS] },
    category: { type: "string", enum: [...TEXT_MODERATION_CATEGORIES] },
  },
};

const TEXT_MODERATION_SYSTEM_PROMPT = `你是面向中国大陆公开发布的 AI 图片生成服务的内容安全分类器。
只判断用户文本是否可以进入生图模型，不改写文本，不提供创作建议，也不要复述输入。

必须返回 block：
1. 要求描绘、变造、影射、模仿、恶搞、合成或冒充现实政治公众人物、现任或曾任国家领导人、公职人员的姓名、身份、肖像或可识别特征；
2. 政治宣传、政治讽刺、敏感政治事件、极端主义或煽动性政治内容；
3. 涉及未成年人色情、露骨色情、严重暴力、违法犯罪指导、仇恨煽动或明确自伤实施的生图请求。

存在代称、谐音、拆字、影射、上下文不足或无法可靠判断时返回 review；只有明确普通且安全的内容才返回 allow。
category 必须选择最主要的一类；allow 时 category 必须为 none，block/review 时 category 不能为 none。
只输出符合 schema 的 JSON，不要输出原因、思考过程或输入原文。`;

export function validateTextModerationResult(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "result must be an object";
  const record = value as Record<string, unknown>;
  if (!DECISION_SET.has(String(record.decision))) return "invalid decision";
  if (!CATEGORY_SET.has(String(record.category))) return "invalid category";
  if (record.decision === "allow" && record.category !== "none") return "allow must use none category";
  if (record.decision !== "allow" && record.category === "none") return "non-allow must name a category";
  return null;
}

/**
 * 独立语义审核：只在内存中把文本交给 LLM 池，不持久化、不回显、不写原文日志。
 * 调用方应把 block/review 都视为拒绝，把抛错视为技术故障并 fail-closed。
 */
export async function moderateText(
  text: string,
  signal?: AbortSignal,
  completeJson: CompleteJson = completeJsonWithFallover,
): Promise<TextModerationResult> {
  const result = await completeJson<TextModerationResult>(
    {
      systemPrompt: TEXT_MODERATION_SYSTEM_PROMPT,
      userPrompt: text,
      schema: TEXT_MODERATION_SCHEMA,
      timeoutMs: TEXT_MODERATION_TIMEOUT_MS,
      signal,
    },
    "plugin text moderation",
    validateTextModerationResult,
  );
  return result.data;
}
