import { Hono } from "hono";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  createProvider,
  deleteProvider,
  listProviders,
  updateProvider,
  type ProviderInput,
  type ProviderPatch,
} from "../../storage/providers.js";

async function readJson<T>(c: Context): Promise<T> {
  try {
    return (await c.req.json()) as T;
  } catch {
    throw new HTTPException(400, { message: "invalid JSON body" });
  }
}

export const providerRoutes = new Hono();

providerRoutes.get("/providers", c => {
  return c.json({ providers: listProviders() });
});

providerRoutes.post("/providers", async c => {
  const body = await readJson<ProviderInput>(c);
  if (!body.name?.trim() || !body.baseUrl?.trim() || !body.apiKey?.trim()) {
    throw new HTTPException(400, { message: "name, baseUrl and apiKey are required" });
  }
  try {
    const created = createProvider({
      name: body.name.trim(),
      baseUrl: body.baseUrl.trim(),
      apiKey: body.apiKey.trim(),
      model: body.model?.trim() || undefined,
      priority: body.priority,
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
  const body = await readJson<ProviderPatch>(c);
  const patch: ProviderPatch = {};
  if (body.name !== undefined) patch.name = body.name.trim();
  if (body.baseUrl !== undefined) patch.baseUrl = body.baseUrl.trim();
  if (body.model !== undefined) patch.model = body.model.trim();
  if (body.priority !== undefined) patch.priority = body.priority;
  if (body.apiKey !== undefined && body.apiKey.trim()) patch.apiKey = body.apiKey.trim();

  const updated = updateProvider(id, patch);
  if (!updated) throw new HTTPException(404, { message: `provider ${id} not found` });
  return c.json(updated);
});

providerRoutes.delete("/providers/:id", c => {
  const id = c.req.param("id");
  const ok = deleteProvider(id);
  if (!ok) throw new HTTPException(404, { message: `provider ${id} not found` });
  return c.body(null, 204);
});
