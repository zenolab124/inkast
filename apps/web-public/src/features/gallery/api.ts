import { entries, get } from "idb-keyval";
import type {
  GenerateImageRequest,
  GenerateImageResponse,
  GenerationRecord,
} from "@inkast/shared";
import { generationsStore, imagesStore } from "@/lib/idb";

/**
 * 公开版 Gallery:从 IDB 读历史记录,图片 blob → ObjectURL。
 *
 * generationImageUrl(id) 是同步函数(主线 img src 直接调用),为了能返同步
 * URL,我们用一个内存 Map<id, blob:URL> 缓存。listGenerations 时填充缓存;
 * 缓存命中即同步可拿。这是 page-scope,刷新页面后重新构建,接受这个 leak。
 */

const blobUrlCache = new Map<string, string>();

async function ensureBlobUrl(id: string): Promise<string | null> {
  if (blobUrlCache.has(id)) return blobUrlCache.get(id)!;
  const blob = await get<Blob>(id, imagesStore);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  blobUrlCache.set(id, url);
  return url;
}

/**
 * 主线 generateImage 是"同步生图"path,公开版**不走这条**——所有生图都
 * 通过 jobs.submitGenerateJob 异步走。这里保留 export 是为了 type compat;
 * 真被调到就 throw,避免误用。
 */
export async function generateImage(
  _req: GenerateImageRequest,
  _signal?: AbortSignal,
): Promise<GenerateImageResponse> {
  throw new Error("public version uses jobs.submitGenerateJob; sync generateImage not supported");
}

export async function listGenerations(limit = 100): Promise<GenerationRecord[]> {
  const all = (await entries(generationsStore)) as [IDBValidKey, GenerationRecord][];
  const records = all.map(([, r]) => r).sort((a, b) => b.createdAt - a.createdAt);
  const sliced = records.slice(0, limit);
  // 异步把 blob 缓存预热,这样后续 generationImageUrl(id) 同步能拿到
  await Promise.all(sliced.map(r => ensureBlobUrl(r.id)));
  return sliced;
}

export function generationImageUrl(id: string): string {
  // 命中 = 已经 listGenerations 预热;未命中(直接深链)= 触发异步加载,
  // 暂返空,后续读取流程会重试
  const cached = blobUrlCache.get(id);
  if (cached) return cached;
  // fire-and-forget 预热,下一次 render 再调时就有
  void ensureBlobUrl(id);
  return "";
}

export interface GenerateAttemptFailure {
  providerId: string;
  providerName: string;
  ok: boolean;
  errorCode?: string;
  errorMessage?: string;
  durationMs: number;
}

export interface GenerateError extends Error {
  status?: number;
  attempts?: GenerateAttemptFailure[];
}
