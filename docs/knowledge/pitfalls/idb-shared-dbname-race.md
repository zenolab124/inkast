# idb-shared-dbname-race — IndexedDB 多 store 共用 dbName 导致 store 未创建

公开版前端最初让 providers / jobs / generations / images 四个 store 共用同一个 `dbName`（`'inkast-public'`），运行时 jobs / generations / images 三个 store 在事务时抛 `"DOMException: The operation failed because the requested database object could not be found"（object store was not found）`。

## What

公开版前端调用 `createStore(dbName, storeName)` 初始化四个 idb-keyval store，把 `dbName` 都设为 `'inkast-public'`。页面加载后，`providers` 能正常读写，但 `jobs` / `generations` / `images` 的任何读写操作都报：

```
DOMException: Failed to execute 'transaction' on 'IDBDatabase':
  One of the specified object stores was not found.
```

历史数据为空、无法持久化任务状态、Gallery 也无法显示。

## Why

`idb-keyval` 的 `createStore(dbName, storeName)` 内部调 `indexedDB.open(dbName, 1)`（版本号硬编码 1）。

- 第一个 `open` 触发 `onupgradeneeded`，在回调里执行 `db.createObjectStore(storeName)`，该 store 被正常创建。
- 之后再用**同一 `dbName`** 调 `indexedDB.open(dbName, 1)` 时，浏览器看到 DB 已存在且版本号没升（仍是 1），**`onupgradeneeded` 不再触发**，也就不会执行 `createObjectStore`。
- 后续代码拿到的 `IDBDatabase` 实例根本不包含第 2、3、4 个 store 的对象仓，对它们发起事务时立刻报找不到 store。

**根因**：idb-keyval 面向"一库一 store"模式设计，`createStore` 无法在已存在的库里动态补建 store（那需要升版本号，idb-keyval 不暴露这个 API）。同 `dbName` 多次 `createStore` 只有第一个生效。

## Action

把四个 store 拆成**四个独立 dbName**，每个对应独立 IndexedDB Database，各自走自己的 `onupgradeneeded` 升级周期：

```ts
// apps/web-public/src/lib/idb.ts
export const providersStore  = createStore("inkast-public-providers",   "kv");
export const jobsStore       = createStore("inkast-public-jobs",        "kv");
export const generationsStore = createStore("inkast-public-generations","kv");
export const imagesStore     = createStore("inkast-public-images",      "kv");
```

**兼容性处理**：`providers` 保留旧 `dbName`（`inkast-public-providers` ≠ 原 `inkast-public`，但原 store 里存的是用户手动配过的 provider，需要评估迁移成本）——实际迁移时发现原 `inkast-public` DB 内确有 providers 数据，故命名改为 `inkast-public-providers` 仍属新 DB，老用户需重填；其余三个原本从未真正创建过，改名不丢任何数据。

拆完后 DevTools Application → Storage → IndexedDB 会显示 4 个独立 DB，每个只含一个 `kv` store，`onupgradeneeded` 各自触发一次，再无 "store not found" 报错。

**必读文件**：`apps/web-public/src/lib/idb.ts`

---

关联条目：[domains/public-edition-overview](../domains/public-edition-overview.md) · [domains/public-image-gen](../domains/public-image-gen.md)
