import { randomUUID } from "node:crypto";
import { db } from "./db.js";
import { decryptSecret, encryptSecret, maskKey } from "./crypto.js";

export interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  priority: number;
  createdAt: number;
  updatedAt: number;
}

export interface ProviderWithMaskedKey extends Provider {
  keyMasked: string;
}

export interface ProviderInput {
  name: string;
  baseUrl: string;
  apiKey: string;
  model?: string;
  priority?: number;
}

export interface ProviderPatch {
  name?: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  priority?: number;
}

interface ProviderRow {
  id: string;
  name: string;
  base_url: string;
  model: string;
  priority: number;
  key_ciphertext: Buffer;
  key_iv: Buffer;
  key_tag: Buffer;
  created_at: number;
  updated_at: number;
}

function rowToMasked(row: ProviderRow): ProviderWithMaskedKey {
  const plain = decryptSecret({
    ciphertext: row.key_ciphertext,
    iv: row.key_iv,
    tag: row.key_tag,
  });
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    model: row.model,
    priority: row.priority,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    keyMasked: maskKey(plain),
  };
}

export function listProviders(): ProviderWithMaskedKey[] {
  const rows = db()
    .prepare(
      `SELECT id, name, base_url, model, priority,
              key_ciphertext, key_iv, key_tag, created_at, updated_at
       FROM providers
       ORDER BY priority ASC, created_at ASC`,
    )
    .all() as ProviderRow[];
  return rows.map(rowToMasked);
}

export function getProviderKey(id: string): { provider: Provider; apiKey: string } | null {
  const row = db()
    .prepare(
      `SELECT id, name, base_url, model, priority,
              key_ciphertext, key_iv, key_tag, created_at, updated_at
       FROM providers WHERE id = ?`,
    )
    .get(id) as ProviderRow | undefined;
  if (!row) return null;
  const apiKey = decryptSecret({
    ciphertext: row.key_ciphertext,
    iv: row.key_iv,
    tag: row.key_tag,
  });
  return {
    provider: {
      id: row.id,
      name: row.name,
      baseUrl: row.base_url,
      model: row.model,
      priority: row.priority,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
    apiKey,
  };
}

/**
 * Iteration order matches the provider pool semantics: priority asc,
 * stable by created_at. Callers (image driver) walk this list to find a
 * working provider, falling over on transient errors.
 */
export function listProviderKeys(): Array<{ provider: Provider; apiKey: string }> {
  const rows = db()
    .prepare(
      `SELECT id, name, base_url, model, priority,
              key_ciphertext, key_iv, key_tag, created_at, updated_at
       FROM providers
       ORDER BY priority ASC, created_at ASC`,
    )
    .all() as ProviderRow[];
  return rows.map(row => ({
    provider: {
      id: row.id,
      name: row.name,
      baseUrl: row.base_url,
      model: row.model,
      priority: row.priority,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
    apiKey: decryptSecret({
      ciphertext: row.key_ciphertext,
      iv: row.key_iv,
      tag: row.key_tag,
    }),
  }));
}

export function createProvider(input: ProviderInput): ProviderWithMaskedKey {
  const now = Date.now();
  const id = randomUUID();
  const { ciphertext, iv, tag } = encryptSecret(input.apiKey);
  db()
    .prepare(
      `INSERT INTO providers
       (id, name, base_url, model, priority, key_ciphertext, key_iv, key_tag, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.name,
      input.baseUrl,
      input.model ?? "gpt-image-2",
      input.priority ?? 100,
      ciphertext,
      iv,
      tag,
      now,
      now,
    );
  return {
    id,
    name: input.name,
    baseUrl: input.baseUrl,
    model: input.model ?? "gpt-image-2",
    priority: input.priority ?? 100,
    createdAt: now,
    updatedAt: now,
    keyMasked: maskKey(input.apiKey),
  };
}

export function updateProvider(id: string, patch: ProviderPatch): ProviderWithMaskedKey | null {
  const existing = getProviderKey(id);
  if (!existing) return null;

  const merged: ProviderInput = {
    name: patch.name ?? existing.provider.name,
    baseUrl: patch.baseUrl ?? existing.provider.baseUrl,
    model: patch.model ?? existing.provider.model,
    priority: patch.priority ?? existing.provider.priority,
    apiKey: patch.apiKey ?? existing.apiKey,
  };

  const now = Date.now();
  const enc = patch.apiKey ? encryptSecret(patch.apiKey) : null;

  if (enc) {
    db()
      .prepare(
        `UPDATE providers
         SET name = ?, base_url = ?, model = ?, priority = ?,
             key_ciphertext = ?, key_iv = ?, key_tag = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        merged.name,
        merged.baseUrl,
        merged.model,
        merged.priority,
        enc.ciphertext,
        enc.iv,
        enc.tag,
        now,
        id,
      );
  } else {
    db()
      .prepare(
        `UPDATE providers
         SET name = ?, base_url = ?, model = ?, priority = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(merged.name, merged.baseUrl, merged.model, merged.priority, now, id);
  }

  return {
    id,
    name: merged.name,
    baseUrl: merged.baseUrl,
    model: merged.model!,
    priority: merged.priority!,
    createdAt: existing.provider.createdAt,
    updatedAt: now,
    keyMasked: maskKey(merged.apiKey),
  };
}

export function deleteProvider(id: string): boolean {
  const result = db().prepare(`DELETE FROM providers WHERE id = ?`).run(id);
  return result.changes > 0;
}
