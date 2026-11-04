import assert from "node:assert/strict";
import test from "node:test";

import { detectPaintedCheckerboard } from "../src/domain/plugin-async/painted-checkerboard.js";

type Pixel = (x: number, y: number) => readonly [number, number, number];

function render(width: number, height: number, pixel: Pixel, channels = 3): Uint8Array {
  const data = new Uint8Array(width * height * channels);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = pixel(x, y);
      const offset = (y * width + x) * channels;
      data[offset] = r;
      data[offset + 1] = g;
      data[offset + 2] = b;
      if (channels === 4) data[offset + 3] = 255;
    }
  }
  return data;
}

const checker = (cell: number, light = 255, dark = 204): Pixel => (x, y) => {
  const v = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0 ? light : dark;
  return [v, v, v];
};

// Deterministic PRNG so the "realistic noise" case is reproducible.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

test("full-frame 16px gray/white checkerboard is detected on every block", () => {
  const result = detectPaintedCheckerboard(render(1024, 1536, checker(16)), 1024, 1536, 3);
  assert.equal(result.isCheckerboard, true);
  assert.equal(result.hitCount, 7);
});

test("full-frame 8px checkerboard is detected, including RGBA raw input", () => {
  const rgb = detectPaintedCheckerboard(render(512, 512, checker(8)), 512, 512, 3);
  assert.equal(rgb.isCheckerboard, true);
  assert.equal(rgb.hitCount, 7);
  const rgba = detectPaintedCheckerboard(render(512, 512, checker(8), 4), 512, 512, 4);
  assert.equal(rgba.isCheckerboard, true);
});

test("a checkerboard only around the edges (subject in the middle) is detected", () => {
  const board = checker(16, 250, 210);
  const pixel: Pixel = (x, y) =>
    x > 100 && x < 412 && y > 100 && y < 412 ? [200, 40, 60] : board(x, y);
  const result = detectPaintedCheckerboard(render(512, 512, pixel), 512, 512, 3);
  assert.equal(result.isCheckerboard, true);
});

test("solid white, solid gray and solid colour images are not checkerboards", () => {
  for (const colour of [[255, 255, 255], [204, 204, 204], [30, 120, 200]] as const) {
    const result = detectPaintedCheckerboard(render(256, 256, () => colour), 256, 256, 3);
    assert.equal(result.isCheckerboard, false, `colour ${colour.join(",")}`);
    assert.equal(result.hitCount, 0);
  }
});

test("smooth neutral gradients are not checkerboards", () => {
  const horizontal: Pixel = x => { const v = clamp(175 + (x / 511) * 80); return [v, v, v]; };
  const vertical: Pixel = (_x, y) => { const v = clamp(175 + (y / 511) * 80); return [v, v, v]; };
  for (const pixel of [horizontal, vertical]) {
    const result = detectPaintedCheckerboard(render(512, 512, pixel), 512, 512, 3);
    assert.equal(result.hitCount, 0);
  }
});

test("realistic noisy illustration-like images are not checkerboards", () => {
  const rand = mulberry32(42);
  // Coloured scene with sensor-like noise.
  const scene: Pixel = (x, y) => [
    clamp(120 + 60 * Math.sin(x / 40) + (rand() - 0.5) * 40),
    clamp(90 + 50 * Math.cos(y / 55) + (rand() - 0.5) * 40),
    clamp(140 + 40 * Math.sin((x + y) / 70) + (rand() - 0.5) * 40),
  ];
  assert.equal(detectPaintedCheckerboard(render(768, 1024, scene), 768, 1024, 3).hitCount, 0);
  // Bright paper-like neutral background with per-pixel noise straddling the
  // bright/gray thresholds — noise alone must not pass the gray-ratio gate.
  const paper: Pixel = () => { const v = clamp(240 + (rand() - 0.5) * 20); return [v, v, v]; };
  assert.equal(detectPaintedCheckerboard(render(512, 512, paper), 512, 512, 3).isCheckerboard, false);
});

test("a checkerboard in only one corner is not enough", () => {
  const board = checker(16);
  const pixel: Pixel = (x, y) => (x < 64 && y < 64 ? board(x, y) : [40, 90, 160]);
  const result = detectPaintedCheckerboard(render(512, 512, pixel), 512, 512, 3);
  assert.equal(result.hitCount, 1);
  assert.deepEqual(result.hits, ["top-left"]);
  assert.equal(result.isCheckerboard, false);
});

test("images smaller than a block are skipped instead of reading out of bounds", () => {
  const result = detectPaintedCheckerboard(render(40, 40, checker(8)), 40, 40, 3);
  assert.equal(result.hitCount, 0);
  assert.equal(result.isCheckerboard, false);
});

test("dark gray checkerboard (observed ~130/195 tiles) is detected", () => {
  const result = detectPaintedCheckerboard(render(1063, 1479, checker(13, 195, 130)), 1063, 1479, 3);
  assert.equal(result.isCheckerboard, true);
  assert.equal(result.hitCount, 7);
});

test("grayscale line-art hatching with irregular strokes is not a checkerboard", () => {
  const rand = mulberry32(7);
  // Irregular vertical strokes plus a few horizontal ones: two gray levels and
  // plenty of flips, but run lengths vary widely unlike square tiles.
  const xs: number[] = [];
  for (let x = 0; x < 512; ) { const w = 1 + Math.floor(rand() * 9); xs.push(...Array(w).fill(rand() < 0.5 ? 60 : 235)); x += w; }
  const pixel: Pixel = (x, y) => {
    const v = y % 37 < 2 ? 60 : xs[x]!;
    return [v, v, v];
  };
  const result = detectPaintedCheckerboard(render(512, 512, pixel), 512, 512, 3);
  assert.equal(result.isCheckerboard, false);
});
