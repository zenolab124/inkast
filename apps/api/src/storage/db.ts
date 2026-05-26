import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { dataDir } from "./runtime.js";
import { encryptSecret } from "./crypto.js";

/**
 * Reserved provider id for the built-in ClaudeCode LLM driver. Lives in the
 * providers table alongside user-defined providers so its row participates in
 * the same priority/disabled/reorder mechanisms — but the driver factory
 * routes calls to ClaudeCodeDriver instead of OpenAiCompatibleDriver.
 */
export const BUILTIN_CLAUDE_CODE_ID = "__builtin_claude_code__";

let _db: Database.Database | null = null;

export function db(): Database.Database {
  if (_db) return _db;
  const path = join(dataDir(), "inkast.sqlite");
  const conn = new Database(path);
  conn.pragma("journal_mode = WAL");
  conn.pragma("foreign_keys = ON");
  conn.pragma("synchronous = NORMAL");

  const schemaPath = join(dirname(fileURLToPath(import.meta.url)), "schema.sql");
  const schema = readFileSync(schemaPath, "utf8");
  conn.exec(schema);

  migrate(conn);

  _db = conn;
  return conn;
}

function migrate(conn: Database.Database): void {
  const cols = conn.prepare(`PRAGMA table_info(providers)`).all() as Array<{ name: string }>;
  const colNames = new Set(cols.map(c => c.name));
  if (!colNames.has("kind")) {
    conn.exec(`ALTER TABLE providers ADD COLUMN kind TEXT NOT NULL DEFAULT 'image'`);
  }
  if (!colNames.has("extras")) {
    conn.exec(`ALTER TABLE providers ADD COLUMN extras TEXT`);
  }
  conn.exec(`CREATE INDEX IF NOT EXISTS idx_providers_kind_priority ON providers(kind, priority)`);

  addColumnIfMissing(conn, "generations", "prose", "TEXT");
  addColumnIfMissing(conn, "generations", "ai_filled_fields", "TEXT");
  addColumnIfMissing(conn, "jobs", "prose", "TEXT");
  addColumnIfMissing(conn, "jobs", "ai_filled_fields", "TEXT");
  addColumnIfMissing(conn, "plugin_tasks", "provider_id", "TEXT");
  addColumnIfMissing(conn, "plugin_tasks", "provider_name", "TEXT");
  addColumnIfMissing(conn, "plugin_tasks", "image_url", "TEXT");
  addColumnIfMissing(conn, "plugin_tasks", "attempts", "TEXT NOT NULL DEFAULT '[]'");
  addColumnIfMissing(conn, "plugin_tasks", "rewritten_prompt", "TEXT");
  addColumnIfMissing(conn, "plugin_tasks", "success_round", "INTEGER");
  addColumnIfMissing(conn, "plugin_tasks", "post_review_edited", "INTEGER");
  addColumnIfMissing(conn, "jobs", "provider_id", "TEXT");
  addColumnIfMissing(conn, "jobs", "provider_name", "TEXT");
  addColumnIfMissing(conn, "provider_capabilities", "auto_disabled_until", "INTEGER");

  backfillCapabilities(conn);
  seedBuiltinClaudeCode(conn);
}

function addColumnIfMissing(
  conn: Database.Database,
  table: string,
  column: string,
  decl: string,
): void {
  const cols = conn.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (cols.some(c => c.name === column)) return;
  conn.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
}

/**
 * Insert the built-in ClaudeCode row + LLM capability if it isn't already
 * there. Idempotent. Placed AFTER user capabilities are backfilled so the
 * builtin slots at the end of the priority order — existing users keep their
 * configured providers ranked above it.
 *
 * The row carries dummy base_url / encrypted_key fields because the schema
 * requires NOT NULL on them. The driver factory recognizes BUILTIN_CLAUDE_CODE_ID
 * and never reads those fields, so they're inert.
 */
function seedBuiltinClaudeCode(conn: Database.Database): void {
  const existing = conn
    .prepare(`SELECT 1 FROM providers WHERE id = ?`)
    .get(BUILTIN_CLAUDE_CODE_ID);
  if (!existing) {
    const placeholder = encryptSecret("");
    const now = Date.now();
    conn
      .prepare(
        `INSERT INTO providers
         (id, name, base_url, model, priority, kind, extras,
          key_ciphertext, key_iv, key_tag, created_at, updated_at)
         VALUES (?, ?, '', 'auto', 999, 'llm', NULL, ?, ?, ?, ?, ?)`,
      )
      .run(
        BUILTIN_CLAUDE_CODE_ID,
        "ClaudeCode (local)",
        placeholder.ciphertext,
        placeholder.iv,
        placeholder.tag,
        now,
        now,
      );
  }

  const capExists = conn
    .prepare(
      `SELECT 1 FROM provider_capabilities WHERE provider_id = ? AND kind = 'llm'`,
    )
    .get(BUILTIN_CLAUDE_CODE_ID);
  if (!capExists) {
    const maxPriority = (
      conn
        .prepare(
          `SELECT COALESCE(MAX(priority), 0) AS max_priority
           FROM provider_capabilities WHERE kind = 'llm'`,
        )
        .get() as { max_priority: number }
    ).max_priority;
    conn
      .prepare(
        `INSERT INTO provider_capabilities
         (provider_id, kind, model, priority, disabled, extras)
         VALUES (?, 'llm', 'auto', ?, 0, NULL)`,
      )
      .run(BUILTIN_CLAUDE_CODE_ID, maxPriority + 1);
  }
}

/**
 * One-shot: copy legacy single-kind rows (model/priority/kind/extras on
 * providers) into provider_capabilities. Idempotent — if a (provider_id, kind)
 * capability already exists, the row is left alone.
 *
 * The old columns are intentionally NOT dropped here. Keeping them around
 * means a rollback to a pre-capabilities binary still reads correct values.
 * They become read-only legacy after this migration runs.
 */
function backfillCapabilities(conn: Database.Database): void {
  const providers = conn
    .prepare(
      `SELECT id, kind, model, priority, extras FROM providers
       WHERE NOT EXISTS (
         SELECT 1 FROM provider_capabilities WHERE provider_id = providers.id
       )`,
    )
    .all() as Array<{
      id: string;
      kind: string | null;
      model: string | null;
      priority: number | null;
      extras: string | null;
    }>;

  if (providers.length === 0) return;

  const insert = conn.prepare(
    `INSERT INTO provider_capabilities (provider_id, kind, model, priority, disabled, extras)
     VALUES (?, ?, ?, ?, 0, ?)`,
  );
  const tx = conn.transaction((rows: typeof providers) => {
    for (const row of rows) {
      const kind = row.kind === "llm" ? "llm" : "image";
      const model = row.model ?? (kind === "llm" ? "gpt-4o-mini" : "gpt-image-2");
      const priority = row.priority ?? 100;
      insert.run(row.id, kind, model, priority, row.extras);
    }
  });
  tx(providers);
  console.log(`[migrate] backfilled ${providers.length} provider capability rows`);
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
