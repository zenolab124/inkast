/**
 * Detects a "transparency checkerboard" that an upstream model PAINTED into an
 * opaque RGB image (gray/white tiles along corners and edges, no real alpha).
 *
 * Pure function over raw pixels so it can be unit-tested without sharp.
 * Level-agnostic: the painted tiles come in different grays (light ~204/255 and
 * dark ~130/195 have both been observed), so a block qualifies when it holds two
 * neutral gray levels that alternate in regular square runs along rows AND
 * columns. Validated on 2026-11-04 against 5 real checkerboards (light/dark,
 * delivered size and full provider size: all >= 2 blocks) and 631 ordinary
 * outputs from snapub / snapub_art_director / mpinkast (all 0 blocks, including
 * a grayscale line-art image whose hatching the run-regularity rule excludes).
 */

export const PAINTED_CHECKERBOARD_ERROR_CODE = "painted_transparency_checkerboard" as const;

const BLOCK = 48;
const EDGE_INSET = 4;
const NEUTRAL_MAX_SPREAD = 12;
const NEUTRAL_MIN_RATIO = 0.9;
const MIN_LEVEL_GAP = 35; // p90 - p10 luminance
const LEVEL_BAND = 0.2; // fraction of the gap counted as "near" a level
const LEVEL_MIN_RATIO = 0.2; // each level
const LEVELS_MIN_RATIO = 0.55; // both levels together (tile edges blur under webp)
const MIN_FLIPS_PER_LINE = 2;
const MIN_RUNS = 8;
const RUN_MIN = 4;
const RUN_MAX = 40;
const RUN_TOLERANCE = 0.35;
const RUN_REGULAR_RATIO = 0.7;
const MIN_HIT_BLOCKS = 2;

export interface PaintedCheckerboardResult {
  readonly isCheckerboard: boolean;
  readonly hitCount: number;
  /** Labels of blocks judged as checkerboard, for logs. */
  readonly hits: readonly string[];
}

/**
 * @param data raw interleaved pixels (row-major); only the first 3 channels are read
 * @param channels bytes per pixel (3 = RGB, 4 = RGBA)
 */
export function detectPaintedCheckerboard(
  data: Uint8Array,
  width: number,
  height: number,
  channels: number,
): PaintedCheckerboardResult {
  if (channels < 3) throw new Error(`detectPaintedCheckerboard needs >= 3 channels, got ${channels}`);
  if (data.length < width * height * channels) {
    throw new Error("detectPaintedCheckerboard: raw buffer shorter than width*height*channels");
  }
  const right = width - BLOCK - EDGE_INSET;
  const bottom = height - BLOCK - EDGE_INSET;
  const midX = Math.floor(width / 2) - BLOCK / 2;
  const midY = Math.floor(height / 2);
  const blocks: Array<readonly [string, number, number]> = [
    ["top-left", EDGE_INSET, EDGE_INSET],
    ["top-right", right, EDGE_INSET],
    ["bottom-left", EDGE_INSET, bottom],
    ["bottom-right", right, bottom],
    ["left-mid", EDGE_INSET, midY],
    ["right-mid", right, midY],
    ["top-mid", midX, EDGE_INSET],
  ];

  const hits: string[] = [];
  for (const [label, x0, y0] of blocks) {
    // Images too small to host a full block are simply not inspected there.
    if (x0 < 0 || y0 < 0 || x0 + BLOCK > width || y0 + BLOCK > height) continue;
    if (isCheckerboardBlock(data, width, channels, x0, y0)) hits.push(label);
  }
  return { isCheckerboard: hits.length >= MIN_HIT_BLOCKS, hitCount: hits.length, hits };
}

function isCheckerboardBlock(
  data: Uint8Array,
  width: number,
  channels: number,
  x0: number,
  y0: number,
): boolean {
  const total = BLOCK * BLOCK;
  const lum = new Float64Array(total);
  let neutral = 0;
  for (let y = 0; y < BLOCK; y += 1) {
    for (let x = 0; x < BLOCK; x += 1) {
      const offset = ((y0 + y) * width + (x0 + x)) * channels;
      const r = data[offset]!;
      const g = data[offset + 1]!;
      const b = data[offset + 2]!;
      if (Math.max(r, g, b) - Math.min(r, g, b) < NEUTRAL_MAX_SPREAD) neutral += 1;
      lum[y * BLOCK + x] = (r + g + b) / 3;
    }
  }
  if (neutral / total < NEUTRAL_MIN_RATIO) return false;

  const sorted = Float64Array.from(lum).sort();
  const lo = sorted[Math.floor(total * 0.1)]!;
  const hi = sorted[Math.floor(total * 0.9)]!;
  if (hi - lo < MIN_LEVEL_GAP) return false;
  const band = (hi - lo) * LEVEL_BAND;
  let nearLo = 0;
  let nearHi = 0;
  for (const v of lum) {
    if (v <= lo + band) nearLo += 1;
    if (v >= hi - band) nearHi += 1;
  }
  if (nearLo / total < LEVEL_MIN_RATIO || nearHi / total < LEVEL_MIN_RATIO) return false;
  if ((nearLo + nearHi) / total < LEVELS_MIN_RATIO) return false;

  const mid = (lo + hi) / 2;
  const rowRuns: number[] = [];
  const colRuns: number[] = [];
  let rowFlips = 0;
  let colFlips = 0;
  for (let i = 0; i < BLOCK; i += 1) {
    rowFlips += collectRuns(j => lum[i * BLOCK + j]! >= mid, rowRuns);
    colFlips += collectRuns(j => lum[j * BLOCK + i]! >= mid, colRuns);
  }
  if (rowFlips / BLOCK < MIN_FLIPS_PER_LINE || colFlips / BLOCK < MIN_FLIPS_PER_LINE) return false;
  return isRegular(rowRuns) && isRegular(colRuns);
}

/** Appends interior run lengths (edge-truncated runs dropped); returns flip count. */
function collectRuns(high: (j: number) => boolean, out: number[]): number {
  let flips = 0;
  let state = high(0);
  let length = 1;
  let first = true;
  for (let j = 1; j < BLOCK; j += 1) {
    const next = high(j);
    if (next === state) {
      length += 1;
      continue;
    }
    flips += 1;
    if (!first) out.push(length);
    first = false;
    state = next;
    length = 1;
  }
  return flips;
}

/** Painted tiles are squares: most runs share one length; line-art hatching does not. */
function isRegular(runs: number[]): boolean {
  if (runs.length < MIN_RUNS) return false;
  const median = [...runs].sort((a, b) => a - b)[Math.floor(runs.length / 2)]!;
  if (median < RUN_MIN || median > RUN_MAX) return false;
  const tolerance = Math.max(1.5, median * RUN_TOLERANCE);
  const regular = runs.filter(length => Math.abs(length - median) <= tolerance).length;
  return regular / runs.length >= RUN_REGULAR_RATIO;
}
