import { del, get, set, values } from "idb-keyval";
import type {
  CapabilityPatchRequest,
  ProviderCapability,
  ProviderCreateRequest,
  ProviderKind,
  ProviderSummary,
  ProviderUpdateRequest,
} from "@inkast/shared";
import { providersStore, requestPersistentStorage } from "@/lib/idb";

/**
 * 公开版 provider 配置:全部存浏览器 IndexedDB。主线接口形状照搬,内部
 * 实现换成 IDB,主线 ProviderConfigDialog 组件代码不动。
 *
 * StoredProvider 比 ProviderSummary 多一个 apiKey(明文,反正在用户自己
 * 浏览器),listProviders 出口时 strip 掉换 keyMasked。生图调用层用
 * getProviderWithKey 拿完整凭据。
 */

interface StoredProvider extends ProviderSummary {
  apiKey: string;
}

function newId(): string {
  return typeof crypto?.randomUUID === "function"
    ? crypto.randomUUID()
    : `p_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function mask(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return "*".repeat(key.length);
  return `${key.slice(0, 3)}${"*".repeat(Math.max(3, key.length - 6))}${key.slice(-3)}`;
}

function toSummary(p: StoredProvider): ProviderSummary {
  const { apiKey: _apiKey, ...rest } = p;
  return { ...rest, keyMasked: mask(_apiKey) };
}

async function readAll(): Promise<StoredProvider[]> {
  await requestPersistentStorage();
  return (await values(providersStore)) as StoredProvider[];
}

export async function getProviderWithKey(id: string): Promise<StoredProvider | null> {
  const p = await get<StoredProvider>(id, providersStore);
  return p ?? null;
}

/**
 * 取按 priority 升序、enabled、给定 kind 的第一个 provider(给生图调用层用)。
 * 用法上等价主线 listEnabledCapabilities("image")[0] 那种 fallover 池首位选取。
 */
export async function getFirstEnabledProvider(kind: ProviderKind): Promise<StoredProvider | null> {
  const all = await readAll();
  const matched = all
    .filter(p => p.capabilities.some(c => c.kind === kind && !c.disabled))
    .sort((a, b) => {
      const ap = a.capabilities.find(c => c.kind === kind)?.priority ?? 100;
      const bp = b.capabilities.find(c => c.kind === kind)?.priority ?? 100;
      return ap - bp;
    });
  return matched[0] ?? null;
}

export async function listProviders(kind?: ProviderKind): Promise<ProviderSummary[]> {
  const all = await readAll();
  const filtered = kind ? all.filter(p => p.capabilities.some(c => c.kind === kind)) : all;
  filtered.sort((a, b) => {
    const ap =
      (kind
        ? a.capabilities.find(c => c.kind === kind)?.priority
        : a.capabilities[0]?.priority) ?? 100;
    const bp =
      (kind
        ? b.capabilities.find(c => c.kind === kind)?.priority
        : b.capabilities[0]?.priority) ?? 100;
    return ap - bp;
  });
  return filtered.map(toSummary);
}

export async function createProvider(req: ProviderCreateRequest): Promise<ProviderSummary> {
  const now = Date.now();
  const id = newId();
  const all = await readAll();

  const capabilities: ProviderCapability[] = req.capabilities.map(c => {
    const maxOfKind = Math.max(
      0,
      ...all.flatMap(p => p.capabilities.filter(pc => pc.kind === c.kind).map(pc => pc.priority)),
    );
    return {
      kind: c.kind,
      model: c.model ?? "gpt-image-2",
      priority: maxOfKind + 1,
      disabled: c.disabled ?? false,
      extras: c.extras ?? null,
    };
  });

  const stored: StoredProvider = {
    id,
    name: req.name,
    baseUrl: req.baseUrl,
    apiKey: req.apiKey,
    capabilities,
    keyMasked: mask(req.apiKey),
    createdAt: now,
    updatedAt: now,
  };
  await set(id, stored, providersStore);
  return toSummary(stored);
}

export async function updateProvider(
  id: string,
  patch: ProviderUpdateRequest,
): Promise<ProviderSummary> {
  const existing = await get<StoredProvider>(id, providersStore);
  if (!existing) throw new Error("provider not found");

  const updatedCapabilities: ProviderCapability[] = patch.capabilities
    ? patch.capabilities.map(c => {
        const ec = existing.capabilities.find(e => e.kind === c.kind);
        return {
          kind: c.kind,
          model: c.model ?? ec?.model ?? "gpt-image-2",
          priority: ec?.priority ?? 100,
          disabled: c.disabled ?? ec?.disabled ?? false,
          extras: c.extras ?? ec?.extras ?? null,
        };
      })
    : existing.capabilities;

  const newApiKey = patch.apiKey ?? existing.apiKey;
  const merged: StoredProvider = {
    ...existing,
    name: patch.name ?? existing.name,
    baseUrl: patch.baseUrl ?? existing.baseUrl,
    apiKey: newApiKey,
    capabilities: updatedCapabilities,
    keyMasked: mask(newApiKey),
    updatedAt: Date.now(),
  };
  await set(id, merged, providersStore);
  return toSummary(merged);
}

export async function patchCapability(
  providerId: string,
  kind: ProviderKind,
  patch: CapabilityPatchRequest,
): Promise<ProviderSummary> {
  const existing = await get<StoredProvider>(providerId, providersStore);
  if (!existing) throw new Error("provider not found");
  const updated: StoredProvider = {
    ...existing,
    capabilities: existing.capabilities.map(c =>
      c.kind === kind
        ? {
            ...c,
            model: patch.model ?? c.model,
            disabled: patch.disabled ?? c.disabled,
            extras: patch.extras !== undefined ? patch.extras : c.extras,
          }
        : c,
    ),
    updatedAt: Date.now(),
  };
  await set(providerId, updated, providersStore);
  return toSummary(updated);
}

export async function reorderProviders(
  kind: ProviderKind,
  orderedProviderIds: string[],
): Promise<ProviderSummary[]> {
  for (let i = 0; i < orderedProviderIds.length; i++) {
    const pid = orderedProviderIds[i]!;
    const p = await get<StoredProvider>(pid, providersStore);
    if (!p) continue;
    const updated: StoredProvider = {
      ...p,
      capabilities: p.capabilities.map(c =>
        c.kind === kind ? { ...c, priority: i + 1 } : c,
      ),
      updatedAt: Date.now(),
    };
    await set(pid, updated, providersStore);
  }
  return listProviders(kind);
}

export async function deleteProvider(id: string): Promise<void> {
  await del(id, providersStore);
}

/**
 * 探测可用 model 列表。主线后端调 provider /v1/models;公开版浏览器直接
 * fetch 跨域被 CORS 拦,目前**返空数组**,UI fallback 到手动填 model。
 *
 * 后续如果要支持,可以加公开版后端的 /api/proxy/models endpoint 做透明
 * 代理(类似 /api/gen/passthrough,凭据从请求带,零持久化)。
 */
export async function probeModels(
  _input: { providerId: string } | { baseUrl: string; apiKey: string },
): Promise<string[]> {
  return [];
}
