/**
 * Post-review edit pass.
 *
 * Trigger: `pipeline_policy.post_review_edit=true` AND the successful image
 * came out of round 2 or round 3 (round 0/1 successes skip this — those
 * paths produce identity-preserving images already; degraded paths are the
 * ones that might come back looking nothing like the character).
 *
 * Flow:
 *   1. Look up character key from the original prompt prefix (plugin
 *      convention `{Key}. Style and theme: ...`)
 *   2. Build marvelsnap.pro reference URLs (same as rewrite module)
 *   3. Hand the LLM (vision-capable) those reference URLs + the freshly
 *      generated image as a data URL, ask "does this look like the target?"
 *   4. If yes → return original image
 *   5. If no → request an `image-edit`-shape generation: reference = the
 *      generated image, prompt = LLM's edit_instructions, requireMode=images
 *   6. If edit succeeds → return edited image
 *   7. If edit fails (safety reject / network / no eligible provider) →
 *      return original image (best-effort; we never make a successful task
 *      fail because of post-review)
 *
 * The edit_instructions LLM is told to use "把 X 改成 Y" phrasing so the
 * image edit model receives directives instead of complaints.
 */

import { LlmDriverError } from "../../drivers/llm/index.js";
import { completeJsonWithFallover } from "../../drivers/llm/with-fallover.js";
import { generateImage } from "../../drivers/image/openai-compatible.js";
import {
  ImageGenError,
  type ImageGenInput,
  type ImageGenOutcome,
} from "../../drivers/image/types.js";
import {
  buildCharacterImageUrls,
  extractCharacterKey,
} from "../rewrite-prompt/index.js";

const HEAD_TIMEOUT_MS = 5_000;
const REVIEW_LLM_TIMEOUT_MS = 60_000;

const REVIEW_SYSTEM_PROMPT = `你是一个图像质量审核员。任务:比对生成图跟用户期望的角色参考图,判断是否"看起来是同一个角色"。

【输入】
- 多张参考图(用户想要的角色形象,本体 + 变体)
- 1 张生成图(inkast 用 prompt 改写后实际产出的)

【判断标准】
- **像 (looks_like_target=true)**:生成图的主色组合 + 主体形态 + 共性视觉特征 都跟参考图能对得上(画风差异 / 姿态差异 / 构图差异不重要)
- **不像 (looks_like_target=false)**:主色组合差异大 / 主体形态完全脱节 / 关键共性元素缺失

【如果判定不像】
输出 edit_instructions,使用"**把 X 改成 Y**"这种直接的指令措辞 — 不要说"X 不对" / "X 错了":
- ❌ "服装颜色不对"
- ✅ "把服装主色调改成红和蓝双主色,补充白色作面部点缀"
- ❌ "缺少蜘蛛标志"
- ✅ "在胸前添加抽象几何徽记,贴合服装贴身感"
- ❌ "姿态不像"
- ✅ "把姿态改成空中翻跃,身体扭转,一臂前伸"

指令需要让 image edit 模型可以直接执行,描述完整目标状态(不只是 diff)。

【硬性禁令】
- 禁用任何 IP signature 字面词(蛛网 / 星形 / 反应堆 / 盾牌 / 锤子 / 利爪 / 蛛丝 等)
- 禁用专有名词、动物名、品牌词、超能力词

【输出 JSON】
{
  "looks_like_target": bool,
  "edit_instructions": "<把 X 改成 Y 的指令;像就留空字符串>"
}`;

const REVIEW_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["looks_like_target", "edit_instructions"],
  properties: {
    looks_like_target: { type: "boolean" },
    edit_instructions: { type: "string" },
  },
};

async function filterExistingUrls(urls: string[]): Promise<string[]> {
  const results = await Promise.all(
    urls.map(async url => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), HEAD_TIMEOUT_MS);
      try {
        const res = await fetch(url, { method: "HEAD", signal: controller.signal });
        return res.ok ? url : null;
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    }),
  );
  return results.filter((u): u is string => u !== null);
}

export interface PostReviewEditInput {
  /** Caller's original prompt (used to extract character key). */
  originalPromptText: string;
  /** Successfully generated image bytes (base64, PNG/JPEG). */
  currentImageB64: string;
  /** Mime type of currentImageB64 — passed through to the LLM as data URL. */
  currentImageMime: "image/png" | "image/jpeg" | "image/webp";
  /**
   * Image driver input scaffold used for the edit retry. Caller passes the
   * same shape it used for the original generation; we override
   * promptText / referenceImages / requireMode / excludeProviderIds for
   * the edit call.
   */
  imageInputBase: Omit<
    ImageGenInput,
    "promptText" | "referenceImages" | "requireMode" | "excludeProviderIds"
  >;
  signal?: AbortSignal;
}

export interface PostReviewEditOutcome {
  /** Final image bytes (base64) — either the input image or the edited one. */
  imageB64: string;
  /** LLM judgement; null if review was skipped (no character key). */
  looksLikeTarget: boolean | null;
  /** True iff edit ran and produced a new image. */
  editApplied: boolean;
  /** Driver outcome of the edit, when editApplied=true. */
  editDriverOutcome?: ImageGenOutcome;
  llmDurationMs: number;
  editDurationMs: number;
  editInstructions: string | null;
  /** Reason the edit was skipped or fell back; null on the happy path. */
  fallbackReason: string | null;
}

export async function reviewAndMaybeEdit(
  input: PostReviewEditInput,
): Promise<PostReviewEditOutcome> {
  const characterKey = extractCharacterKey(input.originalPromptText);
  if (!characterKey) {
    // No way to fetch reference images. Skip review entirely.
    console.log("[post-review] skipped — no character key extractable");
    return {
      imageB64: input.currentImageB64,
      looksLikeTarget: null,
      editApplied: false,
      llmDurationMs: 0,
      editDurationMs: 0,
      editInstructions: null,
      fallbackReason: "no character key",
    };
  }

  const candidateUrls = buildCharacterImageUrls(characterKey);
  const referenceUrls = await filterExistingUrls(candidateUrls);
  console.log(
    `[post-review] key=${characterKey} reference URLs ${referenceUrls.length}/${candidateUrls.length}`,
  );
  if (referenceUrls.length === 0) {
    console.log("[post-review] skipped — no reference URLs survived HEAD");
    return {
      imageB64: input.currentImageB64,
      looksLikeTarget: null,
      editApplied: false,
      llmDurationMs: 0,
      editDurationMs: 0,
      editInstructions: null,
      fallbackReason: "no reference images available",
    };
  }

  // Vision LLM review: ref URLs + the current generated image as a data URL.
  const currentImageDataUrl = `data:${input.currentImageMime};base64,${input.currentImageB64}`;

  const llmStarted = Date.now();
  let reviewResult: { looks_like_target: boolean; edit_instructions: string };
  try {
    const result = await completeJsonWithFallover<{
      looks_like_target: boolean;
      edit_instructions: string;
    }>(
      {
        systemPrompt: REVIEW_SYSTEM_PROMPT,
        userPrompt:
          "下面给你的是参考图和生成图。请按 system prompt 判断生成图是否与参考图为同一角色。",
        schema: REVIEW_OUTPUT_SCHEMA,
        images: [
          ...referenceUrls.map(url => ({ url })),
          { url: currentImageDataUrl },
        ],
        timeoutMs: REVIEW_LLM_TIMEOUT_MS,
        signal: input.signal,
      },
      "post-review",
    );
    reviewResult = result.data;
    console.log(
      `[post-review]   ✓ LLM judged in ${Date.now() - llmStarted}ms · looks_like_target=${reviewResult.looks_like_target} · instructions=${reviewResult.edit_instructions.length}B`,
    );
  } catch (err) {
    const msg = err instanceof LlmDriverError ? err.message : String(err);
    console.warn(
      `[post-review]   ✗ review LLM failed in ${Date.now() - llmStarted}ms — falling back to original image: ${msg}`,
    );
    return {
      imageB64: input.currentImageB64,
      looksLikeTarget: null,
      editApplied: false,
      llmDurationMs: Date.now() - llmStarted,
      editDurationMs: 0,
      editInstructions: null,
      fallbackReason: `review LLM failed: ${msg}`,
    };
  }
  const llmDurationMs = Date.now() - llmStarted;

  if (reviewResult.looks_like_target) {
    return {
      imageB64: input.currentImageB64,
      looksLikeTarget: true,
      editApplied: false,
      llmDurationMs,
      editDurationMs: 0,
      editInstructions: null,
      fallbackReason: null,
    };
  }

  // Not like target → try one round of image edit. Force images-mode (only
  // mode that supports single-reference edit through SDK images.edit).
  const editInstructions = reviewResult.edit_instructions.trim();
  if (!editInstructions) {
    console.warn("[post-review]   ✗ LLM judged not-like but gave empty instructions — keeping original");
    return {
      imageB64: input.currentImageB64,
      looksLikeTarget: false,
      editApplied: false,
      llmDurationMs,
      editDurationMs: 0,
      editInstructions: null,
      fallbackReason: "edit_instructions empty",
    };
  }

  const filename = input.currentImageMime === "image/png" ? "current.png" : "current.jpg";
  const editStarted = Date.now();
  try {
    const editOutcome = await generateImage({
      ...input.imageInputBase,
      promptText: editInstructions,
      referenceImages: [
        {
          buffer: Buffer.from(input.currentImageB64, "base64"),
          mimeType: input.currentImageMime,
          filename,
        },
      ],
      requireMode: "images",
      signal: input.signal,
    });
    const editDurationMs = Date.now() - editStarted;
    console.log(
      `[post-review]   ✓ edit succeeded via ${editOutcome.providerName} in ${editDurationMs}ms`,
    );
    return {
      imageB64: editOutcome.imageB64,
      looksLikeTarget: false,
      editApplied: true,
      editDriverOutcome: editOutcome,
      llmDurationMs,
      editDurationMs,
      editInstructions,
      fallbackReason: null,
    };
  } catch (err) {
    const editDurationMs = Date.now() - editStarted;
    const msg = err instanceof ImageGenError ? err.message : String(err);
    console.warn(
      `[post-review]   ✗ edit failed in ${editDurationMs}ms — falling back to original image: ${msg}`,
    );
    return {
      imageB64: input.currentImageB64,
      looksLikeTarget: false,
      editApplied: false,
      llmDurationMs,
      editDurationMs,
      editInstructions,
      fallbackReason: `edit failed: ${msg}`,
    };
  }
}
