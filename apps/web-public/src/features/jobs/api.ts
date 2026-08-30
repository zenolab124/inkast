import { entries, get, set } from "idb-keyval";
import type {
  GenerateImageAttempt,
  GenerationRecord,
  JobRecord,
  JobStatus,
  SubmitJobRequest,
  SubmitJobResponse,
} from "@inkast/shared";
import {
  generationsStore,
  imagesStore,
  jobsStore,
  requestPersistentStorage,
} from "@/lib/idb";
import { getFirstEnabledProvider } from "../config/api.js";

/**
 * 公开版 jobs:全部走浏览器 IDB + 公开版生图 endpoint。
 *
 * useJobs hook 是 polling 模型(每 2s listJobs(['pending','running'])),
 * 公开版 submitGenerateJob fire-and-forget:写 IDB pending 即返,后台异步
 * 调 /api/gen/passthrough 或 /api/gen/builtin,完成后 update IDB 状态。
 * useJobs polling tick 发现 pending 消失 → getJob 拿最终状态 → 触发 callback。
 *
 * Provider 选择:
 *   - IDB 有 enabled image provider → /api/gen/passthrough(带凭据,不扣余额)
 *   - 没有 → /api/gen/builtin(扣余额,需登录)
 */

export interface JobApiError {
  status: number;
  message: string;
}

function newJobId(): string {
  return typeof crypto?.randomUUID === "function"
    ? crypto.randomUUID()
    : `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function submitGenerateJob(
  req: SubmitJobRequest,
  _signal?: AbortSignal,
): Promise<SubmitJobResponse> {
  await requestPersistentStorage();
  const jobId = newJobId();
  const now = Date.now();
  const placeholder: JobRecord = {
    id: jobId,
    kind: "image_generate",
    status: "pending",
    promptSnapshot: req.prompt,
    promptText: req.rawPrompt ?? JSON.stringify(req.prompt),
    isRaw: !!req.rawPrompt,
    size: req.size ?? "1024x1024",
    quality: req.quality ?? "high",
    generationId: null,
    attempts: [],
    errorCode: null,
    errorMessage: null,
    providerId: null,
    providerName: null,
    createdAt: now,
    startedAt: now,
    completedAt: null,
  };
  await set(jobId, placeholder, jobsStore);

  // fire-and-forget;polling tick 看到状态变化触发 callback
  void runJob(jobId, placeholder, req);

  return { jobId, status: "pending" };
}

async function runJob(jobId: string, job: JobRecord, req: SubmitJobRequest): Promise<void> {
  try {
    const provider = await getFirstEnabledProvider("image");
    const promptText = req.rawPrompt ?? JSON.stringify(req.prompt);
    const channel: "passthrough" | "builtin" = provider ? "passthrough" : "builtin";
    const endpoint = provider ? "/api/gen/passthrough" : "/api/gen/builtin";

    const imageCap = provider?.capabilities.find(c => c.kind === "image");
    const useCodex = imageCap?.extras &&
      (imageCap.extras as Record<string, unknown>).useCodexHeader === true;

    const body = provider
      ? {
          provider: {
            baseUrl: provider.baseUrl,
            apiKey: provider.apiKey,
            model: imageCap?.model ?? "gpt-image-2",
            useCodexHeader: !!useCodex,
          },
          prompt: promptText,
          options: { size: req.size },
        }
      : {
          prompt: promptText,
          options: { size: req.size },
        };

    const r = await fetch(endpoint, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = (await r.json().catch(() => null)) as
      | {
          ok?: boolean;
          task_id?: string;
          images?: { url: string | null; b64: string | null }[];
          duration_ms?: number;
          prompt_text?: string;
          error?: string;
          message?: string;
        }
      | null;

    if (!r.ok || !j?.ok || !j.images?.[0]) {
      const attempt: GenerateImageAttempt = {
        providerId: provider?.id ?? "builtin",
        providerName: provider?.name ?? "builtin",
        ok: false,
        errorCode: j?.error ?? `http_${r.status}`,
        errorMessage: j?.message ?? `HTTP ${r.status}`,
        durationMs: j?.duration_ms ?? 0,
      };
      const failed: JobRecord = {
        ...job,
        status: "failed",
        attempts: [attempt],
        errorCode: attempt.errorCode ?? null,
        errorMessage: attempt.errorMessage ?? null,
        completedAt: Date.now(),
      };
      await set(jobId, failed, jobsStore);
      return;
    }

    // success — 把图片落 IDB,建 generation 记录
    const image = j.images[0];
    const blob = await imageToBlob(image);
    const generationId = j.task_id ?? jobId;
    await set(generationId, blob, imagesStore);

    const generation: GenerationRecord = {
      id: generationId,
      promptSnapshot: req.prompt,
      promptText,
      finalPromptText: j.prompt_text ?? null,
      imagePath: `idb:${generationId}`, // 标记浏览器 IDB,实际 URL 在 gallery/api.ts 现场 createObjectURL
      imageUrl: null,
      imageFormat: "png",
      size: req.size ?? "1024x1024",
      quality: req.quality ?? "high",
      providerId: provider?.id ?? null,
      durationMs: j.duration_ms ?? null,
      createdAt: Date.now(),
      prose: req.rawPrompt ?? null,
      aiFilledFields: req.aiFilledFields ?? null,
    };
    await set(generationId, generation, generationsStore);

    const succeeded: JobRecord = {
      ...job,
      status: "succeeded",
      generationId,
      providerId: provider?.id ?? null,
      providerName: provider?.name ?? "builtin",
      attempts: [
        {
          providerId: provider?.id ?? "builtin",
          providerName: provider?.name ?? "builtin",
          ok: true,
          durationMs: j.duration_ms ?? 0,
        },
      ],
      completedAt: Date.now(),
    };
    await set(jobId, succeeded, jobsStore);
  } catch (err) {
    console.error(`[jobs] runJob ${jobId} failed:`, err);
    const failed: JobRecord = {
      ...job,
      status: "failed",
      errorCode: "network_error",
      errorMessage: err instanceof Error ? err.message : String(err),
      completedAt: Date.now(),
    };
    await set(jobId, failed, jobsStore);
  }
}

async function imageToBlob(image: { url: string | null; b64: string | null }): Promise<Blob> {
  if (image.url) {
    const res = await fetch(image.url);
    return await res.blob();
  }
  if (image.b64) {
    const bytes = Uint8Array.from(atob(image.b64), c => c.charCodeAt(0));
    return new Blob([bytes], { type: "image/png" });
  }
  throw new Error("image has neither url nor b64");
}

export async function listJobs(
  opts?: { status?: JobStatus | JobStatus[]; sinceMs?: number; limit?: number },
  _signal?: AbortSignal,
): Promise<JobRecord[]> {
  const all = (await entries(jobsStore)) as [IDBValidKey, JobRecord][];
  let jobs = all.map(([, j]) => j);
  if (opts?.status) {
    const statuses = new Set(Array.isArray(opts.status) ? opts.status : [opts.status]);
    jobs = jobs.filter(j => statuses.has(j.status));
  }
  if (opts?.sinceMs !== undefined) {
    const since = opts.sinceMs;
    jobs = jobs.filter(j => j.createdAt >= since);
  }
  jobs.sort((a, b) => b.createdAt - a.createdAt);
  if (opts?.limit !== undefined) jobs = jobs.slice(0, opts.limit);
  return jobs;
}

export async function getJob(id: string, _signal?: AbortSignal): Promise<JobRecord> {
  const job = await get<JobRecord>(id, jobsStore);
  if (!job) throw { status: 404, message: "job not found" } satisfies JobApiError;
  return job;
}
