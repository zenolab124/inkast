import type { Lang } from "@/i18n/types.js";

export type AspectRatio = "1:1" | "2:3" | "3:2" | "16:9" | "9:16";

/**
 * Sprite sheet coordinate. The source image is a strict cols × rows grid of
 * square cells; `index` is 0-based, left-to-right then top-to-bottom.
 * PreviewIcon renders sprite cells as a 1:1 background — `aspect` on the same
 * FieldOption is ignored when a sprite is present.
 */
export interface SpriteCell {
  src: string;
  cols: number;
  rows: number;
  index: number;
}

export interface FieldOption {
  key: string;
  zh: string;
  en: string;
  /** Short one-liner used in the picker dialog cards. */
  descZh?: string;
  descEn?: string;
  /** Preview card aspect ratio. Defaults to 1:1 if omitted. Ignored if `sprite` is set. */
  aspect?: AspectRatio;
  /** AI-generated preview image, sliced from a sprite sheet. */
  sprite?: SpriteCell;
}

export function aspectStyle(aspect: AspectRatio | undefined): string {
  if (!aspect || aspect === "1:1") return "1 / 1";
  return aspect.replace(":", " / ");
}

export type FieldId =
  | "type"
  | "style"
  | "mood"
  | "lighting"
  | "camera"
  | "layout"
  | "text_position"
  | "text_font"
  | "text_size";

// Type: 15 options across 2 sheets (9 + 6). All cells 1:1 — square poster /
// square banner / square cover work fine as visual category previews.
const type = (n: number, i: number) => ({
  src: `/previews/type-${n}.png`,
  cols: 3,
  rows: 3,
  index: i,
});

export const TYPE_OPTIONS: FieldOption[] = [
  // === Sheet 1 — print / brand / web (9) ===
  { key: "poster", zh: "海报", en: "Poster", descZh: "宣传 / 装饰用大图", descEn: "Large promotional image", sprite: type(1, 0) },
  { key: "illustration", zh: "插画", en: "Illustration", descZh: "手绘风格图", descEn: "Hand-drawn artwork", sprite: type(1, 1) },
  { key: "photo", zh: "摄影", en: "Photo", descZh: "照片真实感", descEn: "Photographic realism", sprite: type(1, 2) },
  { key: "icon", zh: "矢量图标", en: "Vector icon", descZh: "扁平图标符号", descEn: "Flat icon symbol", sprite: type(1, 3) },
  { key: "avatar", zh: "头像", en: "Avatar", descZh: "人物或角色头像", descEn: "Profile portrait", sprite: type(1, 4) },
  { key: "logo", zh: "Logo", en: "Logo", descZh: "品牌标识", descEn: "Brand mark", sprite: type(1, 5) },
  { key: "banner", zh: "Banner / 横幅", en: "Banner", descZh: "横向宽幅图", descEn: "Wide horizontal image", sprite: type(1, 6) },
  { key: "infographic", zh: "信息图", en: "Infographic", descZh: "数据 / 知识可视化", descEn: "Data / knowledge visualization", sprite: type(1, 7) },
  { key: "cover", zh: "封面图", en: "Cover", descZh: "封面 / 标题图", descEn: "Title / cover image", sprite: type(1, 8) },

  // === Sheet 2 — product / character / interactive (6, + 3 baseline) ===
  { key: "product", zh: "产品图", en: "Product shot", descZh: "商品展示", descEn: "Product display", sprite: type(2, 0) },
  { key: "character", zh: "角色立绘", en: "Character art", descZh: "角色全身设计", descEn: "Character full-body design", sprite: type(2, 1) },
  { key: "concept", zh: "场景概念图", en: "Concept art", descZh: "场景概念设计", descEn: "Scene concept design", sprite: type(2, 2) },
  { key: "comic", zh: "漫画格", en: "Comic panel", descZh: "分镜漫画格", descEn: "Comic strip panel", sprite: type(2, 3) },
  { key: "emoji", zh: "表情包", en: "Sticker", descZh: "聊天表情包", descEn: "Chat sticker", sprite: type(2, 4) },
  { key: "card", zh: "卡牌", en: "Card", descZh: "卡牌设计", descEn: "Card design", sprite: type(2, 5) },
];

// 4 separate 3×3 sprite sheets to fit within the 1024×1024 API limit while
// keeping each cell at ~341px for legible detail.
const sheet = (n: number, i: number) => ({
  src: `/previews/style-${n}.png`,
  cols: 3,
  rows: 3,
  index: i,
});

export const STYLE_OPTIONS: FieldOption[] = [
  // === Sheet 1 — Foundational & Traditional (基础与素描) ===
  { key: "realistic_photo", zh: "写实摄影", en: "Realistic photo", descZh: "照片级真实", descEn: "Photo-realistic", sprite: sheet(1, 0) },
  { key: "flat_illustration", zh: "扁平插画", en: "Flat illustration", descZh: "无光影 几何", descEn: "No shadow, geometric", sprite: sheet(1, 1) },
  { key: "vector", zh: "矢量描边", en: "Vector illustration", descZh: "粗描边 大色块", descEn: "Thick outlines, solid fills", sprite: sheet(1, 2) },
  { key: "line_art", zh: "线稿", en: "Line art", descZh: "纯线条", descEn: "Pure linework", sprite: sheet(1, 3) },
  { key: "charcoal", zh: "炭笔素描", en: "Charcoal sketch", descZh: "黑白草图阴影", descEn: "B&W graphite shading", sprite: sheet(1, 4) },
  { key: "minimalism", zh: "极简主义", en: "Minimalism", descZh: "大留白 单元素", descEn: "White space, single element", sprite: sheet(1, 5) },
  { key: "watercolor", zh: "水彩", en: "Watercolor", descZh: "柔晕透明笔触", descEn: "Soft translucent washes", sprite: sheet(1, 6) },
  { key: "oil_painting", zh: "油画", en: "Oil painting", descZh: "厚重笔触 浓彩", descEn: "Thick textured brushwork", sprite: sheet(1, 7) },
  { key: "crayon", zh: "蜡笔手绘", en: "Crayon", descZh: "蜡笔粗糙质感", descEn: "Crayon rough texture", sprite: sheet(1, 8) },

  // === Sheet 2 — Eastern & Classical Art (东方与古典) ===
  { key: "ink_painting", zh: "国画水墨", en: "Ink painting", descZh: "墨色晕染留白", descEn: "Ink wash, negative space", sprite: sheet(2, 0) },
  { key: "ukiyo_e", zh: "浮世绘", en: "Ukiyo-e", descZh: "日本江户版画", descEn: "Japanese Edo woodblock", sprite: sheet(2, 1) },
  { key: "new_chinese", zh: "新中式", en: "New Chinese style", descZh: "中式现代", descEn: "Modern Chinese aesthetic", sprite: sheet(2, 2) },
  { key: "impressionism", zh: "印象派", en: "Impressionism", descZh: "破碎光影笔触", descEn: "Broken-light strokes", sprite: sheet(2, 3) },
  { key: "expressionism", zh: "表现主义", en: "Expressionism", descZh: "扭曲变形 强笔触", descEn: "Distorted, vivid strokes", sprite: sheet(2, 4) },
  { key: "cubism", zh: "立体主义", en: "Cubism", descZh: "几何分块 多视角", descEn: "Fragmented planes, multi-POV", sprite: sheet(2, 5) },
  { key: "surrealism", zh: "超现实主义", en: "Surrealism", descZh: "梦境感 不可能场景", descEn: "Dreamlike, impossible scenes", sprite: sheet(2, 6) },
  { key: "art_deco", zh: "装饰艺术", en: "Art Deco", descZh: "金色几何 对称", descEn: "Golden geometric, symmetric", sprite: sheet(2, 7) },
  { key: "art_nouveau", zh: "新艺术", en: "Art Nouveau", descZh: "花卉曲线 装饰", descEn: "Botanical curves, decorative", sprite: sheet(2, 8) },

  // === Sheet 3 — Design & Cartoon (设计 / 卡通) ===
  { key: "pop_art", zh: "波普艺术", en: "Pop art", descZh: "网点 高饱和原色", descEn: "Ben-Day dots, bold colors", sprite: sheet(3, 0) },
  { key: "comic_book", zh: "美式漫画", en: "Comic book", descZh: "粗描边 网点阴影", descEn: "Thick outlines, halftone shading", sprite: sheet(3, 1) },
  { key: "bauhaus", zh: "包豪斯", en: "Bauhaus", descZh: "几何原色", descEn: "Primary geometry", sprite: sheet(3, 2) },
  { key: "memphis", zh: "孟菲斯派", en: "Memphis", descZh: "80s 几何 + 网点", descEn: "80s geometry, dots, squiggles", sprite: sheet(3, 3) },
  { key: "mosaic", zh: "马赛克", en: "Mosaic", descZh: "小色块拼贴", descEn: "Small tile pieces", sprite: sheet(3, 4) },
  { key: "stained_glass", zh: "彩色玻璃", en: "Stained glass", descZh: "黑线分隔 透色", descEn: "Lead lines, translucent panels", sprite: sheet(3, 5) },
  { key: "cartoon", zh: "卡通", en: "Cartoon", descZh: "夸张卡通", descEn: "Exaggerated cartoon", sprite: sheet(3, 6) },
  { key: "manga", zh: "漫画", en: "Manga", descZh: "日漫黑白线条", descEn: "Japanese B&W manga", sprite: sheet(3, 7) },
  { key: "ghibli", zh: "吉卜力", en: "Ghibli", descZh: "宫崎骏童话感", descEn: "Miyazaki storybook feel", sprite: sheet(3, 8) },

  // === Sheet 4 — Cinema & Digital (电影 / 数字) ===
  { key: "noir", zh: "黑色电影", en: "Noir", descZh: "高对比黑白", descEn: "High-contrast B&W", sprite: sheet(4, 0) },
  { key: "retro_film", zh: "复古胶片", en: "Retro film", descZh: "颗粒褪色", descEn: "Grainy, faded", sprite: sheet(4, 1) },
  { key: "cyberpunk", zh: "赛博朋克", en: "Cyberpunk", descZh: "霓虹高对比", descEn: "Neon high contrast", sprite: sheet(4, 2) },
  { key: "vaporwave", zh: "蒸汽波", en: "Vaporwave", descZh: "粉紫故障调", descEn: "Pink-purple glitch", sprite: sheet(4, 3) },
  { key: "glitch", zh: "故障艺术", en: "Glitch", descZh: "RGB 错位故障", descEn: "RGB-shift glitch", sprite: sheet(4, 4) },
  { key: "pixel_art", zh: "像素艺术", en: "Pixel art", descZh: "方块像素", descEn: "Blocky pixels", sprite: sheet(4, 5) },
  { key: "render_3d", zh: "3D 渲染", en: "3D render", descZh: "立体渲染", descEn: "Volumetric render", sprite: sheet(4, 6) },
  { key: "isometric", zh: "等距 isometric", en: "Isometric", descZh: "30° 轴测", descEn: "30° axonometric", sprite: sheet(4, 7) },
  { key: "low_poly", zh: "低多边形", en: "Low poly", descZh: "三角面拼接", descEn: "Triangle facets", sprite: sheet(4, 8) },
];

// Mood: 15 options across 2 sprite sheets. Sheet 2 has 3 blank cells at the
// end (indices 6/7/8) — the prompt explicitly tells the model to leave them
// empty. Order within each sheet is hand-tuned to give the model strong
// visual contrast (warm vs cold, calm vs dramatic) within a single canvas.
const mood = (n: number, i: number) => ({
  src: `/previews/mood-${n}.png`,
  cols: 3,
  rows: 3,
  index: i,
});

export const MOOD_OPTIONS: FieldOption[] = [
  // === Sheet 1 — warm/cold + dramatic/healing contrast ===
  { key: "serene_warm", zh: "宁静温暖", en: "Serene warm", descZh: "平静 + 暖意", descEn: "Calm + warm", sprite: mood(1, 0) },
  { key: "mystic_dreamy", zh: "神秘梦幻", en: "Mystic dreamy", descZh: "梦境感", descEn: "Dreamlike", sprite: mood(1, 1) },
  { key: "lively_bright", zh: "活泼明亮", en: "Lively bright", descZh: "活力轻快", descEn: "Lively & light", sprite: mood(1, 2) },
  { key: "melancholy", zh: "忧郁阴沉", en: "Melancholy", descZh: "压抑低沉", descEn: "Heavy mood", sprite: mood(1, 3) },
  { key: "epic", zh: "史诗壮丽", en: "Epic", descZh: "宏大壮阔", descEn: "Grand scale", sprite: mood(1, 4) },
  { key: "cute", zh: "童趣可爱", en: "Cute", descZh: "童真甜美", descEn: "Sweet & playful", sprite: mood(1, 5) },
  { key: "cold_stern", zh: "冷峻凛冽", en: "Cold stern", descZh: "冷静肃杀", descEn: "Cold & severe", sprite: mood(1, 6) },
  { key: "dramatic", zh: "戏剧张力", en: "Dramatic", descZh: "戏剧化对比", descEn: "Theatrical contrast", sprite: mood(1, 7) },
  { key: "healing", zh: "治愈", en: "Healing", descZh: "舒缓治愈", descEn: "Soothing", sprite: mood(1, 8) },

  // === Sheet 2 — remaining 6 (indices 6/7/8 left blank in the source image) ===
  { key: "tense", zh: "紧张悬疑", en: "Tense", descZh: "悬疑张力", descEn: "Suspenseful tension", sprite: mood(2, 0) },
  { key: "romantic", zh: "浪漫柔美", en: "Romantic", descZh: "甜蜜柔和", descEn: "Tender romance", sprite: mood(2, 1) },
  { key: "nostalgic", zh: "怀旧复古", en: "Nostalgic", descZh: "旧时光", descEn: "Bygone era", sprite: mood(2, 2) },
  { key: "solemn", zh: "庄严肃穆", en: "Solemn", descZh: "庄重严肃", descEn: "Grave & dignified", sprite: mood(2, 3) },
  { key: "lonely", zh: "孤独寂寥", en: "Lonely", descZh: "孤寂留白", descEn: "Solitude", sprite: mood(2, 4) },
  { key: "surreal", zh: "超现实", en: "Surreal", descZh: "异常逻辑", descEn: "Beyond reality", sprite: mood(2, 5) },
];

// Lighting: 15 options across 2 sprite sheets (9 + 6). Sheet 2 has 3 blank
// cells at the end. Removed `natural` (too vague, covered by morning_soft /
// golden_hour / window) and `top` (covered by top_long_shadow).
const lighting = (n: number, i: number) => ({
  src: `/previews/lighting-${n}.png`,
  cols: 3,
  rows: 3,
  index: i,
});

export const LIGHTING_OPTIONS: FieldOption[] = [
  // === Sheet 1 — natural-time + dramatic light ===
  { key: "morning_soft", zh: "清晨柔光", en: "Morning soft", descZh: "清晨柔和光", descEn: "Early-morning soft", sprite: lighting(1, 0) },
  { key: "sunset_side", zh: "黄昏侧逆光", en: "Sunset side-back", descZh: "夕阳侧背光", descEn: "Setting sun, side-back", sprite: lighting(1, 1) },
  { key: "golden_hour", zh: "黄金时刻", en: "Golden hour", descZh: "日出 / 日落金光", descEn: "Sunrise/sunset gold", sprite: lighting(1, 2) },
  { key: "blue_hour", zh: "蓝调时刻", en: "Blue hour", descZh: "日落后蓝调", descEn: "Post-sunset blue", sprite: lighting(1, 3) },
  { key: "top_long_shadow", zh: "顶光 + 长投影", en: "Top + long shadow", descZh: "高顶光 + 长投影", descEn: "High top, long shadow", sprite: lighting(1, 4) },
  { key: "volumetric", zh: "体积光", en: "Volumetric", descZh: "丁达尔光柱", descEn: "Tyndall beams", sprite: lighting(1, 5) },
  { key: "rim", zh: "边缘光", en: "Rim light", descZh: "轮廓发光", descEn: "Edge glow", sprite: lighting(1, 6) },
  { key: "dramatic_spot", zh: "戏剧聚光", en: "Dramatic spot", descZh: "戏剧聚光灯", descEn: "Theatrical spot", sprite: lighting(1, 7) },
  { key: "neon", zh: "霓虹光", en: "Neon", descZh: "霓虹混色", descEn: "Neon mixed", sprite: lighting(1, 8) },

  // === Sheet 2 — indoor / special-source light (indices 6/7/8 left blank) ===
  { key: "candle", zh: "烛光", en: "Candlelight", descZh: "烛光暖闪", descEn: "Warm flicker", sprite: lighting(2, 0) },
  { key: "moon", zh: "月光", en: "Moonlight", descZh: "冷月光", descEn: "Cool moonlight", sprite: lighting(2, 1) },
  { key: "studio_softbox", zh: "工作室柔光箱", en: "Studio softbox", descZh: "影棚柔光", descEn: "Studio diffused", sprite: lighting(2, 2) },
  { key: "studio_hard", zh: "棚拍硬光", en: "Studio hard", descZh: "影棚硬光", descEn: "Sharp studio key", sprite: lighting(2, 3) },
  { key: "fog_diffuse", zh: "雾气漫射", en: "Foggy diffuse", descZh: "雾气漫射", descEn: "Misty diffuse", sprite: lighting(2, 4) },
  { key: "window", zh: "窗光", en: "Window light", descZh: "侧窗光", descEn: "Side window", sprite: lighting(2, 5) },
];

// Camera: 12 options across 2 sheets (9 + 3). Sheet 2 has 6 blank cells.
// Removed `birds_eye` (overlaps top_down) and `worms_eye` (overlaps low_angle).
const camera = (n: number, i: number) => ({
  src: `/previews/camera-${n}.png`,
  cols: 3,
  rows: 3,
  index: i,
});

export const CAMERA_OPTIONS: FieldOption[] = [
  // === Sheet 1 — 4 shot sizes + 3 vertical angles + 2 lens types ===
  { key: "closeup", zh: "近景特写", en: "Close-up", descZh: "面部 / 细节", descEn: "Face / detail", sprite: camera(1, 0) },
  { key: "medium", zh: "中景", en: "Medium shot", descZh: "半身 / 主体填充", descEn: "Half-body / framed", sprite: camera(1, 1) },
  { key: "long", zh: "远景", en: "Long shot", descZh: "全身 + 环境", descEn: "Full-body + setting", sprite: camera(1, 2) },
  { key: "wide", zh: "大全景", en: "Wide shot", descZh: "大场景", descEn: "Wide scene", sprite: camera(1, 3) },
  { key: "top_down", zh: "俯视", en: "Top-down", descZh: "向下俯角", descEn: "Looking down", sprite: camera(1, 4) },
  { key: "low_angle", zh: "仰视", en: "Low angle", descZh: "向上仰角", descEn: "Looking up", sprite: camera(1, 5) },
  { key: "eye_level", zh: "平视", en: "Eye level", descZh: "水平视角", descEn: "Horizontal", sprite: camera(1, 6) },
  { key: "telephoto", zh: "长焦压缩", en: "Telephoto", descZh: "压缩透视", descEn: "Compressed perspective", sprite: camera(1, 7) },
  { key: "wide_angle", zh: "广角畸变", en: "Wide-angle", descZh: "畸变张力", descEn: "Distorted wide", sprite: camera(1, 8) },

  // === Sheet 2 — special viewpoints (indices 3-8 left blank) ===
  { key: "pov", zh: "第一人称", en: "POV", descZh: "主观视角", descEn: "First-person view", sprite: camera(2, 0) },
  { key: "fisheye", zh: "鱼眼", en: "Fisheye", descZh: "鱼眼极畸变", descEn: "Extreme fisheye", sprite: camera(2, 1) },
  { key: "macro", zh: "微距", en: "Macro", descZh: "微观特写", descEn: "Macro close", sprite: camera(2, 2) },
];

// Layout: 12 options across 2 sheets (9 + 3). Sheet 2 has 6 baseline cells.
const layout = (n: number, i: number) => ({
  src: `/previews/layout-${n}.png`,
  cols: 3,
  rows: 3,
  index: i,
});

export const LAYOUT_OPTIONS: FieldOption[] = [
  // === Sheet 1 — 9 classic composition principles ===
  { key: "centered", zh: "居中构图", en: "Centered", descZh: "主体居中", descEn: "Subject in center", sprite: layout(1, 0) },
  { key: "rule_of_thirds", zh: "三分法", en: "Rule of thirds", descZh: "九宫格交点", descEn: "Thirds intersections", sprite: layout(1, 1) },
  { key: "diagonal", zh: "对角线", en: "Diagonal", descZh: "对角线引导", descEn: "Diagonal lead", sprite: layout(1, 2) },
  { key: "framed", zh: "框架式", en: "Framed", descZh: "前景框住主体", descEn: "Foreground frame", sprite: layout(1, 3) },
  { key: "leading_lines", zh: "引导线", en: "Leading lines", descZh: "线条引向主体", descEn: "Lines lead to subject", sprite: layout(1, 4) },
  { key: "symmetric", zh: "对称", en: "Symmetric", descZh: "左右 / 上下对称", descEn: "Mirror symmetric", sprite: layout(1, 5) },
  { key: "golden_ratio", zh: "黄金分割", en: "Golden ratio", descZh: "斐波那契螺旋", descEn: "Fibonacci spiral", sprite: layout(1, 6) },
  { key: "negative_space", zh: "留白构图", en: "Negative space", descZh: "大量留白", descEn: "Lots of empty space", sprite: layout(1, 7) },
  { key: "full_frame", zh: "满构图", en: "Full frame", descZh: "撑满画面", descEn: "Fills the frame", sprite: layout(1, 8) },

  // === Sheet 2 — distribution-style layouts (indices 3-8 baseline) ===
  { key: "third_subject", zh: "主体占 1/3", en: "Subject 1/3", descZh: "主体占画面 1/3", descEn: "Subject = 1/3 of frame", sprite: layout(2, 0) },
  { key: "horizontal_spread", zh: "横向铺陈", en: "Horizontal spread", descZh: "横向排布", descEn: "Spread horizontally", sprite: layout(2, 1) },
  { key: "vertical_stack", zh: "纵向堆叠", en: "Vertical stack", descZh: "纵向堆叠", descEn: "Stacked vertically", sprite: layout(2, 2) },
];

export const TEXT_POSITION_OPTIONS: FieldOption[] = [
  { key: "top_center", zh: "上方居中", en: "Top center" },
  { key: "bottom_center", zh: "下方居中", en: "Bottom center" },
  { key: "center", zh: "中央", en: "Center" },
  { key: "top_left", zh: "左上", en: "Top left" },
  { key: "top_right", zh: "右上", en: "Top right" },
  { key: "bottom_left", zh: "左下", en: "Bottom left" },
  { key: "bottom_right", zh: "右下", en: "Bottom right" },
  { key: "bottom_right_small", zh: "右下小字", en: "Bottom right (small)" },
  { key: "bottom_band", zh: "底部居中", en: "Bottom band" },
  { key: "diagonal", zh: "沿对角线", en: "Along diagonal" },
  { key: "around_subject", zh: "绕主体", en: "Around subject" },
  { key: "along_bottom", zh: "沿底边", en: "Along bottom" },
];

export const TEXT_FONT_OPTIONS: FieldOption[] = [
  { key: "handwriting", zh: "手写体", en: "Handwriting" },
  { key: "print", zh: "印刷体", en: "Print" },
  { key: "sans_serif", zh: "无衬线", en: "Sans-serif" },
  { key: "serif", zh: "衬线", en: "Serif" },
  { key: "display", zh: "装饰字体", en: "Display" },
  { key: "calligraphy", zh: "书法", en: "Calligraphy" },
  { key: "pixel", zh: "像素字体", en: "Pixel font" },
  { key: "hand_drawn", zh: "手绘", en: "Hand-drawn" },
  { key: "brush", zh: "手书风", en: "Brush" },
];

export const TEXT_SIZE_OPTIONS: FieldOption[] = [
  { key: "xlarge", zh: "极大", en: "Extra large" },
  { key: "large", zh: "大", en: "Large" },
  { key: "medium", zh: "中", en: "Medium" },
  { key: "small", zh: "小", en: "Small" },
  { key: "xsmall", zh: "极小", en: "Extra small" },
];

export interface PalettePreset {
  key: string;
  zh: string;
  en: string;
  colors: string[];
}

export const PALETTE_PRESETS: PalettePreset[] = [
  { key: "morandi", zh: "莫兰迪灰", en: "Morandi", colors: ["#c8c2bd", "#a89e95", "#7a6f64"] },
  { key: "monet", zh: "莫奈蓝紫", en: "Monet blue-purple", colors: ["#6b8db4", "#8a7ca8", "#b0a0c2"] },
  { key: "forest", zh: "自然森林", en: "Forest", colors: ["#3a5a40", "#588157", "#a3b18a"] },
  { key: "sunset", zh: "夕阳粉橙", en: "Sunset", colors: ["#f5b942", "#f08a5d", "#d4724a"] },
  { key: "mono", zh: "黑白灰", en: "Mono", colors: ["#1a1a1a", "#7a7a7a", "#ededed"] },
  { key: "vermilion", zh: "中国朱砂", en: "Chinese vermilion", colors: ["#c8163e", "#f0c14b", "#2a4d3a"] },
  { key: "deep_sea", zh: "深海蓝", en: "Deep sea", colors: ["#1a2b4c", "#2f4869", "#4a6b8c"] },
  { key: "vintage_cream", zh: "米色复古", en: "Vintage cream", colors: ["#f5e6d3", "#d4b896", "#8b6f47"] },
];

export function localizedLabel(opt: FieldOption, lang: Lang): string {
  return opt[lang];
}

export function localizedDesc(opt: FieldOption, lang: Lang): string | undefined {
  return lang === "zh" ? opt.descZh : opt.descEn;
}

/**
 * Look up a field option key by the user-facing value (could be in either
 * language, or a custom string). Returns the key for preview-icon lookup, or
 * null if the value doesn't match any preset.
 */
export function findOptionKey(
  options: FieldOption[],
  value: string,
): string | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  for (const o of options) {
    if (o.zh.toLowerCase() === v || o.en.toLowerCase() === v) return o.key;
  }
  return null;
}

export const FIELD_OPTIONS: Record<FieldId, FieldOption[]> = {
  type: TYPE_OPTIONS,
  style: STYLE_OPTIONS,
  mood: MOOD_OPTIONS,
  lighting: LIGHTING_OPTIONS,
  camera: CAMERA_OPTIONS,
  layout: LAYOUT_OPTIONS,
  text_position: TEXT_POSITION_OPTIONS,
  text_font: TEXT_FONT_OPTIONS,
  text_size: TEXT_SIZE_OPTIONS,
};
