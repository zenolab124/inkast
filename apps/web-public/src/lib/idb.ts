/**
 * 公开版浏览器持久化:每个 user 自己浏览器一份数据,跟主线 SQLite 等价
 * (主线是单 user 自部署,这里是共享后端 stateless 模式)。
 *
 * 用 idb-keyval 的 createStore 拆 4 个 store:
 *   - providers       provider 配置(原主线 /api/providers)
 *   - jobs            生图任务记录(原主线 /api/jobs)
 *   - generations     生图历史元数据(原主线 /api/generations)
 *   - images          图片二进制 Blob(原主线 /data/images/*.png)
 *
 * 申请 persistent storage(navigator.storage.persist),浏览器空间紧张时
 * 不会被清掉。
 */
import { createStore } from "idb-keyval";

/**
 * 每个 store 用**独立 dbName**(不是同一 DB 多 store)。
 *
 * idb-keyval 的 createStore 内部对每个 dbName 都触发独立的 indexedDB.open(),
 * 多个 createStore 用同一 dbName 时会 race —— 只有第一个 open 的 onupgradeneeded
 * 真正 createObjectStore,后续的 open 看到 DB 已在 version 1 就不再触发升级,
 * 它们的 store **从来没被创建过**,事务时报 "object store was not found"。
 *
 * 修复:让 idb-keyval 走它擅长的"单 DB 单 store"模式,每个 store 独立 DB。
 * 浏览器侧 4 个 IndexedDB DB,语义上没区别,管理方便(DevTools 也好看)。
 *
 * providers 保留原 dbName('inkast-public')以兼容已经配过 provider 的用户;
 * 其它 3 个之前因为 bug 从未真正创建过,改新 dbName 也不丢任何数据。
 */
export const providersStore = createStore("inkast-public", "providers");
export const jobsStore = createStore("inkast-public-jobs", "kv");
export const generationsStore = createStore("inkast-public-generations", "kv");
export const imagesStore = createStore("inkast-public-images", "kv");

let _persistRequested = false;
export async function requestPersistentStorage(): Promise<boolean> {
  if (_persistRequested) return false;
  _persistRequested = true;
  if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
  try {
    const granted = await navigator.storage.persist();
    if (!granted) console.warn("[idb] persistent storage NOT granted — 数据可能被浏览器清理");
    return granted;
  } catch {
    return false;
  }
}
