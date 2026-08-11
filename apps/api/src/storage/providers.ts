import { randomUUID } from "node:crypto";
import { BUILTIN_CLAUDE_CODE_ID, db } from "./db.js";
import { decryptSecret, encryptSecret, maskKey } from "./crypto.js";

export { BUILTIN_CLAUDE_CODE_ID };

export type ProviderKind = "image" | "llm";

export interface ProviderCapability {
  kind: ProviderKind;
  model: string;
  priority: number;
  disabled: boolean;
  extras: Record<string, unknown> | null;
}

export interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  createdAt: number;
  updatedAt: number;
  capabilities: ProviderCapability[];
}

export interface ProviderWithMaskedKey extends Provider {
  keyMasked: string;
}

export interface CapabilityInput {
  kind: ProviderKind;
  model?: string;
  disabled?: boolean;
  extras?: Record<string, unknown> | null;
}

export interface ProviderInput {
  name: string;
  baseUrl: string;
  apiKey: string;
  capabilities: CapabilityInput[];
}

export interface CapabilityPatch {
  model?: string;
  disabled?: boolean;
  extras?: Record<string, unknown> | null;
}

export interface ProviderPatch {
  name?: string;
  baseUrl?: string;
  apiKey?: string;
  /** When provided, REPLACES the set of capabilities. Each entry's priority is
   *  appended to the end of its kind's order if the capability is new. */
  capabilities?: CapabilityInput[];
}

interface ProviderRow {
  id: string;
  name: string;
  base_url: string;
  key_ciphertext: Buffer;
  key_iv: Buffer;
  key_tag: Buffer;
  created_at: number;
  updated_at: number;
}

interface CapabilityRow {
  provider_id: string;
  kind: string;
  model: string;
  priority: number;
  disabled: number;
  extras: string | null;
}

const PROVIDER_COLS = `id, name, base_url,
  key_ciphertext, key_iv, key_tag, created_at, updated_at`;

function parseExtras(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function serializeExtras(extras: Record<string, unknown> | null | undefined): string | null {
  if (!extras) return null;
  return Object.keys(extras).length === 0 ? null : JSON.stringify(extras);
}

function rowToCapability(row: CapabilityRow): ProviderCapability {
  return {
    kind: (row.kind === "llm" ? "llm" : "image") as ProviderKind,
    model: row.model,
    priority: row.priority,
    disabled: row.disabled === 1,
    extras: parseExtras(row.extras),
  };
}

function defaultModelFor(kind: ProviderKind): string {
  return kind === "llm" ? "gpt-4o-mini" : "gpt-image-2";
}

/**
 * Compute epoch-ms of the NEXT 06:00 Beijing time strictly after `from`.
 * If current Beijing hour < 6, returns today 06:00; otherwise tomorrow 06:00.
 * Beijing is UTC+8 with no DST, so the math is direct on UTC.
 */
export function nextBeijing6amTimestamp(from: number = Date.now()): number {
  const BEIJING_OFFSET_MS = 8 * 3600 * 1000;
  const beijing = new Date(from + BEIJING_OFFSET_MS);
  const y = beijing.getUTCFullYear();
  const m = beijing.getUTCMonth();
  const d = beijing.getUTCDate();
  const h = beijing.getUTCHours();
  // Pick today vs tomorrow (Beijing date), then convert back to UTC ms.
  const targetDay = h < 6 ? d : d + 1;
  return Date.UTC(y, m, targetDay, 6, 0, 0) - BEIJING_OFFSET_MS;
}

/**
 * Mark a capability auto-disabled until the next 06:00 Beijing time. Used by
 * the image driver when upstream signals quota/balance exhausted — no point
 * burning more attempts before the daily reset. Manual Web UI toggle clears
 * `auto_disabled_until` so users can re-enable immediately after a top-up.
 */
export function markCapabilityAutoDisabledUntilNext6am(
  providerId: string,
  kind: ProviderKind,
): void {
  const until = nextBeijing6amTimestamp();
  db()
    .prepare(
      `UPDATE provider_capabilities
       SET disabled = 1, auto_disabled_until = ?
       WHERE provider_id = ? AND kind = ?`,
    )
    .run(until, providerId, kind);
  console.log(
    `[provider] auto-disabled ${providerId} ${kind} until ${new Date(until).toISOString()} (quota exhausted) — will re-enable at next Beijing 06:00`,
  );
}

/**
 * Cleanup pass: any auto-disabled rows whose `auto_disabled_until` has
 * elapsed are flipped back to enabled (disabled=0, auto_disabled_until=NULL).
 * Called at the top of read paths that consume the enabled pool so DB state
 * stays in sync with logical state without a separate cron.
 */
function reclaimExpiredAutoDisables(): void {
  db()
    .prepare(
      `UPDATE provider_capabilities
       SET disabled = 0, auto_disabled_until = NULL
       WHERE auto_disabled_until IS NOT NULL AND auto_disabled_until <= ?`,
    )
    .run(Date.now());
}

function loadCapabilitiesFor(providerIds: string[]): Map<string, ProviderCapability[]> {
  const out = new Map<string, ProviderCapability[]>();
  for (const id of providerIds) out.set(id, []);
  if (providerIds.length === 0) return out;

  const placeholders = providerIds.map(() => "?").join(",");
  const rows = db()
    .prepare(
      `SELECT provider_id, kind, model, priority, disabled, extras
       FROM provider_capabilities
       WHERE provider_id IN (${placeholders})
       ORDER BY kind, priority ASC`,
    )
    .all(...providerIds) as CapabilityRow[];

  for (const row of rows) {
    const list = out.get(row.provider_id);
    if (list) list.push(rowToCapability(row));
  }
  return out;
}

function rowToProvider(row: ProviderRow, caps: ProviderCapability[]): Provider {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    capabilities: caps,
  };
}

function rowToMasked(row: ProviderRow, caps: ProviderCapability[]): ProviderWithMaskedKey {
  const plain = decryptSecret({
    ciphertext: row.key_ciphertext,
    iv: row.key_iv,
    tag: row.key_tag,
  });
  return { ...rowToProvider(row, caps), keyMasked: maskKey(plain) };
}

export interface ListProvidersOptions {
  kind?: ProviderKind;
}

export interface ListEnabledCapabilitiesOptions {
  /**
   * Optional exact provider-ID scope. `undefined` reads the legacy full pool;
   * an explicit empty list returns no rows. Filtering in SQL ensures keys for
   * providers outside a caller's allowlist are not decrypted unnecessarily.
   */
  providerIds?: readonly string[];
}

/**
 * List providers. With no options, returns ALL providers with their full
 * capability set. With `kind`, returns only providers that have a capability
 * of that kind — but the returned `capabilities` array is still complete
 * (callers wanting a single-kind view can re-filter).
 */
export function listProviders(opts: ListProvidersOptions = {}): ProviderWithMaskedKey[] {
  const where = opts.kind
    ? `WHERE EXISTS (
         SELECT 1 FROM provider_capabilities pc
         WHERE pc.provider_id = providers.id AND pc.kind = ?
       )`
    : "";
  const params = opts.kind ? [opts.kind] : [];
  const rows = db()
    .prepare(
      `SELECT ${PROVIDER_COLS}
       FROM providers
       ${where}
       ORDER BY created_at ASC`,
    )
    .all(...params) as ProviderRow[];

  const ids = rows.map(r => r.id);
  const caps = loadCapabilitiesFor(ids);
  return rows.map(r => rowToMasked(r, caps.get(r.id) ?? []));
}

export function getProviderKey(id: string): { provider: Provider; apiKey: string } | null {
  const row = db()
    .prepare(`SELECT ${PROVIDER_COLS} FROM providers WHERE id = ?`)
    .get(id) as ProviderRow | undefined;
  if (!row) return null;
  const caps = loadCapabilitiesFor([id]).get(id) ?? [];
  return {
    provider: rowToProvider(row, caps),
    apiKey: decryptSecret({
      ciphertext: row.key_ciphertext,
      iv: row.key_iv,
      tag: row.key_tag,
    }),
  };
}

/**
 * For driver pools: returns rows in (kind, priority asc) order, capabilities
 * filtered to the requested kind, with disabled rows excluded. Each entry
 * carries the resolved `apiKey` so callers don't re-decrypt.
 */
export function listEnabledCapabilities(
  kind: ProviderKind,
  opts: ListEnabledCapabilitiesOptions = {},
): Array<{
  provider: Provider;
  capability: ProviderCapability;
  apiKey: string;
}> {
  // Reclaim expired auto-disables before reading the pool, so a capability
  // that hit quota yesterday is back in rotation today without manual touch.
  reclaimExpiredAutoDisables();
  if (opts.providerIds !== undefined && opts.providerIds.length === 0) return [];
  const providerIds = opts.providerIds === undefined
    ? undefined
    : [...new Set(opts.providerIds)];
  const providerScope = providerIds
    ? `AND p.id IN (${providerIds.map(() => "?").join(",")})`
    : "";
  const rows = db()
    .prepare(
      `SELECT p.id, p.name, p.base_url,
              p.key_ciphertext, p.key_iv, p.key_tag,
              p.created_at, p.updated_at,
              pc.kind, pc.model, pc.priority, pc.disabled, pc.extras
       FROM providers p
       JOIN provider_capabilities pc ON pc.provider_id = p.id
       WHERE pc.kind = ? AND pc.disabled = 0
       ${providerScope}
       ORDER BY pc.priority ASC, p.created_at ASC`,
    )
    .all(kind, ...(providerIds ?? [])) as Array<
      ProviderRow & CapabilityRow & { provider_id?: string }
    >;

  return rows.map(row => {
    const capability = rowToCapability({
      provider_id: row.id,
      kind: row.kind,
      model: row.model,
      priority: row.priority,
      disabled: row.disabled,
      extras: row.extras,
    });
    return {
      provider: rowToProvider(row, [capability]),
      capability,
      apiKey: decryptSecret({
        ciphertext: row.key_ciphertext,
        iv: row.key_iv,
        tag: row.key_tag,
      }),
    };
  });
}

/**
 * Find a (provider, capability, apiKey) tuple for one provider in a specific
 * kind. Used by the LLM driver, which is dispatched by providerId.
 */
export function getProviderCapability(
  id: string,
  kind: ProviderKind,
): { provider: Provider; capability: ProviderCapability; apiKey: string } | null {
  const row = db()
    .prepare(
      `SELECT p.id, p.name, p.base_url,
              p.key_ciphertext, p.key_iv, p.key_tag,
              p.created_at, p.updated_at,
              pc.kind, pc.model, pc.priority, pc.disabled, pc.extras
       FROM providers p
       JOIN provider_capabilities pc ON pc.provider_id = p.id
       WHERE p.id = ? AND pc.kind = ?`,
    )
    .get(id, kind) as (ProviderRow & CapabilityRow) | undefined;
  if (!row) return null;
  const capability = rowToCapability({
    provider_id: row.id,
    kind: row.kind,
    model: row.model,
    priority: row.priority,
    disabled: row.disabled,
    extras: row.extras,
  });
  return {
    provider: rowToProvider(row, [capability]),
    capability,
    apiKey: decryptSecret({
      ciphertext: row.key_ciphertext,
      iv: row.key_iv,
      tag: row.key_tag,
    }),
  };
}

function nextPriorityFor(kind: ProviderKind): number {
  const row = db()
    .prepare(
      `SELECT COALESCE(MAX(priority), 0) AS max_priority
       FROM provider_capabilities WHERE kind = ?`,
    )
    .get(kind) as { max_priority: number };
  return row.max_priority + 1;
}

export function createProvider(input: ProviderInput): ProviderWithMaskedKey {
  if (!input.capabilities || input.capabilities.length === 0) {
    throw new Error("provider needs at least one capability (image or llm)");
  }
  const seenKinds = new Set<ProviderKind>();
  for (const c of input.capabilities) {
    if (seenKinds.has(c.kind)) throw new Error(`duplicate capability for kind '${c.kind}'`);
    seenKinds.add(c.kind);
  }

  const now = Date.now();
  const id = randomUUID();
  const { ciphertext, iv, tag } = encryptSecret(input.apiKey);

  const insertProvider = db().prepare(
    `INSERT INTO providers
     (id, name, base_url, key_ciphertext, key_iv, key_tag, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertCap = db().prepare(
    `INSERT INTO provider_capabilities
     (provider_id, kind, model, priority, disabled, extras)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  const tx = db().transaction(() => {
    insertProvider.run(id, input.name, input.baseUrl, ciphertext, iv, tag, now, now);
    for (const c of input.capabilities) {
      const priority = nextPriorityFor(c.kind);
      insertCap.run(
        id,
        c.kind,
        c.model ?? defaultModelFor(c.kind),
        priority,
        c.disabled ? 1 : 0,
        serializeExtras(c.extras),
      );
    }
  });
  tx();

  return loadOrThrow(id);
}

export function updateProvider(
  id: string,
  patch: ProviderPatch,
): ProviderWithMaskedKey | null {
  const existing = getProviderKey(id);
  if (!existing) return null;

  const now = Date.now();
  const mergedName = patch.name ?? existing.provider.name;
  const mergedBaseUrl = patch.baseUrl ?? existing.provider.baseUrl;
  const enc = patch.apiKey ? encryptSecret(patch.apiKey) : null;

  const updateProviderStmt = enc
    ? db().prepare(
        `UPDATE providers
         SET name = ?, base_url = ?,
             key_ciphertext = ?, key_iv = ?, key_tag = ?,
             updated_at = ?
         WHERE id = ?`,
      )
    : db().prepare(
        `UPDATE providers SET name = ?, base_url = ?, updated_at = ? WHERE id = ?`,
      );

  const tx = db().transaction(() => {
    if (enc) {
      updateProviderStmt.run(mergedName, mergedBaseUrl, enc.ciphertext, enc.iv, enc.tag, now, id);
    } else {
      updateProviderStmt.run(mergedName, mergedBaseUrl, now, id);
    }

    if (patch.capabilities) {
      replaceCapabilitiesInline(id, patch.capabilities, existing.provider.capabilities);
    }
  });
  tx();

  return loadOrThrow(id);
}

/**
 * Diff patch.capabilities against the existing capability set:
 * - Existing kinds present in the patch → update model/disabled/extras
 * - Existing kinds NOT in the patch → delete
 * - New kinds in the patch → insert with next priority for that kind
 *
 * Priority is preserved for kept rows. Reordering goes through reorder().
 */
function replaceCapabilitiesInline(
  providerId: string,
  patch: CapabilityInput[],
  existing: ProviderCapability[],
): void {
  const existingByKind = new Map(existing.map(c => [c.kind, c]));
  const patchByKind = new Map(patch.map(c => [c.kind, c]));

  const deleteStmt = db().prepare(
    `DELETE FROM provider_capabilities WHERE provider_id = ? AND kind = ?`,
  );
  const updateStmt = db().prepare(
    `UPDATE provider_capabilities
     SET model = ?, disabled = ?, extras = ?, auto_disabled_until = NULL
     WHERE provider_id = ? AND kind = ?`,
  );
  const insertStmt = db().prepare(
    `INSERT INTO provider_capabilities (provider_id, kind, model, priority, disabled, extras)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  for (const cap of existing) {
    if (!patchByKind.has(cap.kind)) {
      deleteStmt.run(providerId, cap.kind);
    }
  }
  for (const cap of patch) {
    const prev = existingByKind.get(cap.kind);
    const model = cap.model ?? prev?.model ?? defaultModelFor(cap.kind);
    const disabled = cap.disabled !== undefined ? (cap.disabled ? 1 : 0) : prev?.disabled ? 1 : 0;
    const extrasJson = serializeExtras(cap.extras !== undefined ? cap.extras : prev?.extras ?? null);
    if (prev) {
      updateStmt.run(model, disabled, extrasJson, providerId, cap.kind);
    } else {
      const priority = nextPriorityFor(cap.kind);
      insertStmt.run(providerId, cap.kind, model, priority, disabled, extrasJson);
    }
  }
}

/** Patch just one capability of a provider (model/disabled/extras). */
export function updateCapability(
  providerId: string,
  kind: ProviderKind,
  patch: CapabilityPatch,
): ProviderWithMaskedKey | null {
  const existing = db()
    .prepare(
      `SELECT model, disabled, extras FROM provider_capabilities
       WHERE provider_id = ? AND kind = ?`,
    )
    .get(providerId, kind) as
    | { model: string; disabled: number; extras: string | null }
    | undefined;
  if (!existing) return null;

  const model = patch.model ?? existing.model;
  const disabled =
    patch.disabled !== undefined ? (patch.disabled ? 1 : 0) : existing.disabled;
  const extrasJson =
    patch.extras !== undefined ? serializeExtras(patch.extras) : existing.extras;

  db()
    .prepare(
      `UPDATE provider_capabilities
       SET model = ?, disabled = ?, extras = ?, auto_disabled_until = NULL
       WHERE provider_id = ? AND kind = ?`,
    )
    .run(model, disabled, extrasJson, providerId, kind);

  return loadOrThrow(providerId);
}

/** Reassign priorities for all capabilities of a given kind, in the order
 *  given. Throws if the set of providerIds doesn't match the existing
 *  capability rows for that kind. */
export function reorderCapabilities(kind: ProviderKind, orderedProviderIds: string[]): void {
  const existing = db()
    .prepare(`SELECT provider_id FROM provider_capabilities WHERE kind = ?`)
    .all(kind) as Array<{ provider_id: string }>;
  const existingIds = new Set(existing.map(r => r.provider_id));
  const givenIds = new Set(orderedProviderIds);

  if (existingIds.size !== givenIds.size || ![...existingIds].every(id => givenIds.has(id))) {
    throw new Error(`reorder ids don't match existing ${kind} capabilities`);
  }

  const update = db().prepare(
    `UPDATE provider_capabilities SET priority = ? WHERE provider_id = ? AND kind = ?`,
  );
  const tx = db().transaction(() => {
    orderedProviderIds.forEach((id, idx) => update.run(idx + 1, id, kind));
  });
  tx();
}

export function deleteProvider(id: string): boolean {
  const result = db().prepare(`DELETE FROM providers WHERE id = ?`).run(id);
  return result.changes > 0;
}

function loadOrThrow(id: string): ProviderWithMaskedKey {
  const row = db()
    .prepare(`SELECT ${PROVIDER_COLS} FROM providers WHERE id = ?`)
    .get(id) as ProviderRow | undefined;
  if (!row) throw new Error(`provider ${id} disappeared mid-transaction`);
  const caps = loadCapabilitiesFor([id]).get(id) ?? [];
  return rowToMasked(row, caps);
}
