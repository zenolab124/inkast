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

export const providersStore = createStore("inkast-public", "providers");
export const jobsStore = createStore("inkast-public", "jobs");
export const generationsStore = createStore("inkast-public", "generations");
export const imagesStore = createStore("inkast-public", "images");

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
