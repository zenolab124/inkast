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
  key_ciphertext  BLOB NOT NULL,
  key_iv          BLOB NOT NULL,
  key_tag         BLOB NOT NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_providers_priority ON providers(priority);

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
