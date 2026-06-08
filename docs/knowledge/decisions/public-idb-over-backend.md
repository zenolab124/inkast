# 公开版前端用 IndexedDB 存储,后端不持有用户私有配置

公开版的 provider 配置、生图历史、图片二进制全部存浏览器 IndexedDB,后端只管 OAuth / 余额 / 生图代理,不存用户的 provider 配置。

## 背景

主线是单用户自部署,后端 SQLite 存 provider 凭据和历史记录既安全又简单。公开版是共享后端 + 多用户,同样做法需要:
- 后端存每个用户的 provider key(加密 + 访问控制,复杂)
- 或不允许用户带自己 key(只能用 builtin 通道)

两者都有明显代价。

## 方案对比

| 维度 | IndexedDB(选) | 后端存储用户私有配置 |
| --- | --- | --- |
| provider key 安全 | 留在用户自己浏览器,后端从不持有 | 需加密 + per-user 访问控制 |
| 后端复杂度 | stateless,只处理请求 | 需要 per-user 数据 CRUD + 迁移 |
| 跨设备同步 | 不支持(换浏览器/清缓存丢历史) | 自动同步 |
| 多用户隔离 | 天然隔离(每个用户自己的浏览器) | 需要服务端多租户隔离 |
| 适合场景 | passthrough 通道(用户带 key) | 多设备场景 |

公开版 passthrough 通道的语义本就是"用户用自己的 key",key 存在自己浏览器是最自然的位置——完全不经过后端的凭据存储路径。

## 最终选择

**IndexedDB**。实现在 `apps/web-public/src/lib/idb.ts`,用 `idb-keyval` 的 `createStore` 拆成 4 个独立 DB(注意:每个 store 用独立 `dbName` 而非同一 DB 多 store,见坑记录):

| store | dbName | 用途 |
| --- | --- | --- |
| `providersStore` | `inkast-public-providers` | provider 配置(原主线 /api/providers) |
| `jobsStore` | `inkast-public-jobs` | 生图任务记录 |
| `generationsStore` | `inkast-public-generations` | 历史元数据 |
| `imagesStore` | `inkast-public-images` | 图片二进制 Blob |

`apps/web-public/src/features/config/api.ts` 与主线 `apps/web/src/features/config/api.ts` 接口形状相同,内部实现换成 IDB——`ProviderConfigDialog` 等上层组件代码不变。

## 副作用

- 换浏览器、清 IndexedDB、隐私模式下历史丢失——这对公开版用户是可接受的权衡
- `probeModels`(探测可用模型列表)公开版返空数组,因为浏览器直接 fetch 跨域被 CORS 拦。后续如需支持,需加 `/api/proxy/models` 透明代理端点
- 图片二进制存 IDB 对存储配额有压力;需要用户同意 `navigator.storage.persist()` 申请持久存储权限,否则浏览器空间紧张时可能被清理

## 关联条目

- [public-edition-separate-app](public-edition-separate-app.md) — 公开版整体架构决策
- [passthrough-vs-builtin-gen](passthrough-vs-builtin-gen.md) — passthrough 通道(provider key 留客户端的直接原因)
- [public-web](../domains/public-web.md) — 公开版前端全景(如已建)
