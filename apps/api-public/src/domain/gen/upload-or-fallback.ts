import { putImage } from "../../drivers/r2.js";
import { loadR2Config, publicUrlForKey } from "./r2-config.js";

/**
 * 把 driver 返回的 b64 图片数组,要么上 R2 返 URL 列表,要么 R2 未配/失败时
 * fallback 返 b64 原文(本地 dev 友好,前端字段名 union)。
 *
 * R2 上传失败不抛错—— Phase 1 想法是"R2 是优化、不是必需",失败降级 b64,
 * 浏览器一样能用。生产 jdc 上线后 R2 配置缺失才是问题,要靠监控/启动检查
 * 来兜底,不是把单次生图请求 fail 掉。
 */
export interface UploadOrFallbackInput {
  /** Driver 返回的 b64 原文数组 */
  b64Images: string[];
  /** 用于组装 R2 key 的 task id(每张图加索引后缀) */
  taskId: string;
  /** 用户 id */
  userId: number;
}

export interface UploadedImage {
  url: string | null;
  b64: string | null;
}

export async function uploadOrFallback(input: UploadOrFallbackInput): Promise<UploadedImage[]> {
  const cfg = loadR2Config();
  if (!cfg.enabled) {
    return input.b64Images.map(b => ({ url: null, b64: b }));
  }

  const results: UploadedImage[] = [];
  for (let i = 0; i < input.b64Images.length; i++) {
    const b64 = input.b64Images[i]!;
    const buffer = Buffer.from(b64, "base64");
    const key = `${cfg.keyPrefix}${input.userId}/${input.taskId}${input.b64Images.length > 1 ? `-${i}` : ""}.png`;
    try {
      await putImage({
        bucket: cfg.bucket,
        key,
        body: buffer,
        contentType: "image/png",
      });
      results.push({ url: publicUrlForKey(key), b64: null });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[r2-fallback] upload failed, returning b64: ${msg}`);
      results.push({ url: null, b64 });
    }
  }
  return results;
}
