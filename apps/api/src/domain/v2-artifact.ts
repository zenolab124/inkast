import sharp from "sharp";
export class V2ArtifactError extends Error { constructor(public code: string, public status: 400 | 413 = 400) { super(code); } }
/** Shared hard export gates for normal completion and administrator adoption. */
export async function encodeV2Artifact(body: Buffer, statsBaked: boolean) {
  if (body.length > 8 * 1024 * 1024) throw new V2ArtifactError("image_too_large", 413);
  let meta;
  try { meta = await sharp(body, { limitInputPixels: 1280 * 1280 }).metadata(); }
  catch { throw new V2ArtifactError("invalid_image"); }
  if (meta.format !== "png" || meta.width !== 1280 || meta.height !== 1280 || !meta.hasAlpha || (meta.pages ?? 1) > 1) throw new V2ArtifactError("invalid_image");
  const pixels = await sharp(body).ensureAlpha().raw().toBuffer();
  const crop = { left: 128, top: 128, width: 1024, height: 1024 };
  let visible = false;
  for (let y = 0; y < 1280; y++) for (let x = 0; x < 1280; x++) if (pixels[(y * 1280 + x) * 4 + 3]! > 0) {
    visible = true;
    if (x < 128 || y < 128 || x >= 1152 || y >= 1152) throw new V2ArtifactError("delivery_overflow");
  }
  if (!visible) throw new V2ArtifactError("empty_image");
  return { delivered: await sharp(body).extract(crop).webp({ lossless: true, effort: 6 }).toBuffer(),
    geometry: { canvas_width: 1280, canvas_height: 1280, crop, ...(statsBaked ? { stats_baked: true } : {}) } };
}
