# Inkast 知识库

快速理解项目的入口。按需跳转,不需要全部阅读。

**技术栈**: pnpm monorepo · Hono + better-sqlite3(后端) · Vite + React 18 + Tailwind v4 + shadcn/ui(前端) · @anthropic-ai/claude-agent-sdk(LLM 默认通道) · openai SDK(图像生成 + 参考图) · sharp(JPEG transcode + cover-fit resize) · zod(plugin overlay schema 校验)

<!-- codewise-docs:start -->
## 项目文档导航

本项目作者维护的人写文档,**这些是权威源**——比 knowledge/ 自动生成的更准。

### 入门 / 项目说明

- [CLAUDE.md](../../CLAUDE.md) — 项目宪法。覆盖六件事:(1) 项目血统(来自 gpt-image-canvas + imagegen);(2) 五条关键设计决策(LLM 双通道、provider 池语义、不用 tldraw、imagegen 方法论、本地优先);(3) 技术栈速查;(4) **Paper 主题视觉规范红线**(字体/颜色/形状/UI 组件库 4 套自检清单);(5) Phase 1 MVP 范围 + 不要做的事清单;(6) **新增"第三方库准入"段** —— 明确"功能型库按需引入,不要被通用准则误导成项目级硬约束",见 [third-party-library-admission](decisions/third-party-library-admission.md)。**UI 组件库** 硬性规则段:UI 一律优先 shadcn,禁止手撸通用交互组件,见 [shadcn-first-rule](decisions/shadcn-first-rule.md)。

### Plugin 通道 / 产品化(2026-05-21 新增)

- [docs/plugin-overlay.md](../plugin-overlay.md) — Plugin overlay 机制权威说明。"客户特化 = 配置数据,不是代码 fork"原则。包含:加载流程、JSON Schema 完整定义、Token 管理(env 不进 JSON)、跟 git 分支模型的对比、未来 hook 扩展点设计。**理解 inkast 产品化必读**。
- [docs/onboarding-new-plugin.md](../onboarding-new-plugin.md) — 给新客户接入 inkast plugin 通道的 step-by-step checklist。9 节覆盖:前提确认 / 决定身份 / 创建 overlay 仓 / 设计 plugin JSON(5 个决策点) / 部署到服务器 / 给对方接入信息 / 验证 checklist / 故障排查速查表 / 主线升级时。新客户加入按这份操作不会卡。
<!-- codewise-docs:end -->

<!-- codewise-interfaces:start -->
## 接口契约速查

inkast 所有对外调用入口的快速地图。**完整签名以代码为准**——本表只列"名 + 职责 + 入口位置"。

### REST endpoints(20 个)

**Web UI 通道(`/api/*`,本机访问)**:

| 方法 | 路径 | 职责 | 入口 |
| --- | --- | --- | --- |
| GET | `/api/health` | 健康检查 | `apps/api/src/server/app.ts` |
| POST | `/api/llm/warmup` | 触发本机 ClaudeCode SDK 预热(冷启动缓解,返回 `{durationMs}`) | `apps/api/src/server/routes/prompt.ts` |
| POST | `/api/draft-prompt` | 散文 → 结构化 JSON prompt(LLM 驱动) | `apps/api/src/server/routes/prompt.ts` |
| POST | `/api/generate-image` | **同步**生图;前端已不调用,留作兜底 | `apps/api/src/server/routes/generate.ts` |
| GET | `/api/generations` | 历史列表(默认 100,可 `?limit=`) | `apps/api/src/server/routes/generate.ts` |
| GET | `/api/generations/:id/image` | 返图片字节(`image/png` + 长缓存) | `apps/api/src/server/routes/generate.ts` |
| GET | `/api/providers` | provider 列表(keyMasked,内含 capabilities 数组) | `apps/api/src/server/routes/providers.ts` |
| POST | `/api/providers` | 创建 provider(加密入库,接 capabilities 数组) | `apps/api/src/server/routes/providers.ts` |
| PATCH | `/api/providers/:id` | 编辑 provider(apiKey 留空不变;capabilities 可 replace) | `apps/api/src/server/routes/providers.ts` |
| PATCH | `/api/providers/:id/capabilities/:kind` | 改单个 capability(model / disabled / extras) | `apps/api/src/server/routes/providers.ts` |
| POST | `/api/providers/reorder` | 按 kind 批量重排 priority(dnd-kit 拖拽用) | `apps/api/src/server/routes/providers.ts` |
| DELETE | `/api/providers/:id` | 删除 provider(`__builtin_claude_code__` 拒绝) | `apps/api/src/server/routes/providers.ts` |
| POST | `/api/probe-models` | 代理调 `<baseUrl>/models` 返支持的模型列表 | `apps/api/src/server/routes/providers.ts` |
| POST | `/api/jobs/generate` | 异步生图——立返 `jobId`,fire-and-forget runGenerationJob | `apps/api/src/server/routes/jobs.ts` |
| GET | `/api/jobs` | 任务列表(支持 `?status=&since=&limit=`) | `apps/api/src/server/routes/jobs.ts` |
| GET | `/api/jobs/:id` | 任务详情 | `apps/api/src/server/routes/jobs.ts` |

**Plugin 通道(`/plugins/v1/*`,Bearer Token 鉴权,公网可走 nginx `/inkast/` 反代)**:

| 方法 | 路径 | 职责 | 入口 |
| --- | --- | --- | --- |
| **POST** | **`/plugins/v1/images/submit`** | **v2 异步 submit**,立即返 task_id(≤100ms),inkast 后台跑完后 POST callback_url | `apps/api/src/server/routes/plugins.ts` |
| **GET** | **`/plugins/v1/images/status/:id`** | **callback 兜底拉**,返当前状态 + **`image_url`(v2.1 r2 模式)或 `b64_json`(v2 b64 模式)双协议兼容** | `apps/api/src/server/routes/plugins.ts` |

**管理端(`/admin/*`,loopback only,nginx 不暴露)**:

| 方法 | 路径 | 职责 | 入口 |
| --- | --- | --- | --- |
| **GET** | **`/admin/plugin-stats`** | **Plugin 通道运行状态 HTML dashboard**,服务端渲染 + meta refresh 60s | `apps/api/src/server/routes/admin.ts` |

**详情**: [async-job-pipeline](domains/async-job-pipeline.md) · [provider-pool](domains/provider-pool.md) · [image-generation](domains/image-generation.md) · [prompt-engine](domains/prompt-engine.md) · [reference-image](domains/reference-image.md) · **[plugin-channel](domains/plugin-channel.md)** · **[admin-dashboard](domains/admin-dashboard.md)**

### 契约文件(前后端共享类型)

| 文件 | 类型 | 关键导出 |
| --- | --- | --- |
| `packages/shared/src/prompt.ts` | TS types | `ImagePrompt` / `TextElement` / `AmbiguityHint` / `PromptDraft` |
| `packages/shared/src/api.ts` | TS types + 常量 | `OutputLang` / `DraftPromptRequest/Response` / `GenerateImageRequest/Response` / `ProviderSummary` / `ProviderCapability` / `GenerationRecord` / `ReferenceImage` / `JobStatus` / `JobRecord` / `SubmitJobRequest/Response` / `ListJobsResponse` / `ImageGenerationMode` / `IMAGE_GENERATION_MODE_DEFAULT` / `SIZE_AUTO` / `SIZE_RATIO_PREFIX` / `isRatioSize()` / `extractRatio()` / `makeRatioSize()` / `BUILTIN_CLAUDE_CODE_PROVIDER_ID` |
| `apps/api/src/plugins/types.ts` | TS types | **`InkastPlugin` 接口** —— plugin overlay JSON schema 的代码端定义 |
| `apps/api/src/plugins/loader.ts` | zod schemas | **InkastPluginSchema + ImageSizeSchema + LlmBackendDescriptorSchema** —— overlay JSON 运行时校验 |

**详情**: [shared-contracts](shared/shared-contracts.md) · [plugin-overlay-loader](shared/plugin-overlay-loader.md)

### 数据库 Schema(5 表)

`apps/api/src/storage/schema.sql` —— 启动时幂等 `CREATE TABLE IF NOT EXISTS` + `db.ts migrate()` ALTER 补列:

| 表 | 用途 |
| --- | --- |
| `providers` | OpenAI 兼容 provider 凭据(AES-256-GCM 加密 BLOB) |
| `provider_capabilities` | per-kind 能力行(`provider_id, kind, model, priority, disabled, extras`),复合索引 `(kind, priority)` |
| `generations` | Web UI 生图历史(含 `prose` / `ai_filled_fields` 字段) |
| `jobs` | Web UI 异步任务(同步加 `prose` / `ai_filled_fields`) |
| **`plugin_tasks`** | **Plugin 通道异步任务**(独立于 jobs):状态 + **`b64_json`(v2)** + **`image_url`(v2.1 起,r2 模式)** + callback_url + callback_token + provider_id/name + 24h GC |

**详情**: [better-sqlite3](integrations/better-sqlite3.md) · [async-job-pipeline](domains/async-job-pipeline.md) · [plugin-channel](domains/plugin-channel.md) · [provider-capability-table-split](decisions/provider-capability-table-split.md)

### Plugin Overlay 加载(运行时)

`INKAST_PLUGIN_DIR` env → 扫该目录 `*.json` → zod 校验 → 注册到 in-memory registry:

| 来源 | 作用 |
| --- | --- |
| `INKAST_PLUGIN_DIR/*.json` | 客户 overlay 业务配置(systemPromptPatch / enforceFields / imageDefaults / **imageStorage(v2.1)** / skipLlmExpansion / outputDimensions) |
| `INKAST_PLUGIN_TOKEN_<UPPER_ID>` env | 每 plugin 一个 Bearer Token,**不进 JSON** |
| `INKAST_DEFAULT_LLM_PROVIDER_ID` env | plugin 未指定 llmBackend 时回落 |
| **`R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` env** | **R2 直传凭据(v2.1 r2 模式必需)**,routing 字段在 plugin overlay JSON |

**详情**: [plugin-overlay-loader](shared/plugin-overlay-loader.md) · [json-overlay-vs-branch](decisions/json-overlay-vs-branch.md) · [cloudflare-r2](integrations/cloudflare-r2.md)

### 外部对象存储(v2.1 起)

| Bucket | 自定义域名 | 用途 |
| --- | --- | --- |
| `snap-ub-ai-variants` | `aivariants.124213.xyz` | snapub plugin 回写图(inkast 写 `aiVariants/ink-<uuid>.png`) |
| `inkast-storage` | (未绑域名) | inkast 平台自用预留 |

**详情**: [cloudflare-r2](integrations/cloudflare-r2.md) · cc 仓库 `servers/cloudflare-r2/README.md`
<!-- codewise-interfaces:end -->

---

## 按功能域

| 条目 | 一句话 |
| --- | --- |
| [architecture-overview](domains/architecture-overview.md) | 整体架构 + 数据流全景(Web UI 通道 + Plugin 通道) · **新人第一站** |
| [plugin-channel](domains/plugin-channel.md) | **Plugin 通道(v2 异步 callback,对外接入)** · submit + status + worker + retry + transcode + recovery |
| [admin-dashboard](domains/admin-dashboard.md) | **`/admin/plugin-stats` 服务端 HTML dashboard**(loopback only,**两 section:Plugin 通道 + Web UI 通道**) |
| [field-editor](domains/field-editor.md) | 字段编辑器中栏(collapsed/expanded 两态,lockMode 驱动) |
| [session-workspace](domains/session-workspace.md) | 起草 Tab 右栏 · 本次会话作品 + jobs 占位 tile · 刷新清空 |
| [async-job-pipeline](domains/async-job-pipeline.md) | Web UI 异步生图任务流水线 + polling + 重启 reaper |
| [reference-image](domains/reference-image.md) | 参考图生图(`images.edit` 路径) |
| [sprite-previews](domains/sprite-previews.md) | 字段选项真实预览图(14 张 sprite sheet) |
| [i18n](domains/i18n.md) | 中英双语 + LLM 输出语言切换 |
| [prompt-engine](domains/prompt-engine.md) | 散文 → JSON prompt 引擎(imagegen 方法论的实现) |
| [provider-pool](domains/provider-pool.md) | OpenAI 兼容 provider 池 + 故障切换语义 |
| [image-generation](domains/image-generation.md) | 生图端到端(driver → 落盘 → 入库) |
| [gallery](domains/gallery.md) | [作品] Tab 历史 · 搜索+type filter + 详情弹窗(readOnly 字段编辑器) |

## 按技术层

| 条目 | 一句话 |
| --- | --- |
| [shared-contracts](shared/shared-contracts.md) | `@inkast/shared` 前后端共享类型契约 |
| [http-agent](shared/http-agent.md) | 全局 undici dispatcher(10 分钟超时,适配 CDN 排队) |
| [plugin-overlay-loader](shared/plugin-overlay-loader.md) | **Plugin overlay JSON 加载 + zod 校验** + env token 装配 |
| [shadcn-primitives](shared/shadcn-primitives.md) | 已 own 的 11 个 shadcn 原语 + 业务包装 |
| [field-dictionary](shared/field-dictionary.md) | 6 字段选项词典 + 双语 + sprite 元数据 |
| [i18n-dictionary](shared/i18n-dictionary.md) | `Translations` 类型 + zh/en 字典 + useLanguage hook |
| [paper-theme-tokens](shared/paper-theme-tokens.md) | paper.css token + globals 全站效果(**视觉真理源**) |
| [cn-util](shared/cn-util.md) | clsx + tailwind-merge 的 cn() helper |
| [crypto-utils](shared/crypto-utils.md) | AES-256-GCM 凭据加密 + master.key |

## 设计决策

### Plugin 通道 / 产品化(2026-05-21 起持续)

| 条目 | 一句话 |
| --- | --- |
| [json-overlay-vs-branch](decisions/json-overlay-vs-branch.md) | **客户特化走 JSON overlay 而非 git fork**(数据 vs 代码 fork) |
| [v2-async-callback-protocol](decisions/v2-async-callback-protocol.md) | **Plugin 通道走 v2 异步 callback,不是 v1 同步**(60s 云函数硬约束 + 实测 533s 超长任务) |
| [plugin-channel-isolation](decisions/plugin-channel-isolation.md) | **Plugin 通道与 Web UI 完全分离**(独立 plugin-async + plugin_tasks 表) |
| **[r2-direct-upload-v2.1](decisions/r2-direct-upload-v2.1.md)** | **v2.1 R2 直传,callback 改返 image_url**(JDC 上行省 95% + uniCloud 出站归零) |
| **[per-capability-retry-budget](decisions/per-capability-retry-budget.md)** | **每个 image provider 单独配 retry 次数**(0-5,默认 1) |

### 架构 / 接口

| 条目 | 一句话 |
| --- | --- |
| [image-mode-coexistence](decisions/image-mode-coexistence.md) | images + responses 两 mode 共存,extras.mode 分发 |
| [responses-mode-raw-fetch-sse](decisions/responses-mode-raw-fetch-sse.md) | `/v1/responses` 端点用 raw fetch + 手写 SSE(SDK 太严格) |
| [diagnostics-first-not-fix](decisions/diagnostics-first-not-fix.md) | 诊断完整性 > 假装能修(渠道无解时的工程态度) |
| [auto-compress-references](decisions/auto-compress-references.md) | driver 自动 sharp 压缩参考图(384/q60,过 anyrouter 死亡线) |
| [pool-retry-graded](decisions/pool-retry-graded.md) | provider 内 retry × 2 分级(按 classified.code 决定 retry/fallover) |
| [forced-tool-choice-plus-directive](decisions/forced-tool-choice-plus-directive.md) | 强制 tool_choice + prompt directive 双保险让模型真调工具 |
| [ratio-wire-encoding](decisions/ratio-wire-encoding.md) | size 第三种形态 `ratio:W:H`(锁比例放像素) |
| [ratio-not-resolution-guarantee](decisions/ratio-not-resolution-guarantee.md) | Inkast 保证比例,不保证像素(代理兼容现实) |
| [batch-fan-out-frontend](decisions/batch-fan-out-frontend.md) | N 张并发 = 前端 N 个独立 job(`gpt-image-2` n=1 受限) |
| [openai-sdk-over-fetch](decisions/openai-sdk-over-fetch.md) | images 端点用 openai SDK(CDN 403 教训) |
| [claude-code-sdk-over-cli](decisions/claude-code-sdk-over-cli.md) | LLM 通道用 Agent SDK 而非 spawn `claude` CLI |
| [structured-output-json-schema](decisions/structured-output-json-schema.md) | 用 SDK schema 强制 JSON(80%→100% 输出可解析) |
| [prompt-as-json-not-prose](decisions/prompt-as-json-not-prose.md) | `JSON.stringify(prompt)` 直接喂给生图模型 |
| [reference-image-via-edit](decisions/reference-image-via-edit.md) | Reference image 走 `images.edit` 端点(images mode) |
| [async-jobs-over-sync-http](decisions/async-jobs-over-sync-http.md) | 异步 jobs 取代同步 HTTP(浏览器 idle timeout) |
| [reaper-abandoned-jobs](decisions/reaper-abandoned-jobs.md) | API 启动时 reap 残留 pending/running jobs |
| [generate-now-raw-prompt-path](decisions/generate-now-raw-prompt-path.md) | "直接生图"绕过 prompt engine(M1 后端实现) |

### Provider 池 / LLM 配置

| 条目 | 一句话 |
| --- | --- |
| [provider-capability-table-split](decisions/provider-capability-table-split.md) | providers + provider_capabilities 拆表,per-kind 能力 |
| [claude-code-builtin-provider](decisions/claude-code-builtin-provider.md) | ClaudeCode 注册为内置 provider 行(id `__builtin_claude_code__`) |
| [drag-to-top-default](decisions/drag-to-top-default.md) | 拖到顶 = 默认,无独立 "set default" radio |
| [no-main-ui-backend-selector](decisions/no-main-ui-backend-selector.md) | 主 UI 不放 LLM 选择器,只显示"via X"标签 |
| [probe-models-endpoint](decisions/probe-models-endpoint.md) | `POST /api/probe-models` + Combobox 替代手填 |
| [llm-driver-knobs](decisions/llm-driver-knobs.md) | 5 个 LLM 旋钮:model/effort/thinking/fallbackModel/maxTurns |
| [sqlite-over-keychain](decisions/sqlite-over-keychain.md) | 跨平台 SQLite 凭据 vs macOS Keychain |

### UI / 主题 / 数据

| 条目 | 一句话 |
| --- | --- |
| [three-column-accordion-layout](decisions/three-column-accordion-layout.md) | 主页三栏 + 左+中手风琴 · h-screen 锁视口 |
| [three-modes-progressive-disclosure](decisions/three-modes-progressive-disclosure.md) | M1 / M2 / M3 三种模式渐进披露 |
| [composer-six-four-vertical-split](decisions/composer-six-four-vertical-split.md) | Composer 6:4 垂直比例(`flex-[3]/[2]`) |
| [m2-entry-textless-only](decisions/m2-entry-textless-only.md) | M2 入口必须从无文本出发 |
| [jobs-as-placeholder-tiles](decisions/jobs-as-placeholder-tiles.md) | 进行中任务作为占位 tile 进 grid |
| [llm-as-accelerator-not-requirement](decisions/llm-as-accelerator-not-requirement.md) | 字段编辑器是核心,LLM 只是加速器 |
| [prose-persisted-with-prompt](decisions/prose-persisted-with-prompt.md) | 散文输入与 prompt 一起持久化(prose / aiFilledFields) |
| [masonry-row-major-library](decisions/masonry-row-major-library.md) | Gallery 用 react-masonry-css(行优先) |
| [paper-theme-locked](decisions/paper-theme-locked.md) | 视觉规范红线锁定 + glass 主题留位 |
| [shadcn-first-rule](decisions/shadcn-first-rule.md) | UI 一律优先 shadcn,禁止手撸 |
| [third-party-library-admission](decisions/third-party-library-admission.md) | 第三方功能型库按需引入(CLAUDE.md 明文) |
| [defer-conversational-redesign](decisions/defer-conversational-redesign.md) | 段 1 重对话化推迟(被字段编辑器覆盖 70%) |

### Sprite 系列

| 条目 | 一句话 |
| --- | --- |
| [sprite-sheets-over-per-option-images](decisions/sprite-sheets-over-per-option-images.md) | Sprite 大图分格 vs 每选项独立图 |
| [edge-to-edge-no-border-prompts](decisions/edge-to-edge-no-border-prompts.md) | Sprite 提示词:严格边对边,无外框 |
| [inset-zoom-on-sprite-slice](decisions/inset-zoom-on-sprite-slice.md) | Sprite 切片 4% inset 缩放 |
| [square-sprite-cells](decisions/square-sprite-cells.md) | Sprite cells 一律 1:1 正方形 |

## 外部集成

| 条目 | 一句话 |
| --- | --- |
| [claude-agent-sdk](integrations/claude-agent-sdk.md) | Agent SDK + OAuth + structured output + 冷启动 + 5 个旋钮 |
| [openai-sdk-images](integrations/openai-sdk-images.md) | OpenAI SDK images.generate + images.edit(**仅 images mode**) |
| [react-masonry-css](integrations/react-masonry-css.md) | 行优先瀑布流库(Gallery 用,代替 CSS columns) |
| [shadcn-ui-radix-cmdk](integrations/shadcn-ui-radix-cmdk.md) | shadcn/ui own 模式 + radix-ui + cmdk |
| [better-sqlite3](integrations/better-sqlite3.md) | better-sqlite3 用法 + WAL + native binding + 5 张表 |
| [hono](integrations/hono.md) | Hono 路由 + cors + HTTPException + serveStatic + Bearer middleware |
| [tailwind-v4](integrations/tailwind-v4.md) | Tailwind v4 CSS-first + `@theme inline` 映射 |
| [vite-dev-proxy](integrations/vite-dev-proxy.md) | Vite dev proxy 超时(异步化后不再关键) |
| [lucide-react](integrations/lucide-react.md) | 图标库,strokeWidth 1.5/1.75 视觉约定 |
| **[cloudflare-r2](integrations/cloudflare-r2.md)** | **R2 对象存储 + S3 兼容 SDK**(plugin v2.1 直传) |

## 工作流

| 条目 | 一句话 |
| --- | --- |
| [new-plugin-onboarding](workflows/new-plugin-onboarding.md) | **新客户接入 Plugin 通道**(链 docs/onboarding-new-plugin.md 完整版) |
| [extend-image-mode](workflows/extend-image-mode.md) | 新增 image driver 模式(images / responses 之后再加 X) |
| [dnd-kit-row-pattern](workflows/dnd-kit-row-pattern.md) | dnd-kit 行拖拽 + 嵌套交互标准模式 |
| [add-sprite-preview-sheet](workflows/add-sprite-preview-sheet.md) | 新增字段 / 刷新 sprite preview sheet 流程 |
| [add-new-provider](workflows/add-new-provider.md) | 添加新 OpenAI 兼容 provider 步骤 |
| [add-llm-driver](workflows/add-llm-driver.md) | 实现新 LLM driver(为 Phase 1.5 OpenAI Chat 铺路) |
| [update-paper-theme](workflows/update-paper-theme.md) | 改 paper token 的步骤 + 7 条自检 |

## 踩坑记录

### Plugin 通道 / 部署(2026-05-21 起持续)

| 条目 | 一句话 |
| --- | --- |
| [pnpm-onlybuiltdeps-native-build](pitfalls/pnpm-onlybuiltdeps-native-build.md) | **pnpm 10+ 默认阻止 native install scripts**,要在根 package.json 加 `pnpm.onlyBuiltDependencies` |
| [better-sqlite3-node24-prebuilt-missing](pitfalls/better-sqlite3-node24-prebuilt-missing.md) | **better-sqlite3 11.10 无 Node 24 prebuilt**,需本地 `npm run build-release` |
| [hono-default-binds-0.0.0.0](pitfalls/hono-default-binds-0.0.0.0.md) | **`@hono/node-server` 不传 hostname 默认 0.0.0.0**(公网暴露),要 `API_HOST` env 锁 loopback |
| [callback-token-plaintext-roundtrip](pitfalls/callback-token-plaintext-roundtrip.md) | **callback_token 必须 plaintext 存**,哈希破坏 X-Callback-Token round-trip |
| [cpa-internal-routes-to-anyrouter](pitfalls/cpa-internal-routes-to-anyrouter.md) | **cpa 内部转 image 到 anyrouter**,"套一层"不解决上游问题 + `198.19.x.x` 是私有 IP 不是真实 |
| [anyrouter-channel-failed-not-network](pitfalls/anyrouter-channel-failed-not-network.md) | **anyrouter `get_channel_failed` 是模型负载满**,不是网络问题(认真读 error body 不要凭直觉) |
| [plugin-task-no-deadline](pitfalls/plugin-task-no-deadline.md) | **Plugin 任务无任务级 deadline**,实测 533s 超长任务导致 inkast 显示成功但调用方已 timeout |
| [nginx-fallthrough-200-misread](pitfalls/nginx-fallthrough-200-misread.md) | **nginx 默认 location 返 200 JSON 39B**,容易被误读为 admin 端点暴露 |
| **[snapub-overlay-jdc-only](pitfalls/snapub-overlay-jdc-only.md)** | **snapub plugin overlay 不在 git,只在 jdc 手动维护**——改坏了没历史 |
| **[plugin-pool-too-narrow-by-model](pitfalls/plugin-pool-too-narrow-by-model.md)** | **plugin 通道按 model/size 过滤后 pool 实际只剩 N/8 个**,某些 provider 故障时全 pool 失效 |

### Provider 故障性质 / 渠道挑选(2026-05-22 实测产物)

| 条目 | 一句话 |
| --- | --- |
| **[duck-moderation-probabilistic](pitfalls/duck-moderation-probabilistic.md)** | **duckcoding 漫威拒图是概率性 false negative**,5 次约 1 次过——靠 retry 多次抽签,不靠参数 |
| **[anyrouter-pseudo-stream-deep-failure](pitfalls/anyrouter-pseudo-stream-deep-failure.md)** | **gpt-5.3-codex "假活流"是上游模型节点宕机**,retry 同 provider 浪费 600s——按 `[[per-capability-retry-budget]]` 给 cpa/any 配 retry=0 |
| **[cf-120s-images-mode-only](pitfalls/cf-120s-images-mode-only.md)** | **CF 反代 120s 兜底 only 影响 images mode**,SSE 流式头立即返绕过——`ioll.pp.ua` 这类切到 responses+stream:true |
| **[moderation-low-ineffective-on-resellers](pitfalls/moderation-low-ineffective-on-resellers.md)** | **moderation:"low" 对二道贩子代理无效**,duck 加这参数反而完全挂死——别用 |

### 渠道结构性问题(anyrouter + image_generation 调研产物)

| 条目 | 一句话 |
| --- | --- |
| [anyrouter-complex-prompt-ceiling](pitfalls/anyrouter-complex-prompt-ceiling.md) | 复杂 prompt + 参考图 = 0% 成功,渠道结构能力上限,driver 救不了 |
| [anyrouter-body-size-cap](pitfalls/anyrouter-body-size-cap.md) | body > ~200KB 直接 RST(5 分钟整),必须压缩 refs |
| [anyrouter-via-cdn-queue](pitfalls/anyrouter-via-cdn-queue.md) | 跨大洲 Akamai 5 跳排队 170-300s,via 头暴露 |
| [image-gen-requires-reasoning](pitfalls/image-gen-requires-reasoning.md) | image_generation 锁死 reasoning_effort=minimal(OpenAI 设计) |
| [undici-default-timeout-short](pitfalls/undici-default-timeout-short.md) | undici 默认 5 分钟超时被 CDN 排队杀,要拉到 10 分钟 |

### Responses-mode driver

| 条目 | 一句话 |
| --- | --- |
| [sdk-responses-stream-strict](pitfalls/sdk-responses-stream-strict.md) | SDK 流式 parser 严格:必须以 `response.created` 开头,代理跳过就 throw |
| [proxy-no-retrieve-endpoint](pitfalls/proxy-no-retrieve-endpoint.md) | 第三方代理不实现 `GET /v1/responses/:id`,polling 路死 |
| [responses-tool-not-invoked](pitfalls/responses-tool-not-invoked.md) | 模型不调工具:JSON prompt 像 spec,需 forced tool_choice + directive |
| [responses-stream-result-missing](pitfalls/responses-stream-result-missing.md) | SSE 正常结束但没 base64:代理吞掉了 `output_item.done` |

### UI / Gallery / dnd-kit

| 条目 | 一句话 |
| --- | --- |
| [css-columns-column-major](pitfalls/css-columns-column-major.md) | CSS `columns-*` 是列优先填充,瀑布流不能用 |
| [gallery-aspect-square-crop](pitfalls/gallery-aspect-square-crop.md) | `aspect-square + object-cover` 让所有图变正方形 |
| [dnd-kit-drop-animation-jitter](pitfalls/dnd-kit-drop-animation-jitter.md) | handleDragEnd 双 setState 中断 drop 动画 |
| [paper-accent-shadcn-collision](pitfalls/paper-accent-shadcn-collision.md) | paper `--accent` 与 shadcn 默认 hover 语义冲突 |
| [dialog-grid-min-h-0](pitfalls/dialog-grid-min-h-0.md) | grid/flex 嵌套缺 min-h-0 → img max-h 失效 |
| [chinese-fallback-songti](pitfalls/chinese-fallback-songti.md) | 衬线字体让中文落到宋体 |
| [dark-class-position-bug](pitfalls/dark-class-position-bug.md) | dark class 加错位置 |

### LLM / API / 数据

| 条目 | 一句话 |
| --- | --- |
| [llm-sdk-cold-start](pitfalls/llm-sdk-cold-start.md) | Claude Agent SDK 首次冷启动 ~7s,warmup 缓解 |
| [openai-image-api-no-seed](pitfalls/openai-image-api-no-seed.md) | OpenAI Image API 不返回 seed,UI 不能显示 |
| [llm-json-quote-escaping](pitfalls/llm-json-quote-escaping.md) | 模型字符串内未转义引号(schema 解决) |
| [hmr-restart-aborts-jobs](pitfalls/hmr-restart-aborts-jobs.md) | tsx watch 重启丢 in-flight jobs |
| [browser-idle-timeout-long-http](pitfalls/browser-idle-timeout-long-http.md) | 浏览器 4-5min idle 断 fetch |
| [reference-edit-endpoint-not-universal](pitfalls/reference-edit-endpoint-not-universal.md) | OpenAI 兼容 `/v1/images/edits` 不全 |
| [cdn-edge-403-without-ua](pitfalls/cdn-edge-403-without-ua.md) | raw fetch 无 UA 被 CDN 拦 |
| [base-url-typo-silent-403](pitfalls/base-url-typo-silent-403.md) | provider base URL 错字 → 静默 403 |
| [image-driver-timeout-chain](pitfalls/image-driver-timeout-chain.md) | driver/proxy/SDK 三层超时协调 |
| [object-shaped-subject-stringify](pitfalls/object-shaped-subject-stringify.md) | LLM 返 object subject 渲染成 `[object Object]` |
| [sdk-output-format-missing](pitfalls/sdk-output-format-missing.md) | SDK 不传 output_format 走 URL 慢路径 |
| [pool-moderation-no-fallover](pitfalls/pool-moderation-no-fallover.md) | 内容审查拒绝故意不切,防绕审 |
| [schema-sql-path-resolution](pitfalls/schema-sql-path-resolution.md) | schema.sql 用 import.meta.url 解析 |
| [tsx-watch-syntax-kill](pitfalls/tsx-watch-syntax-kill.md) | tsx watch 遇语法错会 kill 进程 |
| [dev-server-port-collision](pitfalls/dev-server-port-collision.md) | 老进程没死透 8787 双 listen |

### Sprite

| 条目 | 一句话 |
| --- | --- |
| [asymmetric-cell-descriptions](pitfalls/asymmetric-cell-descriptions.md) | Sprite cells 描述长度不均 → 行高/列宽不等 |
| [numbers-leak-into-sprite-cells](pitfalls/numbers-leak-into-sprite-cells.md) | 提示词用 "1./2./..." 数字编号会画进 cells |
| [cream-paper-creates-outer-border](pitfalls/cream-paper-creates-outer-border.md) | "cream paper + gridlines" 制造外层边框 |
| [sprite-cell-edge-artifacts](pitfalls/sprite-cell-edge-artifacts.md) | Sprite cell 边缘像素瑕疵 |

---

## 数据流全景

```
顶部 Tab:[起草] [作品]  ← 进门默认起草

起草 Tab(三栏 + 手风琴):

  ┌─────────────────┬──────────────────┬──────────────────┐
  │ 左:PromptComposer│ 中:PromptFieldEd │ 右:SessionWorkspc│
  │  (default 1.4fr)│  (default 0.42fr)│  (always 0.6fr)  │
  │                  │                  │                  │
  │ textarea + 按钮  │  collapsed stub  │  jobs(loading)   │
  │   [▶ 直接生图 M1]│  (5 个数字编号)  │  + records(完成) │
  │   [✦ AI 扩充 M3] │                  │  grid-cols-3     │
  │   ⊞ 跳过文本 M2  │                  │                  │
  └─────────────────┴──────────────────┴──────────────────┘
              │
              ▼ 生图触发 → submitJob /api/jobs/generate → 后台 runGenerationJob

[作品] Tab(独立全屏):
  GalleryPage → listGenerations(200) → 6 列 grid + 搜索 + Type filter chips
    点卡片 → GalleryDetailDialog → readOnly 字段编辑器 + 复用/下载

────────────────────────────────────────────────────────────────────

第二条通道:Plugin Channel(对外接入,Bearer Token 鉴权)

公网请求 ──→ jdc nginx /inkast/ 反代 ──→ 127.0.0.1:8787/plugins/v1/*
                                                  │
                              POST /submit ──┬───→ │ 立即返 task_id (≤100ms)
                                              │   │   └─ 写 plugin_tasks 表
                                              │   │   └─ 入 in-memory queue
                                              │   │   └─ 后台 worker (concurrency cap=2)
                                              │   │       ├─ skipLlmExpansion?
                                              │   │       │   是 → 拼 prompt + 约束块
                                              │   │       │   否 → draftPrompt + enforceFields 覆盖
                                              │   │       ├─ generateImage(走 provider 池)
                                              │   │       ├─ 按 plugin.imageStorage.kind 分两条路:
                                              │   │       │   b64 → sharp JPEG q80 → markTaskSucceeded(b64Json)
                                              │   │       │   r2  → sharp PNG → putImage(R2 retry 0.5/2/8s)
                                              │   │       │        → markTaskSucceeded(imageUrl)
                                              │   │       └─ POST callback_url + X-Callback-Token
                                              │   │           body:b64 模式 {b64_json,mime,...}
                                              │   │                r2 模式 {image_url,mime,...}
                                              │   │           ↓(非 2xx 退避重试 5s/30s/5min × 3)
                                              │   │       → 4 次失败 → callback_lost
                                              │
                              GET /status/:id ─────→ 兜底拉:image_url 优先,b64_json 兜底(v2.1 双协议)

INKAST_PLUGIN_DIR/*.json (overlay) ──→ registry.ts (loader.ts + zod) ──→ in-memory plugins Map
INKAST_PLUGIN_TOKEN_<UPPER_ID> env ──→ tokenToPluginId Map
R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY env ──→ r2.ts driver

/admin/plugin-stats (loopback only) ──→ HTML dashboard(两 section:Plugin 通道 + Web UI 通道,中文,meta refresh 60s)
```

---

<!-- codewise-meta:start -->
## 同步元信息

- **codewise_version**: `1`
- **baseline_commit**: `e63141b59ead9e6e32b1a048e0a3081e797ca499`
- **synced_at**: `2026-05-22T01:49:43+08:00`
- **scope_root**: `.`
- **multi_codetree**: `apps/api/src/, apps/web/src/, packages/shared/src/`

> 此区域由 codewise 自动维护,**请勿手动编辑**。增量更新基于 `baseline_commit` 计算 git 差量、基于 `synced_at` 判定会话提取边界。`multi_codetree` 字段记录本次扫描覆盖的代码树范围,便于追溯。
<!-- codewise-meta:end -->
