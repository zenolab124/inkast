export const IMAGE_CLEANLINESS_INSTRUCTION =
  "在不改变上述主题、构图、风格、媒介、氛围和用户明确要求的前提下，使画面整体干净、通透、自然，细节清楚但不过度锐化。不要添加多余的假纹理假细节。保留该风格有意使用的纹理和物体本身应有的真实材质，只抑制非预期的视觉噪声与脏感。避免颗粒、噪点、灰尘、污渍、斑驳、脏灰色块、浑浊阴影、灰雾、泛黄、颜色污染、随机纹理覆盖、锯齿、边缘白边或黑边、锐化光晕、过强局部对比、夸张微细节和过度锐化。保持色彩清晰、明暗过渡平滑、边缘自然、表面整洁，呈现克制、协调且完成度高的画面，避免塑料感和过度磨皮。";

/**
 * Keep the cleanliness instruction as the final block sent to every image
 * engine. Callers may add engine-specific hints immediately before it.
 * Existing trailing copies are removed so retries remain idempotent.
 */
export function appendImageCleanlinessInstruction(
  promptText: string,
  precedingHints: readonly string[] = [],
): string {
  let basePrompt = promptText.trimEnd();
  while (basePrompt.endsWith(IMAGE_CLEANLINESS_INSTRUCTION)) {
    basePrompt = basePrompt
      .slice(0, -IMAGE_CLEANLINESS_INSTRUCTION.length)
      .trimEnd();
  }

  return [
    basePrompt,
    ...precedingHints.map(hint => hint.trim()).filter(Boolean),
    IMAGE_CLEANLINESS_INSTRUCTION,
  ].filter(Boolean).join("\n\n");
}
