# `better-sqlite3`

同步 SQLite 绑定,inkast 用它存 **providers、generations、jobs**(异步任务表)。同步 API 对 Hono 路由来说够用(SQLite 本地操作 < 1ms)。

## 使用方式

`apps/api/src/storage/db.ts`:

```ts
import Database from "better-sqlite3";
const conn = new Database(path);
conn.pragma("journal_mode = WAL");
conn.pragma("foreign_keys = ON");
conn.pragma("synchronous = NORMAL");
conn.exec(readFileSync(schemaPath, "utf8"));
```

### Pragma 选择

- `journal_mode = WAL`:写不阻塞读,Vite + API 并发友好
- `foreign_keys = ON`:`generations.provider_id` 外键级联生效
- `synchronous = NORMAL`:WAL 模式下安全,性能更好

### Schema 应用方式

不用 migration 框架,直接 `conn.exec(schema.sql)`。schema.sql 全是 `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`,**幂等**——每次启动重新跑无副作用。

将来要 ALTER COLUMN 时加 `PRAGMA user_version` + 条件 ALTER,守住 idempotent。

## 表结构(详见 schema.sql)

```sql
providers       -- id / name / base_url / model / priority / key_ciphertext+iv+tag / created_at / updated_at
generations     -- id / prompt_snapshot / prompt_text / image_path / image_format / size / quality / provider_id / duration_ms / created_at
```

`generations.provider_id` 是 nullable FK + `ON DELETE SET NULL`——删 provider 不会丢历史,只是历史失去 provider 关联。

## Native binding

`better-sqlite3` 是 Node 原生扩展,装完后需要 `pnpm rebuild better-sqlite3` 编译 `.node` 文件。pnpm 因为 sandbox 默认不跑 install 脚本,警告:

```
Ignored build scripts: better-sqlite3.
Run "pnpm approve-builds" to pick which dependencies should be allowed to run scripts.
```

实操中我们直接 `cd node_modules/.pnpm/better-sqlite3@*/.../better-sqlite3 && npm run install --silent` 手动编译,产物在 `build/Release/better_sqlite3.node`。

## 类型

`@types/better-sqlite3` 是 dev dep。Row 类型自己手写(`ProviderRow` / `GenerationRow`),用 `as ProviderRow[]` 强转 `prepare().all()` 返回值。

## 数据目录

`<DATA_DIR>/inkast.sqlite` + WAL(`.sqlite-wal`)+ SHM(`.sqlite-shm`)。

`<DATA_DIR>` 解析(`storage/runtime.ts`):

1. `INKAST_DATA_DIR` 环境变量(绝对或 cwd-相对)
2. 默认 `<repo>/data`(从 apps/api/ cwd 看是 `../../data`)

## jobs 表(异步任务流水线)

新增的第三张表,见 [async-job-pipeline](../domains/async-job-pipeline.md) 和 [storage/jobs.ts](../../../apps/api/src/storage/jobs.ts)。列:`id / kind / status / prompt_snapshot / prompt_text / is_raw / size / quality / generation_id / attempts / error_code / error_message / created_at / started_at / completed_at`,带 `idx_jobs_status` + `idx_jobs_created_at` 索引。

`generation_id` 是 FK 到 `generations.id`(ON DELETE SET NULL),任务成功时回填关联。

## 关联条目

- [crypto-utils](../shared/crypto-utils.md) — BLOB 列存加密
- [provider-pool](../domains/provider-pool.md)
- [image-generation](../domains/image-generation.md)
- [async-job-pipeline](../domains/async-job-pipeline.md) — jobs 表的消费方
- [reaper-abandoned-jobs](../decisions/reaper-abandoned-jobs.md) — 启动时清理 pending/running
- [schema-sql-path-resolution](../pitfalls/schema-sql-path-resolution.md) — schema.sql 加载坑
