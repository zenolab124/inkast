# 公开版前端（fork + 本地存储 + 登录）

公开版前端严格 fork 主线 `apps/web/src`，保留全部 UI 组件和交互逻辑，仅在三处关键位置改造：API 层换成 IndexedDB 本地存储、Header 植入登录态/余额/兑换码 widget、生图通道根据 IDB 有无 provider 动态选择 passthrough 或 builtin。

## 架构

```
apps/web-public/src/         ← fork of apps/web/src
    App.tsx                   ← 引入 AuthHeader，砍 dark-mode toggle
    features/
        auth/
            AuthHeader.tsx    ← 公开版独有：登录/余额/兑换码
        config/
            api.ts            ← IDB 实现（主线走 REST /api/providers）
        jobs/
            api.ts            ← IDB + /api/gen/passthrough or builtin
            useJobs.ts        ← 2s polling + IDB diff（与主线一致）
        gallery/
            api.ts            ← IDB 实现（主线走 REST /api/generations）
        prompt/
            api.ts            ← /api/prompt/draft + warmupLlm no-op
            useDefaultLlmBackend.ts ← 与主线相同逻辑
    lib/
        idb.ts                ← 4 个独立 IndexedDB（providers/jobs/generations/images）
    styles/themes/            ← symlink → apps/web/src/styles/themes
```

## 关键文件（差异点）

| 文件 | 改造内容 |
| --- | --- |
| `apps/web-public/src/App.tsx` | 引入 `AuthHeader`；砍 plugin-gallery tab 入口和 dark mode toggle |
| `apps/web-public/src/features/auth/AuthHeader.tsx` | 新增，见下文 |
| `apps/web-public/src/features/config/api.ts` | provider CRUD 全改 IDB（idb-keyval），接口形状不变 |
| `apps/web-public/src/features/jobs/api.ts` | 生图任务写 IDB，runJob 选 passthrough/builtin，图片落 IDB Blob |
| `apps/web-public/src/features/gallery/api.ts` | listGenerations 从 IDB generationsStore 读，不走 REST |
| `apps/web-public/src/features/prompt/api.ts` | draftPrompt → `/api/prompt/draft`；warmupLlm 改 no-op |
| `apps/web-public/src/lib/idb.ts` | 定义 4 个独立 store + requestPersistentStorage |

## AuthHeader（公开版独有）

Header 右侧插入紧凑 widget，与其它 `Button variant=outline size=sm` 对齐：

- **未登录**：`Linux.do 登录` 按钮 → 跳转 `/api/auth/linuxdo/authorize?redirect_to=...`
- **已登录**：头像 + 用户名 + 余额数字（Wallet 图标）+ 兑换码按钮（Gift）+ 登出按钮
- `RedeemDialog`：内联 Dialog，POST `/api/topups/invite/redeem`，成功后刷新余额

mount 时调 `GET /api/auth/me` 拉取登录态，登出后重新拉取。

## IDB 本地存储层（lib/idb.ts）

4 个 store 各用**独立 dbName**（避免 idb-keyval 多 store 同 DB race 导致 object store 未创建的 bug）：

| store | dbName | 存储内容 |
| --- | --- | --- |
| `providersStore` | `inkast-public-providers` | provider 配置（含 apiKey 明文） |
| `jobsStore` | `inkast-public-jobs` | JobRecord（pending/running/succeeded/failed） |
| `generationsStore` | `inkast-public-generations` | GenerationRecord 元数据 |
| `imagesStore` | `inkast-public-images` | 图片 Blob（`imagePath: "idb:<generationId>"` 标记） |

`requestPersistentStorage()` 在首次写入前调用 `navigator.storage.persist()`，防止浏览器空间紧张时清除数据。

## runJob：生图通道选择

```
runJob(jobId, job, req)
    │
    ├── getFirstEnabledProvider("image")  ← 从 IDB 取 priority 最低的 enabled provider
    │
    ├── 有 provider → channel='passthrough'
    │     endpoint = /api/gen/passthrough
    │     body = { provider: { baseUrl, apiKey, model, useCodexHeader }, prompt, options }
    │
    └── 无 provider → channel='builtin'
          endpoint = /api/gen/builtin
          body = { prompt, options }
    │
    ├── 成功 → imageToBlob(image)（url fetch 或 b64 decode）
    │          set(generationId, blob, imagesStore)
    │          set(generationId, GenerationRecord, generationsStore)
    │          set(jobId, succeeded, jobsStore)
    │
    └── 失败 → set(jobId, failed, jobsStore)
```

fire-and-forget：`submitGenerateJob` 写 IDB pending 即返，`runJob` 异步执行。`useJobs` 以 2s 间隔 polling IDB `['pending','running']` 列表，diff 出消失的 job 拉最终状态触发 callback。

## 砍掉的主线功能

| 功能 | 处理方式 |
| --- | --- |
| Plugin Gallery tab | App.tsx 不挂此 tab（`readTabFromUrl` 只接受 `draft`/`gallery`） |
| Admin stats 链接 | Header 无此入口 |
| Dark mode toggle | 无（公开版固定 paper 主题） |
| warmupLlm | 改 no-op（透明代理每次 new client，无 cold-start 概念） |
| probeModels | 返空数组（浏览器跨域 CORS 拦，未走后端透明代理） |

## 关联条目

- [public-edition-overview](./public-edition-overview.md) — 公开版整体架构
- [shared/public-idb-storage](../shared/public-idb-storage.md) — IDB 设计总览
- [decisions/public-idb-over-backend](../decisions/public-idb-over-backend.md) — 为何选 IDB 而非后端存储
- [public-image-gen](./public-image-gen.md) — passthrough/builtin endpoint 细节
- [pitfalls/idb-shared-dbname-race](../pitfalls/idb-shared-dbname-race.md) — 多 store 共用 dbName 导致 object store 未创建的 bug
- [decisions/responsive-deferred](../decisions/responsive-deferred.md) — 响应式布局延迟决策
- [integrations/react-masonry-css](../integrations/react-masonry-css.md) — Gallery 瀑布流
