import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { dataDir } from "./runtime.js";

let _db: Database.Database | null = null;

export function db(): Database.Database {
  if (_db) return _db;
  const path = join(dataDir(), "inkast-public.sqlite");
  const conn = new Database(path);
  conn.pragma("journal_mode = WAL");
  conn.pragma("foreign_keys = ON");
  conn.pragma("synchronous = NORMAL");

  const schemaPath = join(dirname(fileURLToPath(import.meta.url)), "schema.sql");
  conn.exec(readFileSync(schemaPath, "utf8"));

  _db = conn;
  return conn;
}

/**
 * 应用一段额外 schema。给 topup 通道用,各自把自己的 CREATE TABLE 文件传进来。
 * 必须在 db() 已初始化后调用——核心 schema 先到位,topup 表才能引用 users(id) 外键。
 */
export function applyExtraSchema(sqlPath: string): void {
  db().exec(readFileSync(sqlPath, "utf8"));
}
