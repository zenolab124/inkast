/** Operator-owned extension. Existing-image callers retain the configured schema. */
export function adaptivePlanSchema(plan: Record<string, unknown>): Record<string, unknown> {
  const properties = {
    plan, fitness: { type: "number", minimum: 0, maximum: 1 },
    intent: { type: "string", enum: ["natural", "expressive", "bold"] },
    reason: { type: "string" },
    repair: { type: "object", additionalProperties: false, properties: {
      part: { type: "string" }, material: { type: "string", enum: ["solid", "energy"] },
    }, required: ["part", "material"] },
  };
  return { type: "object", additionalProperties: false, properties: {
    candidates: { type: "array", minItems: 2, maxItems: 3, items: {
      type: "object", additionalProperties: false, properties, required: Object.keys(properties),
    } },
  }, required: ["candidates"] };
}
export const ADAPTIVE_PROMPT = `
新图自适应构图 v1：本次返回 candidates，2 至 3 份有实质取景区别、各自可以交付的方案，不是重复三次相同计划。
先判断姿态、视线、手势、持物、衣物动势、主要实体轮廓及源截断，再决定适合的强度。每份给 fitness(0..1，内容适合度)，intent(natural/expressive/bold)，reason(具体构图依据)。不要固定选最保守或伸出像素最多的一份。安静胸像可自然；前倾、强手势、持物及动态轮廓可明显或大胆。画面至少有一个完整、清晰可辨的实体突破框的外沿，不得仅光效或覆盖框带就声称大胆。头和手可以同时出框，不自动避开费用与战力。保持主体辨识和原生高清。
所有候选保持边框、角标、1024方形交付坐标与底部闭合。完整实体跨越左右框带时在框前；源截断处必须仍被框遮住，不能以羽化实体来伪装完整。protectedRegions只保护完整头脸/手，不能把可修补袖口全部保护。
若更有表现力的构图被单个真实源截断衣袖、衣角、道具末端限制，可在 repair.part 写明这个小部件，repair.material 指 solid 或 energy；无需补画时 part 为空字符串。程序会独立检测源截面并选择很小的区域，仅有一张局部补丁预算；不要请求重画头脸、整个人、背景或边框，也不要为启用补画故意制造裁切。局部补画失败时仍可用另一份完整可交付方案。不要请求分割，segmentationRepairs必须为空。
以上候选要求覆盖前文默认小幅出框的倾向；尺寸、遮挡、Alpha和完整轮廓硬约束继续有效。`;
