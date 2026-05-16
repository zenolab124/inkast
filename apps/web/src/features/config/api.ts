import type {
  CapabilityPatchRequest,
  ProviderCreateRequest,
  ProviderKind,
  ProviderSummary,
  ProviderUpdateRequest,
} from "@inkast/shared";

export async function listProviders(kind?: ProviderKind): Promise<ProviderSummary[]> {
  const url = kind ? `/api/providers?kind=${encodeURIComponent(kind)}` : "/api/providers";
  const res = await fetch(url);
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

export async function patchCapability(
  providerId: string,
  kind: ProviderKind,
  patch: CapabilityPatchRequest,
): Promise<ProviderSummary> {
  const res = await fetch(
    `/api/providers/${providerId}/capabilities/${kind}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    },
  );
  if (!res.ok) throw await toError(res, "update capability");
  return (await res.json()) as ProviderSummary;
}

export async function reorderProviders(
  kind: ProviderKind,
  orderedProviderIds: string[],
): Promise<ProviderSummary[]> {
  const res = await fetch("/api/providers/reorder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, orderedProviderIds }),
  });
  if (!res.ok) throw await toError(res, "reorder providers");
  const body = (await res.json()) as { providers: ProviderSummary[] };
  return body.providers;
}

export async function probeModels(
  input: { providerId: string } | { baseUrl: string; apiKey: string },
): Promise<string[]> {
  const res = await fetch("/api/probe-models", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw await toError(res, "probe models");
  const body = (await res.json()) as { models: string[] };
  return body.models;
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
