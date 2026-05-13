import { mkdirSync, existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { resolve, join } from "node:path";

/**
 * Resolve the local data directory. Precedence:
 *   1. INKAST_DATA_DIR env var (absolute or relative to cwd)
 *   2. <repo>/data            (default for `pnpm dev`)
 *
 * The directory is created on first read.
 */
export function dataDir(): string {
  const envDir = process.env.INKAST_DATA_DIR;
  const dir = envDir
    ? resolve(envDir)
    : resolve(process.cwd(), "..", "..", "data");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function imagesDir(): string {
  const dir = join(dataDir(), "images");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Load or create the master encryption key used for at-rest credential
 * encryption. The key is a 32-byte random buffer stored at
 * `<dataDir>/master.key` with 0600 permissions.
 *
 * Rotating this key invalidates all stored credentials — they'd have to be
 * re-entered. Phase 1 doesn't support rotation.
 */
let _masterKeyCache: Buffer | null = null;
export function masterKey(): Buffer {
  if (_masterKeyCache) return _masterKeyCache;
  const path = join(dataDir(), "master.key");
  let key: Buffer;
  if (existsSync(path)) {
    key = readFileSync(path);
    if (key.length !== 32) {
      throw new Error(
        `master.key at ${path} is ${key.length} bytes, expected 32. Delete it to regenerate (will invalidate stored credentials).`,
      );
    }
  } else {
    key = randomBytes(32);
    writeFileSync(path, key);
    chmodSync(path, 0o600);
  }
  _masterKeyCache = key;
  return key;
}
