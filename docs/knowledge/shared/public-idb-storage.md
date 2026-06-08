# 公开版前端 IndexedDB 本地存储层

公开版用 idb-keyval 把 providers / jobs / generations / images 四类数据全部存在浏览器 IndexedDB,替代主线后端 SQLite。

## 背景

公开版是无后端状态的多用户模式:图片和任务记录都在用户自己的浏览器里,后端仅负责鉴权和生图中转。主线里的 `data/images/*.png` 和 `inkast.sqlite` 全部对应到这一层 IDB。

## 四个独立 DB

入口文件:`apps/web-public/src/lib/idb.ts`

```typescript
export const providersStore  = createStore("inkast-public-providers",   "kv");
export const jobsStore       = createStore("inkast-public-jobs",        "kv");
export const generationsStore = createStore("inkast-public-generations", "kv");
export const imagesStore     = createStore("inkast-public-images",      "kv");
```

每个 store 用**独立 dbName**,即各自一个 `indexedDB.open()` 实例,store 名统一叫 `"kv"`。

idb-keyval 的 `createStore` 在每个 `dbName` 上独立触发 `onupgradeneeded` → `createObjectStore`,这是唯一能让 store 真正被创建的时机。多个 `createStore` 共用同一 `dbName` 时:第一个 `open` 创建 store,后续的 `open` 看到 DB 已在 version 1,跳过升级——第 2-4 个 store **从未被创建**,事务时报 `"object store was not found"`。完整坑记录见 [idb-shared-dbname-race](../pitfalls/idb-shared-dbname-race.md)。

**dbName 选择依据**:
- `inkast-public-providers` 保留旧名(`inkast-public`)——兼容已配过 provider 的老用户
- 另 3 个因 race bug 原本从未真正创建过,改新 dbName 不丢任何数据

## 各 store 用途

| store | 等价主线 | 数据 |
| --- | --- | --- |
| `providersStore` | `providers` + `provider_capabilities` SQLite 表 | `StoredProvider`(含明文 `apiKey`),列表时 `toSummary` strip 成 `keyMasked` |
| `jobsStore` | `jobs` SQLite 表 | `JobRecord`(pending / running / succeeded / failed) |
| `generationsStore` | `generations` SQLite 表 | `GenerationRecord`,`imagePath = idb:${id}` |
| `imagesStore` | `data/images/*.png` 文件系统 | 原始图片 `Blob` |

## 图片 URL 处理

`imagesStore` 存 `Blob` 原始二进制。读取时用 `URL.createObjectURL(blob)` 生成 `blob:` URL:

- `generationImageUrl(id)` 是同步函数(供 `<img src>` 直接用)
- `listGenerations` 时异步预热 `blobUrlCache: Map<id, blob:URL>`,之后同步命中
- 缓存是 page-scope,刷新页面重建(接受这个 leak)

入口:`apps/web-public/src/features/gallery/api.ts`

## 持久化申请

`requestPersistentStorage()` 在 `submitGenerateJob` 和 `readAll`(providers)前调用,向浏览器申请 persistent storage 配额,防止空间压力时被浏览器 GC。

## 使用方

| feature | 用哪些 store |
| --- | --- |
| `features/config/api.ts` | `providersStore`(CRUD + reorder + getProviderWithKey) |
| `features/jobs/api.ts` | `jobsStore` + `generationsStore` + `imagesStore`(submitGenerateJob / runJob) |
| `features/gallery/api.ts` | `generationsStore` + `imagesStore`(listGenerations + generationImageUrl) |

## 关联条目

- [pitfalls/idb-shared-dbname-race](../pitfalls/idb-shared-dbname-race.md) — 共用 dbName 导致 store 从未创建的根因分析
- [decisions/public-idb-over-backend](../decisions/public-idb-over-backend.md) — 选 IDB 而非后端持久化的决策
- [domains/public-web](../domains/public-web.md) — 公开版前端整体
- [domains/public-edition-overview](../domains/public-edition-overview.md) — 主线 vs 公开版对比
