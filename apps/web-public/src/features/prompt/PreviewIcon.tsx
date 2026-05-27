import { aspectStyle, type AspectRatio, type FieldId, type SpriteCell } from "./field-dict.js";
import { FIELD_OPTIONS } from "./field-dict.js";
import { cn } from "@/lib/utils";

/**
 * Placeholder preview icons. Each option gets a simple `{ shape, colors }`
 * preset rendered as a 48×48 SVG "stamp". Designed to be replaced later by
 * real AI-generated previews (drop the SVG branch, render <img src=...>).
 */

type ShapeKey =
  | "block_split"
  | "soft_blob"
  | "circle_center"
  | "frame"
  | "grid8"
  | "ink_stroke"
  | "geo_triangle"
  | "diagonal"
  | "rim_glow"
  | "gradient_radial"
  | "gradient_linear"
  | "stripes_v"
  | "stripes_h"
  | "dot_pattern"
  | "spot_top"
  | "spot_side"
  | "spot_below"
  | "letter_glyph"
  | "iso_cube"
  | "rule_thirds"
  | "diagonal_lead"
  | "frame_inset"
  | "neg_space"
  | "symmetric"
  | "fish_eye"
  | "macro_dot"
  | "fill_full"
  | "moon"
  | "candle"
  | "neon_lines"
  | "glitch_split";

interface Preset {
  shape: ShapeKey;
  colors: string[];
  letter?: string;
}

const SIZE = 48;

// === Shared color tokens (decorative, not theme tokens — these are content
// data shaping the visual identity of each preset). ===
const C = {
  cream: "#F4ECD8",
  ink: "#2A2620",
  inkLight: "#5d5448",
  paper: "#FBF6EA",
  jade: "#3A5A40",
  jadeLight: "#7a9070",
  brick: "#A4453B",
  brickLight: "#d4724a",
  amber: "#f5b942",
  amberSoft: "#f0c170",
  sky: "#a8c4d6",
  skyDeep: "#1a2b4c",
  rose: "#c8163e",
  lavender: "#b0a0c2",
  pink: "#f08a5d",
  forestLight: "#a3b18a",
  morandi: "#a89e95",
  mono: "#7a7a7a",
  monoDark: "#1a1a1a",
  monoLight: "#ededed",
  neon: "#ff3b8a",
  cyan: "#5fdcd6",
  vapor: "#f6a3d2",
  violet: "#8a7ca8",
  warmYellow: "#f0c14b",
  vermilion: "#c8163e",
  gold: "#d4af37",
};

// === Per-option presets ===

const STYLE_PRESET: Record<string, Preset> = {
  realistic_photo: { shape: "frame", colors: [C.ink, C.morandi] },
  minimal_illustration: { shape: "circle_center", colors: [C.paper, C.jade] },
  flat_illustration: { shape: "block_split", colors: [C.jade, C.amber, C.brick] },
  watercolor: { shape: "soft_blob", colors: [C.sky, C.pink] },
  oil_painting: { shape: "stripes_v", colors: [C.brick, C.amber, C.jade] },
  ink_painting: { shape: "ink_stroke", colors: [C.ink, C.paper] },
  pixel_art: { shape: "grid8", colors: [C.jade, C.amber, C.brick] },
  render_3d: { shape: "iso_cube", colors: [C.skyDeep, C.sky, C.cream] },
  isometric: { shape: "iso_cube", colors: [C.jade, C.jadeLight, C.cream] },
  cyberpunk: { shape: "neon_lines", colors: [C.skyDeep, C.neon, C.cyan] },
  vaporwave: { shape: "gradient_linear", colors: [C.vapor, C.violet] },
  retro_film: { shape: "dot_pattern", colors: [C.amberSoft, C.brickLight] },
  ghibli: { shape: "soft_blob", colors: [C.sky, C.forestLight, C.cream] },
  impasto: { shape: "stripes_h", colors: [C.brick, C.amber, C.jade] },
  line_art: { shape: "diagonal", colors: [C.ink, C.paper] },
  ukiyo_e: { shape: "frame", colors: [C.vermilion, C.cream, C.ink] },
  cartoon: { shape: "geo_triangle", colors: [C.amber, C.brick] },
  manga: { shape: "stripes_v", colors: [C.ink, C.paper] },
  impressionism: { shape: "dot_pattern", colors: [C.sky, C.amber, C.pink] },
  bauhaus: { shape: "geo_triangle", colors: [C.brick, C.skyDeep, C.amber] },
  minimalism: { shape: "neg_space", colors: [C.paper, C.ink] },
  glitch: { shape: "glitch_split", colors: [C.neon, C.cyan, C.ink] },
  new_chinese: { shape: "ink_stroke", colors: [C.ink, C.vermilion, C.cream] },
  crayon: { shape: "stripes_h", colors: [C.amber, C.pink, C.sky] },
};

const TYPE_PRESET: Record<string, Preset> = {
  poster: { shape: "frame", colors: [C.brick, C.cream] },
  illustration: { shape: "soft_blob", colors: [C.jade, C.amber] },
  photo: { shape: "frame", colors: [C.ink, C.cream] },
  icon: { shape: "geo_triangle", colors: [C.jade, C.cream] },
  avatar: { shape: "circle_center", colors: [C.brickLight, C.cream] },
  logo: { shape: "letter_glyph", colors: [C.ink, C.cream], letter: "L" },
  banner: { shape: "stripes_h", colors: [C.amber, C.cream] },
  infographic: { shape: "grid8", colors: [C.skyDeep, C.amber, C.cream] },
  product: { shape: "circle_center", colors: [C.cream, C.ink] },
  character: { shape: "letter_glyph", colors: [C.violet, C.cream], letter: "C" },
  concept: { shape: "gradient_linear", colors: [C.skyDeep, C.amber] },
  comic: { shape: "frame_inset", colors: [C.ink, C.cream] },
  emoji: { shape: "circle_center", colors: [C.amber, C.ink] },
  card: { shape: "frame", colors: [C.gold, C.skyDeep] },
  cover: { shape: "letter_glyph", colors: [C.brick, C.cream], letter: "A" },
};

const MOOD_PRESET: Record<string, Preset> = {
  serene_warm: { shape: "gradient_radial", colors: [C.amberSoft, C.cream] },
  mystic_dreamy: { shape: "gradient_radial", colors: [C.violet, C.skyDeep] },
  lively_bright: { shape: "dot_pattern", colors: [C.amber, C.pink, C.cyan] },
  melancholy: { shape: "gradient_radial", colors: [C.sky, C.ink] },
  tense: { shape: "diagonal", colors: [C.ink, C.brick] },
  epic: { shape: "gradient_linear", colors: [C.skyDeep, C.gold] },
  nostalgic: { shape: "dot_pattern", colors: [C.amberSoft, C.morandi] },
  cute: { shape: "soft_blob", colors: [C.pink, C.amber] },
  cold_stern: { shape: "stripes_v", colors: [C.sky, C.ink] },
  solemn: { shape: "frame", colors: [C.ink, C.gold] },
  romantic: { shape: "soft_blob", colors: [C.rose, C.pink] },
  dramatic: { shape: "spot_side", colors: [C.ink, C.gold] },
  lonely: { shape: "neg_space", colors: [C.cream, C.morandi] },
  healing: { shape: "gradient_radial", colors: [C.forestLight, C.cream] },
  surreal: { shape: "gradient_linear", colors: [C.violet, C.cyan, C.pink] },
};

const LIGHTING_PRESET: Record<string, Preset> = {
  natural: { shape: "gradient_radial", colors: [C.amberSoft, C.cream] },
  sunset_side: { shape: "spot_side", colors: [C.brick, C.amber] },
  morning_soft: { shape: "gradient_radial", colors: [C.amberSoft, C.cream] },
  top: { shape: "spot_top", colors: [C.amber, C.ink] },
  top_long_shadow: { shape: "diagonal", colors: [C.amber, C.ink] },
  volumetric: { shape: "diagonal", colors: [C.cream, C.gold] },
  rim: { shape: "rim_glow", colors: [C.amber, C.ink] },
  neon: { shape: "neon_lines", colors: [C.ink, C.neon, C.cyan] },
  candle: { shape: "candle", colors: [C.amberSoft, C.ink] },
  moon: { shape: "moon", colors: [C.skyDeep, C.cream] },
  studio_softbox: { shape: "gradient_radial", colors: [C.cream, C.morandi] },
  studio_hard: { shape: "spot_side", colors: [C.cream, C.ink] },
  fog_diffuse: { shape: "gradient_radial", colors: [C.morandi, C.cream] },
  window: { shape: "stripes_v", colors: [C.cream, C.amber] },
  dramatic_spot: { shape: "spot_top", colors: [C.gold, C.ink] },
  golden_hour: { shape: "gradient_radial", colors: [C.gold, C.amber] },
  blue_hour: { shape: "gradient_radial", colors: [C.skyDeep, C.violet] },
};

const CAMERA_PRESET: Record<string, Preset> = {
  closeup: { shape: "circle_center", colors: [C.ink, C.cream] },
  medium: { shape: "frame_inset", colors: [C.ink, C.cream] },
  long: { shape: "frame", colors: [C.ink, C.cream] },
  wide: { shape: "fill_full", colors: [C.sky, C.cream] },
  top_down: { shape: "spot_top", colors: [C.ink, C.cream] },
  low_angle: { shape: "geo_triangle", colors: [C.ink, C.amber] },
  eye_level: { shape: "stripes_h", colors: [C.ink, C.cream] },
  birds_eye: { shape: "grid8", colors: [C.sky, C.cream] },
  worms_eye: { shape: "geo_triangle", colors: [C.skyDeep, C.cream] },
  pov: { shape: "fish_eye", colors: [C.ink, C.cream] },
  telephoto: { shape: "circle_center", colors: [C.skyDeep, C.cream] },
  wide_angle: { shape: "fish_eye", colors: [C.cream, C.ink] },
  fisheye: { shape: "fish_eye", colors: [C.skyDeep, C.cream] },
  macro: { shape: "macro_dot", colors: [C.jade, C.cream] },
};

const LAYOUT_PRESET: Record<string, Preset> = {
  centered: { shape: "circle_center", colors: [C.ink, C.cream] },
  rule_of_thirds: { shape: "rule_thirds", colors: [C.ink, C.cream] },
  diagonal: { shape: "diagonal_lead", colors: [C.ink, C.cream] },
  framed: { shape: "frame_inset", colors: [C.ink, C.cream] },
  leading_lines: { shape: "diagonal_lead", colors: [C.jade, C.cream] },
  symmetric: { shape: "symmetric", colors: [C.ink, C.cream] },
  golden_ratio: { shape: "rule_thirds", colors: [C.gold, C.cream] },
  negative_space: { shape: "neg_space", colors: [C.cream, C.ink] },
  full_frame: { shape: "fill_full", colors: [C.brick, C.cream] },
  third_subject: { shape: "rule_thirds", colors: [C.amber, C.cream] },
  horizontal_spread: { shape: "stripes_h", colors: [C.ink, C.cream] },
  vertical_stack: { shape: "stripes_v", colors: [C.ink, C.cream] },
};

const ALL: Record<FieldId, Record<string, Preset>> = {
  type: TYPE_PRESET,
  style: STYLE_PRESET,
  mood: MOOD_PRESET,
  lighting: LIGHTING_PRESET,
  camera: CAMERA_PRESET,
  layout: LAYOUT_PRESET,
  text_position: {},
  text_font: {},
  text_size: {},
};

const FALLBACK: Preset = { shape: "neg_space", colors: [C.cream, C.morandi] };

interface PreviewIconProps {
  field: FieldId;
  optionKey: string | null | undefined;
  /** Width in px. Height derives from aspect. */
  size?: number;
  /** Card aspect ratio. Default 1:1. */
  aspect?: AspectRatio;
  className?: string;
}

export function PreviewIcon({
  field,
  optionKey,
  size = SIZE,
  aspect = "1:1",
  className,
}: PreviewIconProps) {
  const sprite = optionKey ? findSprite(field, optionKey) : undefined;
  if (sprite) {
    return <SpritePreview sprite={sprite} size={size} className={className} />;
  }
  const preset = (optionKey && ALL[field]?.[optionKey]) || FALLBACK;
  const bg = preset.colors[1] ?? C.cream;
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-sm border border-border/40",
        className,
      )}
      style={{ width: size, aspectRatio: aspectStyle(aspect), backgroundColor: bg }}
      role="img"
      aria-hidden
    >
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        width="100%"
        height="100%"
        preserveAspectRatio="xMidYMid meet"
      >
        <rect width={SIZE} height={SIZE} fill={bg} />
        {renderShape(preset)}
      </svg>
    </div>
  );
}

/**
 * Sprite cell inset scale. The source image is generated edge-to-edge with
 * no outer border or gridlines (per project prompt convention) — but the
 * model still leaves tiny pixel-level artifacts at cell boundaries. We zoom
 * into each cell by this factor (1.08 = ~4% inset on each side) so those
 * boundary pixels never reach the user.
 */
const SPRITE_INSET_SCALE = 1.08;

function SpritePreview({
  sprite,
  size,
  className,
}: {
  sprite: SpriteCell;
  size: number;
  className?: string;
}) {
  const col = sprite.index % sprite.cols;
  const row = Math.floor(sprite.index / sprite.cols);
  // Background-position percentage with inset zoom. When the sprite image
  // is enlarged by N (= SPRITE_INSET_SCALE), the cell center stays centered
  // in the container if we use:
  //   P = 100 * [(idx + 0.5) * N - 0.5] / (count * N - 1)
  // Derives from the CSS background-position equation; reduces to the simple
  // idx/(count-1) form when N=1.
  const N = SPRITE_INSET_SCALE;
  const bgX =
    sprite.cols > 1
      ? (100 * ((col + 0.5) * N - 0.5)) / (sprite.cols * N - 1)
      : 0;
  const bgY =
    sprite.rows > 1
      ? (100 * ((row + 0.5) * N - 0.5)) / (sprite.rows * N - 1)
      : 0;
  // Assume the source sheet is a square canvas. Cell aspect (w:h) collapses
  // to rows:cols — 3×3 → 1:1, 6×4 → 2:3 vertical, 4×6 → 3:2 horizontal.
  const cellAspect = `${sprite.rows} / ${sprite.cols}`;
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-sm border border-border/40 bg-card",
        className,
      )}
      style={{
        width: size,
        aspectRatio: cellAspect,
        backgroundImage: `url(${sprite.src})`,
        backgroundSize: `${sprite.cols * 100 * N}% ${sprite.rows * 100 * N}%`,
        backgroundPosition: `${bgX}% ${bgY}%`,
        backgroundRepeat: "no-repeat",
      }}
      role="img"
      aria-hidden
    />
  );
}

function findSprite(field: FieldId, optionKey: string): SpriteCell | undefined {
  const opts = FIELD_OPTIONS[field];
  return opts.find(o => o.key === optionKey)?.sprite;
}

function renderShape(preset: Preset): React.ReactNode {
  const [a = C.ink, b = C.cream, c = C.amber] = preset.colors;
  switch (preset.shape) {
    case "block_split":
      return (
        <>
          <rect x="6" y="6" width="16" height="36" fill={a} />
          <rect x="22" y="6" width="20" height="18" fill={b} />
          <rect x="22" y="24" width="20" height="18" fill={c} />
        </>
      );
    case "soft_blob":
      return (
        <>
          <circle cx="18" cy="22" r="14" fill={a} opacity="0.7" />
          <circle cx="30" cy="28" r="12" fill={b ?? a} opacity="0.7" />
          {c && <circle cx="24" cy="34" r="8" fill={c} opacity="0.6" />}
        </>
      );
    case "circle_center":
      return <circle cx="24" cy="24" r="12" fill={a} />;
    case "frame":
      return (
        <>
          <rect x="6" y="6" width="36" height="36" fill="none" stroke={a} strokeWidth="3" />
        </>
      );
    case "frame_inset":
      return (
        <>
          <rect x="6" y="6" width="36" height="36" fill="none" stroke={a} strokeWidth="2" />
          <rect x="14" y="14" width="20" height="20" fill="none" stroke={a} strokeWidth="2" />
        </>
      );
    case "grid8": {
      const colors = [a, b, c, a, c, b, b, a, c];
      return (
        <g>
          {Array.from({ length: 9 }).map((_, i) => {
            const x = (i % 3) * 13 + 5;
            const y = Math.floor(i / 3) * 13 + 5;
            return <rect key={i} x={x} y={y} width="12" height="12" fill={colors[i]} />;
          })}
        </g>
      );
    }
    case "ink_stroke":
      return (
        <path
          d="M 8 38 Q 16 12, 26 28 T 42 18"
          stroke={a}
          strokeWidth="4"
          strokeLinecap="round"
          fill="none"
        />
      );
    case "geo_triangle":
      return <polygon points="24,8 42,40 6,40" fill={a} />;
    case "diagonal":
      return (
        <>
          <line x1="6" y1="42" x2="42" y2="6" stroke={a} strokeWidth="3" />
          <line x1="14" y1="42" x2="42" y2="14" stroke={a} strokeWidth="2" opacity="0.5" />
        </>
      );
    case "rim_glow":
      return (
        <>
          <circle cx="24" cy="24" r="14" fill={b} />
          <circle cx="24" cy="24" r="14" fill="none" stroke={a} strokeWidth="3" />
        </>
      );
    case "gradient_radial":
      return (
        <>
          <defs>
            <radialGradient id={`gr-${preset.shape}-${a}`}>
              <stop offset="0%" stopColor={a} />
              <stop offset="100%" stopColor={b} />
            </radialGradient>
          </defs>
          <rect x="2" y="2" width="44" height="44" fill={`url(#gr-${preset.shape}-${a})`} rx="3" />
        </>
      );
    case "gradient_linear":
      return (
        <>
          <defs>
            <linearGradient id={`gl-${a}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={a} />
              <stop offset="100%" stopColor={b} />
              {c && <stop offset="50%" stopColor={c} />}
            </linearGradient>
          </defs>
          <rect x="2" y="2" width="44" height="44" fill={`url(#gl-${a})`} rx="3" />
        </>
      );
    case "stripes_v":
      return (
        <>
          <rect x="6" y="6" width="6" height="36" fill={a} />
          <rect x="14" y="6" width="6" height="36" fill={b} />
          <rect x="22" y="6" width="6" height="36" fill={a} opacity="0.7" />
          <rect x="30" y="6" width="6" height="36" fill={c ?? b} />
          <rect x="38" y="6" width="4" height="36" fill={a} />
        </>
      );
    case "stripes_h":
      return (
        <>
          <rect x="4" y="8" width="40" height="6" fill={a} />
          <rect x="4" y="16" width="40" height="6" fill={b} />
          <rect x="4" y="24" width="40" height="6" fill={c ?? a} opacity="0.8" />
          <rect x="4" y="32" width="40" height="6" fill={b} />
        </>
      );
    case "dot_pattern":
      return (
        <g>
          {Array.from({ length: 16 }).map((_, i) => {
            const x = (i % 4) * 10 + 9;
            const y = Math.floor(i / 4) * 10 + 9;
            const colors = [a, b, c ?? a, a];
            return <circle key={i} cx={x} cy={y} r="2.5" fill={colors[i % colors.length]} />;
          })}
        </g>
      );
    case "spot_top":
      return (
        <>
          <defs>
            <radialGradient id={`spot-t-${a}`} cx="0.5" cy="0">
              <stop offset="0%" stopColor={a} />
              <stop offset="100%" stopColor={b} stopOpacity="0" />
            </radialGradient>
          </defs>
          <rect x="2" y="2" width="44" height="44" fill={b} rx="3" />
          <rect x="2" y="2" width="44" height="44" fill={`url(#spot-t-${a})`} rx="3" />
        </>
      );
    case "spot_side":
      return (
        <>
          <defs>
            <radialGradient id={`spot-s-${a}`} cx="0" cy="0.5">
              <stop offset="0%" stopColor={a} />
              <stop offset="100%" stopColor={b} stopOpacity="0" />
            </radialGradient>
          </defs>
          <rect x="2" y="2" width="44" height="44" fill={b} rx="3" />
          <rect x="2" y="2" width="44" height="44" fill={`url(#spot-s-${a})`} rx="3" />
        </>
      );
    case "spot_below":
      return (
        <>
          <defs>
            <radialGradient id={`spot-b-${a}`} cx="0.5" cy="1">
              <stop offset="0%" stopColor={a} />
              <stop offset="100%" stopColor={b} stopOpacity="0" />
            </radialGradient>
          </defs>
          <rect x="2" y="2" width="44" height="44" fill={b} rx="3" />
          <rect x="2" y="2" width="44" height="44" fill={`url(#spot-b-${a})`} rx="3" />
        </>
      );
    case "letter_glyph":
      return (
        <text
          x="24"
          y="32"
          textAnchor="middle"
          fontSize="22"
          fontWeight="700"
          fill={a}
        >
          {preset.letter ?? "?"}
        </text>
      );
    case "iso_cube":
      return (
        <>
          <polygon points="24,10 38,18 24,26 10,18" fill={a} />
          <polygon points="10,18 24,26 24,40 10,32" fill={b ?? a} />
          <polygon points="38,18 24,26 24,40 38,32" fill={c ?? b ?? a} />
        </>
      );
    case "rule_thirds":
      return (
        <>
          <rect x="4" y="4" width="40" height="40" fill="none" stroke={a} strokeWidth="1.5" />
          <line x1="17" y1="4" x2="17" y2="44" stroke={a} strokeWidth="1" />
          <line x1="31" y1="4" x2="31" y2="44" stroke={a} strokeWidth="1" />
          <line x1="4" y1="17" x2="44" y2="17" stroke={a} strokeWidth="1" />
          <line x1="4" y1="31" x2="44" y2="31" stroke={a} strokeWidth="1" />
          <circle cx="17" cy="17" r="2" fill={a} />
        </>
      );
    case "diagonal_lead":
      return (
        <>
          <line x1="6" y1="42" x2="42" y2="6" stroke={a} strokeWidth="3" />
          <polygon points="42,6 36,6 42,12" fill={a} />
        </>
      );
    case "neg_space":
      return <circle cx="36" cy="36" r="4" fill={b} />;
    case "symmetric":
      return (
        <>
          <line x1="24" y1="4" x2="24" y2="44" stroke={a} strokeWidth="1" strokeDasharray="2 2" />
          <polygon points="20,12 8,36 20,36" fill={a} opacity="0.7" />
          <polygon points="28,12 40,36 28,36" fill={a} opacity="0.7" />
        </>
      );
    case "fish_eye":
      return (
        <>
          <rect x="2" y="2" width="44" height="44" fill={b} rx="3" />
          <circle cx="24" cy="24" r="18" fill={a} opacity="0.2" />
          <circle cx="24" cy="24" r="12" fill={a} opacity="0.3" />
          <circle cx="24" cy="24" r="6" fill={a} opacity="0.4" />
        </>
      );
    case "macro_dot":
      return <circle cx="24" cy="24" r="20" fill={a} />;
    case "fill_full":
      return <rect x="2" y="2" width="44" height="44" fill={a} rx="3" />;
    case "moon":
      return (
        <g>
          <circle cx="24" cy="24" r="12" fill={b} />
          <circle cx="29" cy="22" r="11" fill={a} />
        </g>
      );
    case "candle":
      return (
        <>
          <rect x="22" y="20" width="4" height="20" fill={b} />
          <ellipse cx="24" cy="14" rx="3" ry="6" fill={a} />
        </>
      );
    case "neon_lines":
      return (
        <>
          <rect x="2" y="2" width="44" height="44" fill={a} rx="3" />
          <line x1="6" y1="20" x2="42" y2="20" stroke={b} strokeWidth="2" />
          <line x1="6" y1="28" x2="42" y2="28" stroke={c ?? b} strokeWidth="2" />
          <line x1="14" y1="6" x2="14" y2="42" stroke={b} strokeWidth="1" opacity="0.6" />
          <line x1="34" y1="6" x2="34" y2="42" stroke={c ?? b} strokeWidth="1" opacity="0.6" />
        </>
      );
    case "glitch_split":
      return (
        <>
          <rect x="6" y="8" width="36" height="10" fill={a} />
          <rect x="2" y="18" width="40" height="10" fill={b} opacity="0.8" />
          <rect x="10" y="28" width="32" height="10" fill={c ?? a} />
        </>
      );
    default:
      return null;
  }
}
