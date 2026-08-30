export const IMAGE_CLEANLINESS_INSTRUCTION =
  "在不改变主题、构图、风格和用户要求的前提下，保持画面干净通透、细节克制。以平滑自然的明暗和色彩过渡塑造体积，轮廓清楚但边缘柔和，高光连续不过曝。保留真实材质与风格所需纹理，避免非题材需要的鳞片状重复纹理、随机斑点、脏灰和锐化光晕；不以假细节或过度锐化制造质感，避免塑料感与过度磨皮。";

export function appendImageCleanlinessInstruction(promptText: string): string {
  let basePrompt = promptText.trimEnd();
  while (basePrompt.endsWith(IMAGE_CLEANLINESS_INSTRUCTION)) {
    basePrompt = basePrompt
      .slice(0, -IMAGE_CLEANLINESS_INSTRUCTION.length)
      .trimEnd();
  }
  return basePrompt
    ? `${basePrompt}\n\n${IMAGE_CLEANLINESS_INSTRUCTION}`
    : IMAGE_CLEANLINESS_INSTRUCTION;
}
