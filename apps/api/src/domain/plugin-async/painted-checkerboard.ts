/**
 * Detects a "transparency checkerboard" that an upstream model PAINTED into an
 * opaque RGB image (gray/white tiles along corners and edges, no real alpha).
 *
 * Pure function over raw pixels so it can be unit-tested without sharp.
 * Thresholds were validated on 495 real plugin outputs: the 4 known
 * checkerboard images hit 3–6 blocks, every ordinary image hit 0.
 */

export const PAINTED_CHECKERBOARD_ERROR_CODE = "painted_transparency_checkerboard" as const;

const BLOCK = 48;
const EDGE_INSET = 4;
const NEUTRAL_MAX_SPREAD = 12;
const NEUTRAL_MIN_RATIO = 0.9;
const BRIGHT_MIN_LUM = 238;
const GRAY_MIN_LUM = 175;
const GRAY_MAX_LUM = 232; // exclusive
const BRIGHT_MIN_RATIO = 0.2;
const GRAY_MIN_RATIO = 0.2;
const STATE_HIGH_LUM = 235;
const STATE_LOW_LUM = 232; // lum < this → low state
const MIN_FLIPS_PER_ROW = 2;
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
  let neutral = 0;
  let bright = 0;
  let gray = 0;
  let flips = 0;
  for (let y = y0; y < y0 + BLOCK; y += 1) {
    let state: 0 | 1 | null = null;
    for (let x = x0; x < x0 + BLOCK; x += 1) {
      const offset = (y * width + x) * channels;
      const r = data[offset]!;
      const g = data[offset + 1]!;
      const b = data[offset + 2]!;
      if (Math.max(r, g, b) - Math.min(r, g, b) < NEUTRAL_MAX_SPREAD) neutral += 1;
      const lum = (r + g + b) / 3;
      if (lum >= BRIGHT_MIN_LUM) bright += 1;
      else if (lum >= GRAY_MIN_LUM && lum < GRAY_MAX_LUM) gray += 1;
      const next: 0 | 1 | null = lum >= STATE_HIGH_LUM ? 1 : lum < STATE_LOW_LUM ? 0 : state;
      if (state !== null && next !== state) flips += 1;
      state = next;
    }
  }
  const total = BLOCK * BLOCK;
  return (
    neutral / total >= NEUTRAL_MIN_RATIO &&
    bright / total >= BRIGHT_MIN_RATIO &&
    gray / total >= GRAY_MIN_RATIO &&
    flips / BLOCK >= MIN_FLIPS_PER_ROW
  );
}
