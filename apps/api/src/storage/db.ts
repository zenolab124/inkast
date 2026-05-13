import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { dataDir } from "./runtime.js";

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

  _db = conn;
  return conn;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
