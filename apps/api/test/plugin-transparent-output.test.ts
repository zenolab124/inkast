import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";

import { prepareImageForR2 } from "../src/domain/plugin-async/index.js";

const OUTPUT = {
  width: 1024,
  height: 512,
  fit: "contain-alpha" as const,
  paddingPercent: 4,
  alphaThreshold: 12,
  maxCornerAlphaRatio: 0.02,
};

async function toB64(buffer: Buffer): Promise<string> {
  return buffer.toString("base64");
}

test("contain-alpha trims, contains and centers a transparent logo", async () => {
  const source = await sharp({
    create: {
      width: 400,
      height: 240,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{
      input: {
        create: {
          width: 300,
          height: 100,
          channels: 4,
          background: { r: 30, g: 90, b: 60, alpha: 1 },
        },
      },
      left: 50,
      top: 70,
    }])
    .png()
    .toBuffer();

  const output = await prepareImageForR2(await toB64(source), OUTPUT, "image/png");
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.width, 1024);
  assert.equal(metadata.height, 512);
  assert.equal(metadata.hasAlpha, true);

  const corner = await sharp(output).extract({ left: 0, top: 0, width: 40, height: 40 })
    .ensureAlpha()
    .raw()
    .toBuffer();
  for (let index = 3; index < corner.length; index += 4) assert.equal(corner[index], 0);
});

test("contain-alpha rejects an opaque image", async () => {
  const source = await sharp({
    create: {
      width: 200,
      height: 100,
      channels: 3,
      background: { r: 20, g: 20, b: 20 },
    },
  }).png().toBuffer();
  await assert.rejects(
    prepareImageForR2(await toB64(source), OUTPUT, "image/png"),
    /true transparent alpha is required/,
  );
});

test("contain-alpha rejects broad corner alpha contamination", async () => {
  const source = await sharp({
    create: {
      width: 200,
      height: 100,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{
      input: {
        create: {
          width: 20,
          height: 10,
          channels: 4,
          background: { r: 20, g: 20, b: 20, alpha: 0.5 },
        },
      },
      left: 0,
      top: 0,
    }])
    .png()
    .toBuffer();
  await assert.rejects(
    prepareImageForR2(await toB64(source), OUTPUT, "image/png"),
    /corner alpha occupancy/,
  );
});
