-- Inkast local SQLite schema.
-- Applied idempotently on every API startup (CREATE TABLE IF NOT EXISTS).
-- Migrations: when a column needs to change, add ALTER statements below
-- the CREATE block, guarded by a check for the column's existence.

CREATE TABLE IF NOT EXISTS providers (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE,
  base_url        TEXT NOT NULL,
  model           TEXT NOT NULL DEFAULT 'gpt-image-2',
  priority        INTEGER NOT NULL DEFAULT 100,
  kind            TEXT NOT NULL DEFAULT 'image',  -- 'image' | 'llm'
  extras          TEXT,                            -- JSON string for driver-specific options
  key_ciphertext  BLOB NOT NULL,
  key_iv          BLOB NOT NULL,
  key_tag         BLOB NOT NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_providers_priority ON providers(priority);
-- idx_providers_kind_priority is created in db.ts migrate() AFTER the kind
-- column is ALTERed in on existing DBs. Putting it here would fail on first
-- run because schema.sql runs before ALTER.

-- Per-kind capability of each provider. A provider can serve both 'image' and
-- 'llm' from the same baseUrl + key; ordering / disabled state are scoped per
-- kind so the image pool and the LLM pool stay independent.
CREATE TABLE IF NOT EXISTS provider_capabilities (
  provider_id   TEXT NOT NULL,
  kind          TEXT NOT NULL,            -- 'image' | 'llm'
  model         TEXT NOT NULL,
  priority      INTEGER NOT NULL,         -- per-kind ordering (lower = tried first)
  disabled      INTEGER NOT NULL DEFAULT 0,  -- 1 means skipped by the pool
  extras        TEXT,                     -- JSON, per-kind options
  PRIMARY KEY (provider_id, kind),
  FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_capabilities_kind_priority
  ON provider_capabilities(kind, priority);

CREATE TABLE IF NOT EXISTS generations (
  id              TEXT PRIMARY KEY,
  prompt_snapshot TEXT NOT NULL,
  prompt_text     TEXT NOT NULL,
  image_path      TEXT NOT NULL,
  image_format    TEXT NOT NULL DEFAULT 'png',
  size            TEXT NOT NULL,
  quality         TEXT NOT NULL,
  provider_id     TEXT,
  duration_ms     INTEGER,
  created_at      INTEGER NOT NULL,
  FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_generations_created_at ON generations(created_at DESC);

-- Async image-generation jobs. Each submission writes a row immediately;
-- a background task progresses it through pending → running → succeeded /
-- failed. The frontend polls /api/jobs to recover state across page refreshes
-- and to display "in-flight" task cards while the upstream model is working.
CREATE TABLE IF NOT EXISTS jobs (
  id              TEXT PRIMARY KEY,
  kind            TEXT NOT NULL DEFAULT 'image_generate',
  status          TEXT NOT NULL,           -- pending / running / succeeded / failed
  prompt_snapshot TEXT NOT NULL,
  prompt_text     TEXT NOT NULL,
  is_raw          INTEGER NOT NULL DEFAULT 0,
  size            TEXT NOT NULL,
  quality         TEXT NOT NULL,
  generation_id   TEXT,
  attempts        TEXT NOT NULL DEFAULT '[]',
  error_code      TEXT,
  error_message   TEXT,
  created_at      INTEGER NOT NULL,
  started_at      INTEGER,
  completed_at    INTEGER,
  FOREIGN KEY (generation_id) REFERENCES generations(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at DESC);
