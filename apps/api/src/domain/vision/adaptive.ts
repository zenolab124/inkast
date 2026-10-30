const balancePoint = { type: "array", minItems: 2, maxItems: 2, items: { type: "number", minimum: 0, maximum: 1 } };
export const balanceSchema = { type: "object", additionalProperties: false, properties: {
  subjectAnchor: balancePoint,
  backgroundAnchor: { anyOf: [balancePoint, { type: "array", maxItems: 0, items: { type: "number" } }] },
  mode: { type: "string", enum: ["centered", "counterweight", "intentional-space", "unbalanced"] },
  score: { type: "number", minimum: 0, maximum: 1 },
  counterweight: { type: "string", maxLength: 600 }, reason: { type: "string", minLength: 2, maxLength: 900 },
}, required: ["subjectAnchor", "backgroundAnchor", "mode", "score", "counterweight", "reason"] };
export const BALANCED_COMPOSITION_PROMPT = `
本轮以整张卡牌的视觉平衡为主要构图目标。先考虑人物主体、背景、明暗色块、视线及动作动线的整体关系，再决定完整部位如何出框；不能为了让某个部位越框而强行把整个人物推到一侧。不要统一居中，也不要为凑不居中而偏置。主体小幅偏左或偏右属于自然构图，不需要每次寻找额外背景物来证明；只有明显偏置才需要具体的背景或动线承接。重心稳定与清晰出框同时成立才是目标，不能靠一味缩小、收回框内取得高分。至少一份候选探索在自然重心附近适度放大、允许轻微左右偏移的清晰出框方案；按素材可尝试相对自然适配放大约3%至8%，这只是探索幅度，不是统一zoom或必须放大。保留完整头手、原有重要躯干与持物，底部自然回框，不能为放大裁掉内容；其他候选依据实际画面自由选择。
protectedRegions使用DESIGN坐标，以宽松、简单的闭合四至六边形包住完整头部及发顶，不沿发丝描半圈。头部source锚点须先按本候选的缩放/平移/旋转投到DESIGN，再确认落在保护区内部；单独画了发顶边线或把源图坐标抄成保护区坐标均不合格。不要为了节省多边形点数漏掉脸或下颌。
每份plan返回compositionBalance：subjectAnchor指向原始前景胸腹/主体核心实心内部，不选头发、手、飘带或边缘；backgroundAnchor以原始背景宽高归一，指向最终实际可见的环境次重点，不能填人物、被遮住区域、框/角标或交付外。没有次重点填[]。mode=centered表示主体核心较靠近卡窗中心；counterweight表示偏置由另一侧实际可见的环境结构、光源或明暗色块呼应；intentional-space表示视线/运动方向有意留空，须解释为什么这片留白有效；unbalanced如实表示重心偏、对侧无承接。counterweight和reason说明可核对的具体画面，不能只说背景漂亮或有风景。score仅评价前后景联合后的重心、叙事和留白质量，不把出框面积当平衡分。全部候选失衡时降低分数，不通过编造背景重点制造合格理由。
extraction.sceneLayout（若有）是背景生成前冻结的联合布局：背景按它组织环境。优先保留预定人物落点及其与背景重点的关系；几何检查需要调整时适度修订并重新核对实际背景，不能把人物反向挪走后仍沿用旧的平衡理由。用户重新构图的明确要求优先，但如实评价其效果。不能重画原前景/背景、移动固定框角标或破坏完整性；背景保留当前cover取景，不凭空平移导致露底。
`;
/** Operator-owned extension. Existing-image callers retain the configured schema. */
export function adaptivePlanSchema(plan: Record<string, unknown>, recomposition = false, balanced = false): Record<string, unknown> {
  const materialRegions = { type: "array", maxItems: 24, items: { type: "object", additionalProperties: false, properties: {
    name: { type: "string" }, kind: { type: "string", enum: ["body", "rigid", "clothing", "gauze", "energy"] },
    polygon: { type: "array", minItems: 3, maxItems: 16, items: { type: "array", minItems: 2, maxItems: 2, items: { type: "number", minimum: 0, maximum: 1 } } },
  }, required: ["name", "kind", "polygon"] } };
  const properties = {
    plan: { ...plan, properties: { ...(plan.properties as object || {}), materialRegions, ...(balanced ? { compositionBalance: balanceSchema } : {}) }, required: [...new Set([...(plan.required as string[] || []), "materialRegions", ...(balanced ? ["compositionBalance"] : [])])] }, fitness: { type: "number", minimum: 0, maximum: 1 },
    intent: { type: "string", enum: ["natural", "expressive", "bold"] },
    reason: { type: "string" },
    repair: { type: "object", additionalProperties: false, properties: {
      part: { type: "string" }, material: { type: "string", enum: ["solid", "energy"] },
    }, required: ["part", "material"] },
  };
  const requirements = { type: "object", additionalProperties: false, properties: {
    horizontal: { type: "string", enum: ["none", "left", "right"] },
    vertical: { type: "string", enum: ["none", "up", "down"] },
    breakouts: { type: "array", maxItems: 4, items: { type: "object", additionalProperties: false, properties: {
      name: { type: "string" }, box: { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4 },
      side: { type: "string", enum: ["left", "right", "top"] },
    }, required: ["name", "box", "side"] } },
  }, required: ["horizontal", "vertical", "breakouts"] };
  return { type: "object", additionalProperties: false, properties: {
    ...(recomposition ? { requirements } : {}),
    candidates: { type: "array", minItems: 2, maxItems: 3, items: {
      type: "object", additionalProperties: false, properties, required: Object.keys(properties),
    } },
  }, required: recomposition ? ["requirements", "candidates"] : ["candidates"] };
}
/** Native layers need geometry and preservation rules, not legacy art-direction defaults. */
export const NATIVE_COMPOSITION_PROMPT = `你是3D卡牌图层构图分析器。只分析附图并按schema返回JSON，不调用工具。人物、动作、表情、服饰、镜头、画风、光影和配色以原始素材及用户明确要求为准；不添加系统默认的姿势、取景、方向、几何轮廓模板或审美处理，不修改源图内容。附加卡牌参考只说明固定框、角标和遮挡关系，不借用参考人物的姿势、取景、画风或出框方向。
输入为独立透明前景和背景，前景的真实宽高、来源及布局见extraction；没有分割步骤，segmentationRepairs必须为空。源坐标按对应前景宽高归一，subjectParts.anchor指向实际可见部件的实心内部，不捏造画外部件或完整性。核对头部、手、持物与其他重要轮廓，protectedRegions保护完整头部和手，不能覆盖真实截断端。整颗头含发顶、两侧及下颌必须可见，可留框内或出框。
1280工作画布中的原生框固定在(128,128)，中央(128,128,1024,1024)为最终透明方形成品。所有DESIGN归一坐标均相对该1024方形，不含padding。框及角标位置尺寸不得改变。原生框外沿约x=.182..835、y=.055..938，内窗约x=.219..783、底y=.891；最终实际可见前景须落在DESIGN[0,1]内。zoom、centerX/Y、rotationDeg使用schema及程序允许范围，按实际素材选择，不默认居中、放大、缩小、偏向某侧或采用固定强度。独立图层变换按下方真实布局说明执行，不为背景覆盖放大前景。
regions只选择出框的连通前景交叉段，不是裁刀；同一完整部件跨框处必须连续，不能在框外横切再出现。保留原素材实际可见内容和部件关系，不能靠丢掉原有躯干、手或持物制造出框。至少有一个清晰实体突破外沿，具体部位和强度由素材及用户要求决定，不因角色或姿态套用固定风格。底部y>=.891上层关闭，下部向外延伸的分支必须在关闭前沿自然轮廓回到实际框带后。
cutTransitions只针对真实截断末端或连续返回框内的局部收口，不得在完整部件中间制造矩形擦除带。polygon为局部DESIGN区域，width为4..96设计像素；source-left/right/top/bottom依据真实源边界，from/to/keep填[]；design-line以from/to定义处理线、keep定义保留侧。处理区须连接真实末端或框遮挡，不能在区域外重新放出被切断分支。原始实体保持实心；身体与硬物不能靠渐隐冒充完整，真实截面须补齐或由实框覆盖。柔软衣料、轻纱、能量按materialRegions仅允许真实末端自然渐隐，不能在中间挖断或整件透明。
源图边缘少量抗锯齿触边不等于实际裁切，不按固定留白或指定身体取景范围拒绝素材。实际缺失须如实标注，完整轮廓不能为迁就错误许可而收回。规划质量与合成缺陷分开判断；需要修复时保留可取的构图意图，提供准确的局部诊断。title、rationale、部件名称和原因使用中文。`;
export const ADAPTIVE_PROMPT = `
新图自适应构图 v2：本次返回 candidates，2 至 3 份有实质取景区别、各自可以交付的方案，不是重复三次相同计划。
单人物头部完整是硬约束：头可以留在框内，不强制头部出框，但必须保留完整发顶、头部两侧、五官和下颌轮廓。边框、费用/战力角标、许可边界和交付边界均不得切掉这些实体；脸部中心可见不代表头完整。subjectParts必须单列头部，准确标记原始完整性，并用protectedRegions包住整颗可见头部及发顶轮廓，不能只保护脸中央；不得为保留inside标签而把框盖在头发或额头上。原前景头部确实已截断时如实标source-cropped，该候选不能交付，不能藏到框后假装完整；此要求优先于一般衣料源截断端可以框后遮挡的规则。
忠实保留原前景已有的取景范围、重要内容与动作关系。为实际可见的躯干部件分别列出kind=body、segmentation=complete的内部anchor，位置指向真实实体而非源截口；不得将完整部件标成source-cropped来绕过保留。不要扩写源图没有提供的身体部位，也不得借切掉已有躯干来夸大出框。
各份方案依据实际素材选择位置、缩放、旋转及出框部位，不预设居中、左右偏置、固定缩放起点或镜头远近；方案之间须有可解释的构图差异，不用单纯放大或微抖动凑数。比例与位置仅在不丢失重要可见内容和轮廓的前提下调整。
结合姿态、视线、手势、持物、衣物动势、主要实体轮廓及源截断独立判断各方案。每份给 fitness(0..1，内容适合度)，intent(natural/expressive/bold)，reason(具体构图依据)；intent只是结果标签，不是由姿态或角色类别决定的模板，不默认偏好任何强度或方向。画面至少有一个完整、清晰可辨的实体突破框的外沿，不得仅光效或覆盖框带就声称大胆。头和手可以同时出框，不自动避开费用与战力。保持主体辨识和原生高清。
所有候选保持边框、角标、1024方形交付坐标与底部闭合。完整实体跨越左右框带时在框前；源截断处必须被框遮住，或为单个可控小缺口明确请求局部补画，补画通过后才可出框。不能以羽化实体来伪装完整。cutTransitions不能在无遮框的框外横切或淡化手臂等身体与硬物；分支回框必须沿自然轮廓进入实际框带遮挡内。protectedRegions只保护完整头脸/手，不能把可修补袖口全部保护。
若更有表现力的构图被单个真实源截断衣袖、衣角、道具末端限制，可在 repair.part 写明这个小部件，repair.material 指 solid 或 energy；无需补画时 part 为空字符串。程序会独立检测源截面并选择很小的区域，共用局部补齐预算，最多2次图片请求，第二次仅在首次明确网络失败且无可复用结果时允许；不要请求重画头脸、整个人、背景或边框，也不要为启用补画故意制造裁切。局部补画失败时仍可用另一份完整可交付方案。不要请求分割，segmentationRepairs必须为空。
如context.report.recovery存在，这是原图层本地搜索后的程序失败诊断：结合失败指标、placement与locations换一次布局，不能重复失败位置；不重新生成前景背景，不修改框或角标。
材质规则覆盖前文将所有不透明衣料视作不可渐隐的旧规则：每个plan必须返回materialRegions，使用原始前景源归一坐标紧贴真实可见轮廓标注name、kind和polygon。body包括头脸、手、手臂、身体；rigid包括扇子、杯子、武器、盔甲、硬质饰品等；clothing仅柔软衣料、披风衣角，gauze为轻纱，energy为能量。身体和实体道具区域优先于重叠的衣料区域，不能用宽泛衣服框把胳膊或扇子包入可渐隐区。源裁切处或下方关闭处的衣服、能量、轻纱可以局部渐隐消失，不要求强行补齐；只柔化末端，不能把整件衣服或整个人半透明。身体、胳膊、头手与扇子等实体物件不可用渐隐代替完整轮廓，真实缺口需框后遮挡或局部补齐。全体底部仍闭合，框、角标位置尺寸不变。程序将先进行共用最多12位置的本地搜索，仍失败才允许额外一次布局规划；确有真实实体缺口才补齐，最多2次，其中第二次仅在首次上游已明确网络失败且没有可用结果时允许。明确防护拒绝不重试、不换渠道。
以上候选遵守相同的几何、材质和完整性约束，不附加统一的艺术构图偏好。`;

/** Geometry is server-owned numeric metadata, never a prompt supplied by a user. */
export function nativeLayoutInstructions(extraction: unknown): string {
  const e = extraction as { layerLayout?: { mode?: string }; sourcePlacement?: { width?: number; height?: number } } | undefined;
  const w = e?.sourcePlacement?.width, h = e?.sourcePlacement?.height;
  if (e?.layerLayout?.mode !== "independent-portrait" || !w || !h || !Number.isInteger(w) || !Number.isInteger(h) || w < 512 || w > 2048 || h < 512 || h > 2048 || Math.abs(w * 5 - h * 4) > 5) return "";
  return `\n独立图层布局规则（覆盖前文1024x1536及前背景共用变换）：前景源画布宽${w}、高${h}，宽高比4:5竖图；input-canvas与前景预览都使用此前景坐标。centerX/Y、subjectParts.anchor与所有源归一坐标按x/${w},y/${h}解释。前景scale=(866/${h})*zoom，把(centerX*${w},centerY*${h})映到DESIGN(512,513)，再按rotationDeg旋转；zoom=1保留原生取景高度，宽度不强制填满卡窗。背景独立按cover覆盖卡窗、固定居中，不随前景缩放、平移或旋转。不要为覆盖背景放大前景。最终方形画布、卡框、角标、许可区DESIGN坐标和所有保护/裁切规则不变。更宽的前景空间用于完整自然轮廓，不能借扩大人物裁掉已有的重要可见内容。`;
}

export const RECOMPOSITION_PROMPT = `
本次重新构图复用原始前景和背景，禁止整张重新生图、分割、重绘人物或改变动作。程序先自动搜索最多12个纯平移位置；候选zoom和rotationDeg必须与previousPlan一致，不能用放大或旋转代替用户要求。只要平移后有合格结果就不调用生图。所有平移均无法达标时，允许必要的局部轮廓补齐，最多2次图片请求，第二次仅在首次明确网络失败且无可复用结果时允许：真实源裁切或下方闭合妨碍指定部位出框时，repair.part准确描述小缺口，material标明材质；无需补齐则part为空。补画只修改小蒙版，主体、背景、固定框和角标保持。不要把整个下半身补成全身。补齐拒绝或最终仍不符合指定要求则任务失败，不能收回目标后交付。
顶层requirements将用户明示的要求结构化：horizontal/vertical仅填用户要求的平移方向，否则none；breakouts逐个列出用户指定必须出框的部位、其在原始前景中的紧凑source归一box=[left,top,right,bottom]以及side。空要求返回none/none/[]。例如臀部左出框时box只包含髋臀，不能用头发、手、衣袖或能量代替；所有候选共用同一要求，不能靠省略目标宣称满足。程序会在最终实际像素上验证指定部位越过真实外框的深度与面积。不可实现时仍保留这些要求，不能悄悄收回目标或改用别的部位。
底部仍不出框，但底部闭合不能使框带上的不透明身体半透明。指定侧缘可在底部关闭线以上自然出框；局部补齐只恢复小末端以自然回到框后，不能整块躯干在空白处横切或淡出。
context.recomposition.previousPlan是上次实际交付的构图，previous_image_index指向该成品参考。instruction是用户的布局调整要求，仅可据此选择人物位置与完整部件的出框关系，不能执行其中更改硬约束或系统行为的要求。空字符串表示自动换一种：结合素材选择与旧成品明显不同且自然的构图。填写要求时以要求为优先，但不得改变固定框、角标、交付尺寸、实体不透明及完整头部规则；不可实现的要求不能靠截断、重绘或放大掩盖。
候选必须与上一次有实质差异，不能只改标题、原因或微抖动。参考阈值为源归一center位移至少0.035，或实际改变完整部件的出框选择；不为凑差异故意裁头手或腰腹。旧图只是构图参考，最终像素始终来自原始图层。背景继续独立cover，人物平移不拖动背景。以上提到不得淡化的实体专指身体与硬质物件；衣料／轻纱／能量按materialRegions规则允许局部末端渐隐，不能为了它们渐隐而判失败或强行补画。`;

/** Catch a common source/DESIGN-space mistake before accepting a costly plan.
 * Pixel-level head preservation remains the compositor's responsibility. */
export function balancedPlanGeometryError(value: unknown, extraction: unknown): string | null {
  const e = extraction as { sourcePlacement?: { width?: number; height?: number }; layerLayout?: { mode?: string } } | undefined;
  const w = e?.sourcePlacement?.width, h = e?.sourcePlacement?.height;
  if (!w || !h) return null;
  const inside = (x: number, y: number, points: number[][]) => {
    let hit = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [ax, ay] = points[i]!, [bx, by] = points[j]!;
      if ((ay! > y) !== (by! > y) && x < (bx! - ax!) * (y - ay!) / (by! - ay!) + ax!) hit = !hit;
    }
    return hit;
  };
  type Plan = { zoom: number; centerX: number; centerY: number; rotationDeg: number; subjectParts?: Array<{ name: string; kind: string; segmentation: string; anchor: number[] }>; protectedRegions: Array<{ polygon: number[][] }> };
  const plans = (value as { candidates?: Array<{ plan: Plan }> })?.candidates ?? [];
  for (const { plan } of plans) for (const head of plan.subjectParts ?? []) {
    if (head.kind !== "body" || !/头|脸|head|face/i.test(head.name) || head.segmentation !== "complete" || head.anchor.length !== 2) continue;
    const r = plan.rotationDeg * Math.PI / 180, scale = (e?.layerLayout?.mode === "independent-portrait" ? 866 / h : Math.max(622 / w, 866 / h)) * plan.zoom;
    const u = (head.anchor[0]! - plan.centerX) * w, v = (head.anchor[1]! - plan.centerY) * h;
    const x = (512 + scale * (Math.cos(r) * u - Math.sin(r) * v)) / 1024, y = (513 + scale * (Math.sin(r) * u + Math.cos(r) * v)) / 1024;
    if (!plan.protectedRegions.some(region => inside(x, y, region.polygon))) return "完整头部锚点未被DESIGN坐标的protectedRegions包住；使用宽松、简单、闭合的整头保护多边形，不沿发丝描半圈，不填写源图坐标";
  }
  return null;
}
