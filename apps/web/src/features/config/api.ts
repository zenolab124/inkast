import type {
  ProviderCreateRequest,
  ProviderSummary,
  ProviderUpdateRequest,
} from "@inkast/shared";

export async function listProviders(): Promise<ProviderSummary[]> {
  const res = await fetch("/api/providers");
  if (!res.ok) throw await toError(res, "load providers");
  const body = (await res.json()) as { providers: ProviderSummary[] };
  return body.providers;
}

export async function createProvider(input: ProviderCreateRequest): Promise<ProviderSummary> {
  const res = await fetch("/api/providers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw await toError(res, "create provider");
  return (await res.json()) as ProviderSummary;
}

export async function updateProvider(id: string, patch: ProviderUpdateRequest): Promise<ProviderSummary> {
  const res = await fetch(`/api/providers/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw await toError(res, "update provider");
  return (await res.json()) as ProviderSummary;
}

export async function deleteProvider(id: string): Promise<void> {
  const res = await fetch(`/api/providers/${id}`, { method: "DELETE" });
  if (!res.ok) throw await toError(res, "delete provider");
}

async function toError(res: Response, action: string): Promise<Error> {
  let detail = `HTTP ${res.status}`;
  try {
    const body = (await res.json()) as { message?: string };
    if (body?.message) detail = body.message;
  } catch {}
  return new Error(`${action}: ${detail}`);
}
