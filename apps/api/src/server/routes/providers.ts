import { Hono } from "hono";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import OpenAI, { APIError } from "openai";
import type {
  CapabilityInput,
  CapabilityPatchRequest,
  ProviderCreateRequest,
  ProviderUpdateRequest,
  ReorderCapabilitiesRequest,
} from "@inkast/shared";
import { getProviderKey } from "../../storage/providers.js";
import {
  BUILTIN_CLAUDE_CODE_ID,
  createProvider,
  deleteProvider,
  listProviders,
  reorderCapabilities,
  updateCapability,
  updateProvider,
  type ProviderKind,
} from "../../storage/providers.js";

/**
 * Block destructive / shape-changing operations on the built-in ClaudeCode
 * row. Users are allowed to toggle disabled and reorder it via the capability
 * routes, but not edit name/baseUrl/key/delete — those would either break the
 * driver dispatch or pretend it's a normal OpenAI provider.
 */
function guardBuiltin(id: string): void {
  if (id === BUILTIN_CLAUDE_CODE_ID) {
    throw new HTTPException(400, {
      message: "built-in ClaudeCode is read-only; only its priority and disabled state can change",
    });
  }
}

async function readJson<T>(c: Context): Promise<T> {
  try {
    return (await c.req.json()) as T;
  } catch {
    throw new HTTPException(400, { message: "invalid JSON body" });
  }
}

function parseKind(raw: string | undefined): ProviderKind | undefined {
  if (raw === undefined) return undefined;
  if (raw === "image" || raw === "llm") return raw;
  throw new HTTPException(400, { message: `invalid 'kind': ${raw}` });
}

function validateCapabilities(input: CapabilityInput[] | undefined): CapabilityInput[] | undefined {
  if (input === undefined) return undefined;
  if (!Array.isArray(input) || input.length === 0) {
    throw new HTTPException(400, {
      message: "capabilities must be a non-empty array",
    });
  }
  const seen = new Set<ProviderKind>();
  for (const c of input) {
    if (c.kind !== "image" && c.kind !== "llm") {
      throw new HTTPException(400, { message: `invalid capability kind: ${c.kind}` });
    }
    if (seen.has(c.kind)) {
      throw new HTTPException(400, { message: `duplicate capability kind: ${c.kind}` });
    }
    seen.add(c.kind);
  }
  return input;
}

export const providerRoutes = new Hono();

providerRoutes.get("/providers", c => {
  const kind = parseKind(c.req.query("kind"));
  return c.json({ providers: listProviders(kind ? { kind } : {}) });
});

providerRoutes.post("/providers", async c => {
  const body = await readJson<ProviderCreateRequest>(c);
  if (!body.name?.trim() || !body.baseUrl?.trim() || !body.apiKey?.trim()) {
    throw new HTTPException(400, { message: "name, baseUrl and apiKey are required" });
  }
  const capabilities = validateCapabilities(body.capabilities);
  if (!capabilities) {
    throw new HTTPException(400, { message: "capabilities is required" });
  }
  try {
    const created = createProvider({
      name: body.name.trim(),
      baseUrl: body.baseUrl.trim(),
      apiKey: body.apiKey.trim(),
      capabilities,
    });
    return c.json(created, 201);
  } catch (err) {
    if ((err as { code?: string })?.code === "SQLITE_CONSTRAINT_UNIQUE") {
      throw new HTTPException(409, { message: `provider name "${body.name}" already exists` });
    }
    throw err;
  }
});

providerRoutes.patch("/providers/:id", async c => {
  const id = c.req.param("id");
  guardBuiltin(id);
  const body = await readJson<ProviderUpdateRequest>(c);
  const capabilities = validateCapabilities(body.capabilities);

  const updated = updateProvider(id, {
    name: body.name?.trim(),
    baseUrl: body.baseUrl?.trim(),
    apiKey: body.apiKey?.trim() ? body.apiKey.trim() : undefined,
    capabilities,
  });
  if (!updated) throw new HTTPException(404, { message: `provider ${id} not found` });
  return c.json(updated);
});

providerRoutes.patch("/providers/:id/capabilities/:kind", async c => {
  const id = c.req.param("id");
  const kind = parseKind(c.req.param("kind"));
  if (!kind) throw new HTTPException(400, { message: "kind is required" });
  const body = await readJson<CapabilityPatchRequest>(c);

  // Builtin row can only toggle disabled — its model and extras are inert.
  const patch =
    id === BUILTIN_CLAUDE_CODE_ID
      ? { disabled: body.disabled }
      : { model: body.model?.trim(), disabled: body.disabled, extras: body.extras };

  const updated = updateCapability(id, kind, patch);
  if (!updated) {
    throw new HTTPException(404, {
      message: `provider ${id} has no '${kind}' capability`,
    });
  }
  return c.json(updated);
});

providerRoutes.post("/providers/reorder", async c => {
  const body = await readJson<ReorderCapabilitiesRequest>(c);
  const kind = parseKind(body.kind);
  if (!kind) throw new HTTPException(400, { message: "kind is required" });
  if (!Array.isArray(body.orderedProviderIds)) {
    throw new HTTPException(400, { message: "orderedProviderIds must be an array" });
  }
  try {
    reorderCapabilities(kind, body.orderedProviderIds);
    return c.json({ providers: listProviders({ kind }) });
  } catch (err) {
    throw new HTTPException(400, { message: (err as Error).message });
  }
});

providerRoutes.delete("/providers/:id", c => {
  const id = c.req.param("id");
  guardBuiltin(id);
  const ok = deleteProvider(id);
  if (!ok) throw new HTTPException(404, { message: `provider ${id} not found` });
  return c.body(null, 204);
});

/**
 * Probe an OpenAI-compatible endpoint's `GET /v1/models` to enumerate model
 * IDs. Two entry modes:
 *   - { providerId } — use a saved provider's stored baseUrl + apiKey
 *   - { baseUrl, apiKey } — use literals from the form, so the user can probe
 *     before saving
 *
 * Returns flat string IDs (the model name). The frontend filters/sorts; it
 * has no business knowing OpenAI's model.object shape.
 */
providerRoutes.post("/probe-models", async c => {
  const body = await readJson<{
    providerId?: string;
    baseUrl?: string;
    apiKey?: string;
  }>(c);

  let baseUrl: string;
  let apiKey: string;
  if (body.providerId) {
    if (body.providerId === BUILTIN_CLAUDE_CODE_ID) {
      throw new HTTPException(400, {
        message: "built-in ClaudeCode does not expose /v1/models",
      });
    }
    const record = getProviderKey(body.providerId);
    if (!record) throw new HTTPException(404, { message: "provider not found" });
    baseUrl = record.provider.baseUrl;
    apiKey = record.apiKey;
  } else if (body.baseUrl && body.apiKey) {
    baseUrl = body.baseUrl.trim();
    apiKey = body.apiKey.trim();
  } else {
    throw new HTTPException(400, {
      message: "provide either providerId, or both baseUrl and apiKey",
    });
  }

  try {
    const client = new OpenAI({ apiKey, baseURL: baseUrl, timeout: 15_000 });
    const list = await client.models.list();
    const ids = list.data.map(m => m.id).sort();
    return c.json({ models: ids });
  } catch (err) {
    if (err instanceof APIError) {
      const status =
        err.status === 401 || err.status === 403
          ? 401
          : err.status === 404
            ? 404
            : 502;
      throw new HTTPException(status as 401 | 404 | 502, {
        message: `${err.status ?? "?"}: ${err.message}`,
      });
    }
    throw new HTTPException(502, {
      message: `probe failed: ${(err as Error).message}`,
    });
  }
});
