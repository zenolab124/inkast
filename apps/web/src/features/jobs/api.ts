import type {
  JobRecord,
  JobStatus,
  ListJobsResponse,
  SubmitJobRequest,
  SubmitJobResponse,
} from "@inkast/shared";

export interface JobApiError {
  status: number;
  message: string;
}

async function readError(res: Response): Promise<JobApiError> {
  let message = `HTTP ${res.status}`;
  try {
    const body = (await res.json()) as { message?: string };
    if (body?.message) message = body.message;
  } catch {
    // body not JSON
  }
  return { status: res.status, message };
}

export async function submitGenerateJob(
  req: SubmitJobRequest,
  signal?: AbortSignal,
): Promise<SubmitJobResponse> {
  const res = await fetch("/api/jobs/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
    signal,
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as SubmitJobResponse;
}

export async function listJobs(
  opts?: {
    status?: JobStatus | JobStatus[];
    sinceMs?: number;
    limit?: number;
  },
  signal?: AbortSignal,
): Promise<JobRecord[]> {
  const params = new URLSearchParams();
  if (opts?.status) {
    const arr = Array.isArray(opts.status) ? opts.status : [opts.status];
    params.set("status", arr.join(","));
  }
  if (opts?.sinceMs !== undefined) params.set("since", String(opts.sinceMs));
  if (opts?.limit !== undefined) params.set("limit", String(opts.limit));
  const qs = params.toString();
  const url = qs ? `/api/jobs?${qs}` : "/api/jobs";
  const res = await fetch(url, { signal });
  if (!res.ok) throw await readError(res);
  const body = (await res.json()) as ListJobsResponse;
  return body.jobs;
}

export async function getJob(
  id: string,
  signal?: AbortSignal,
): Promise<JobRecord> {
  const res = await fetch(`/api/jobs/${id}`, { signal });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as JobRecord;
}
