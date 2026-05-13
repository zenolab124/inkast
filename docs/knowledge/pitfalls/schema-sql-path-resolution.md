# schema.sql 加载路径用 `import.meta.url`

**What**: `apps/api/src/storage/db.ts` 加载 schema.sql 用:

```ts
const schemaPath = join(dirname(fileURLToPath(import.meta.url)), "schema.sql");
const schema = readFileSync(schemaPath, "utf8");
conn.exec(schema);
```

这在 dev(`tsx watch src/index.ts`)能跑——`import.meta.url` 解析到 `apps/api/src/storage/db.ts`,schema.sql 就在隔壁,能读到。

**Why** 是个**潜在坑**: 当我们 `pnpm --filter @inkast/api build` 编译到 dist 时,**tsc 默认不会复制非 .ts 文件**。dist/storage/ 下只有 db.js,**没有 schema.sql**——`readFileSync` 在生产路径会 ENOENT。

Phase 1 没踩到这个坑,**因为我们 dev 直接用 tsx,从不跑生产 build**。一旦准备打包(Tauri sidecar / pkg / Bun compile / Docker),必须解决。

**Action**: 三个选项,任挑:

### A. tsc 后手动复制(简单)

`apps/api/package.json` 改:

```json
"build": "tsc -p tsconfig.json && cp src/storage/schema.sql dist/storage/schema.sql"
```

### B. 把 schema 内联到 TS(最稳)

```ts
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS providers ( ... );
CREATE TABLE IF NOT EXISTS generations ( ... );
...
`;
```

牺牲一点编辑体验(SQL 语法高亮失效),换零依赖加载。

### C. Vite plugin / esbuild loader(过度工程化)

不推荐。

**当前选择**:暂不动。Phase 2 真要打包时再处理,届时选 B(内联)。

## 关联条目

- [better-sqlite3](../integrations/better-sqlite3.md)
- [crypto-utils](../shared/crypto-utils.md)
