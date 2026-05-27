import type {
  GenerateImageRequest,
  GenerateImageResponse,
  GenerationRecord,
} from "@inkast/shared";

export async function generateImage(
  req: GenerateImageRequest,
  signal?: AbortSignal,
): Promise<GenerateImageResponse> {
  const res = await fetch("/api/generate-image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
    signal,
  });
  if (!res.ok) throw await toError(res, "generate image");
  return (await res.json()) as GenerateImageResponse;
}

export async function listGenerations(limit = 100): Promise<GenerationRecord[]> {
  const res = await fetch(`/api/generations?limit=${limit}`);
  if (!res.ok) throw await toError(res, "load generations");
  const body = (await res.json()) as { generations: GenerationRecord[] };
  return body.generations;
}

export function generationImageUrl(id: string): string {
  return `/api/generations/${id}/image`;
}

async function toError(res: Response, action: string): Promise<Error> {
  let detail = `HTTP ${res.status}`;
  let attempts: GenerateAttemptFailure[] | undefined;
  try {
    const body = (await res.json()) as {
      message?: string;
      error?: string;
      attempts?: GenerateAttemptFailure[];
    };
    if (body?.message) detail = body.message;
    if (body?.error) detail = `${body.error}: ${detail}`;
    if (body?.attempts) attempts = body.attempts;
  } catch {}
  const err = new Error(`${action}: ${detail}`) as GenerateError;
  err.status = res.status;
  err.attempts = attempts;
  return err;
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
