# Inkast 知识库

快速理解项目的入口。按需跳转,不需要全部阅读。

**技术栈**: pnpm monorepo · Hono + better-sqlite3(后端) · Vite + React 18 + Tailwind v4 + shadcn/ui(前端) · @anthropic-ai/claude-agent-sdk(LLM 默认通道) · openai SDK(图像生成 + 参考图) · sharp(JPEG transcode + cover-fit resize) · zod(plugin overlay schema 校验)

> **两套部署**:① 主线 inkast(本地优先 BYOK,Web UI + Plugin 通道) ② **公开版(apps/api-public + apps/web-public)** —— 多用户平台:Linux.do OAuth · 余额 saga · 充值外挂 · 透明代理/兜底生图 · 限流 · IndexedDB 本地存。新人先读 [architecture-overview](domains/architecture-overview.md)(主线)与 [public-edition-overview](domains/public-edition-overview.md)(公开版)。

<!-- codewise-docs:start -->
## 项目文档导航

本项目作者维护的人写文档,**这些是权威源**——比 knowledge/ 自动生成的更准。

### 入门 / 项目说明

- [CLAUDE.md](../../CLAUDE.md) — 项目宪法。覆盖六件事:(1) 项目血统(来自 gpt-image-canvas + imagegen);(2) 五条关键设计决策(LLM 双通道、provider 池语义、不用 tldraw、imagegen 方法论、本地优先);(3) 技术栈速查;(4) **Paper 主题视觉规范红线**(字体/颜色/形状/UI 组件库 4 套自检清单);(5) Phase 1 MVP 范围 + 不要做的事清单;(6) **新增"第三方库准入"段** —— 明确"功能型库按需引入,不要被通用准则误导成项目级硬约束",见 [third-party-library-admission](decisions/third-party-library-admission.md)。**UI 组件库** 硬性规则段:UI 一律优先 shadcn,禁止手撸通用交互组件,见 [shadcn-first-rule](decisions/shadcn-first-rule.md)。

### Plugin 通道 / 产品化(2026-05-21 新增)

- [docs/plugin-overlay.md](../plugin-overlay.md) — Plugin overlay 机制权威说明。"客户特化 = 配置数据,不是代码 fork"原则。包含:加载流程、JSON Schema 完整定义、Token 管理(env 不进 JSON)、跟 git 分支模型的对比、未来 hook 扩展点设计。**理解 inkast 产品化必读**。
- [docs/onboarding-new-plugin.md](../onboarding-new-plugin.md) — 给新客户接入 inkast plugin 通道的 step-by-step checklist。9 节覆盖:前提确认 / 决定身份 / 创建 overlay 仓 / 设计 plugin JSON(5 个决策点) / 部署到服务器 / 给对方接入信息 / 验证 checklist / 故障排查速查表 / 主线升级时。新客户加入按这份操作不会卡。

### 故障排查(2026-05-25 新增)

- [docs/debugging-playbook.md](../debugging-playbook.md) — 用户报"失败了 / 出错了 / 效果不对"时按这份 SOP 走。通道速记(Web UI vs Plugin)、信息源三件套(SQLite/journal/用户描述)、Step1-3 决策树 Q1-Q6(error_code / trigger code / rewritten 非空 / success_round / post_review_edited / throttle)、附录:image pool 现状、LLM fallover 顺序、rewrite chain 速记、部署节奏、凭据红线、常用 grep 关键字、**附录 G plugin gallery 数据缺失排查(v2 长期表语义)**。**任何 plugin 通道排查任务的第一阅读源**。

### Skill 接入(2026-06-16 新增)

- [docs/skill-integration.md](../skill-integration.md) — Inkast 本机生图 API Skill 接入手册。Base URL `localhost:21731`,4 个核心端点(`draft-prompt` / `jobs/generate` / `jobs/:id` / `generations/:id/image`),完整 bash 示例,参考图格式(`generation` / `upload` 两种 kind),**三种 image mode 下参考图的自动路由表**(images 单张 / responses 多张 / c2i-tasks 无限制),c2i-tasks 异步任务流程说明。Claude Code skill 或本地 Agent 接入前必读。
<!-- codewise-docs:end -->

<!-- codewise-interfaces:start -->
## 接口契约速查

inkast 所有对外调用入口的快速地图。**完整签名以代码为准**——本表只列"名 + 职责 + 入口位置"。

### REST endpoints(主线 Web UI + Plugin + admin + 公开版)

**Web UI 通道(`/api/*`,本机访问)**:

| 方法 | 路径 | 职责 | 入口 |
| --- | --- | --- | --- |
| GET | `/api/health` | 健康检查 | `apps/api/src/server/app.ts` |
| POST | `/api/llm/warmup` | 触发本机 ClaudeCode SDK 预热(冷启动缓解,返回 `{durationMs}`) | `apps/api/src/server/routes/prompt.ts` |
| POST | `/api/draft-prompt` | 散文 → 结构化 JSON prompt(LLM 驱动) | `apps/api/src/server/routes/prompt.ts` |
| POST | `/api/generate-image` | **同步**生图;前端已不调用,留作兜底 | `apps/api/src/server/routes/generate.ts` |
| GET | `/api/generations` | 历史列表(默认 100,可 `?limit=`) | `apps/api/src/server/routes/generate.ts` |
| GET | `/api/generations/:id/image` | 有 image_url 则 **302 跳 R2 CDN**,否则返本地字节(dev/pre-R2) | `apps/api/src/server/routes/generate.ts` |
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
| **POST** | **`/plugins/v1/images/submit`** | **v2 异步 submit**,立即返 task_id(≤100ms);body 可附 `pipeline_policy`(skip_original/max_round/post_review_edit)控制 rewrite chain | `apps/api/src/server/routes/plugins.ts` |
| **GET** | **`/plugins/v1/images/status/:id`** | **callback 兜底拉**,返当前状态 + **`image_url`(v2.1 r2 模式)或 `b64_json`(v2 b64 模式)双协议兼容** | `apps/api/src/server/routes/plugins.ts` |

**管理端(`/admin/*`,loopback only,nginx 不暴露)**:

| 方法 | 路径 | 职责 | 入口 |
| --- | --- | --- | --- |
| **GET** | **`/admin/plugin-stats`** | **两通道运行状态 HTML dashboard**(Plugin + Web UI 双 section),服务端渲染 + meta refresh 60s + attempts 链徽章 + 失败浮层 + plugin-gallery chip | `apps/api/src/server/routes/admin.ts` |
| **GET** | **`/admin/plugin-gallery.json`** | **SPA gallery 数据源**,读独立长期表 `plugin_gallery_items`,**不受 24h GC**;keyset cursor 分页(`?cursor=<createdAt>_<id>&limit=60&pluginId=...`),响应含 `nextCursor` + `total` + `pluginCounts` | `apps/api/src/server/routes/admin.ts` |

**详情**: [async-job-pipeline](domains/async-job-pipeline.md) · [provider-pool](domains/provider-pool.md) · [image-generation](domains/image-generation.md) · [prompt-engine](domains/prompt-engine.md) · [reference-image](domains/reference-image.md) · **[plugin-channel](domains/plugin-channel.md)** · **[rewrite-chain](domains/rewrite-chain.md)** · **[post-review-edit](domains/post-review-edit.md)** · **[admin-dashboard](domains/admin-dashboard.md)** · **[plugin-gallery](domains/plugin-gallery.md)**

**公开版通道(`/api/*`,apps/api-public 独立进程,公网 inkast.124213.xyz)**:

| 方法 | 路径 | 职责 | 入口 |
| --- | --- | --- | --- |
| GET | `/api/health` | 健康检查 | `apps/api-public/src/server/app.ts` |
| GET | `/api/auth/linuxdo/authorize` | Linux.do OAuth 授权跳转(state CSRF + PKCE S256) | `apps/api-public/src/server/routes/auth.ts` |
| GET | `/api/auth/linuxdo/callback` | OAuth 回调,换 token + upsertUser + 建 session | `apps/api-public/src/server/routes/auth.ts` |
| POST | `/api/auth/logout` | 删 session + 清 cookie | `apps/api-public/src/server/routes/auth.ts` |
| GET | `/api/auth/me` | 当前用户 + 余额 | `apps/api-public/src/server/routes/auth.ts` |
| POST | `/api/gen/passthrough` | 透明代理生图(用户自带 key,cost=0,凭据零持久化) | `apps/api-public/src/server/routes/gen.ts` |
| POST | `/api/gen/builtin` | 兜底生图(平台 key,saga 扣余额 + 失败退款) | `apps/api-public/src/server/routes/gen.ts` |
| POST | `/api/prompt/draft` | 散文→JSON prompt(透明代理或 builtin) | `apps/api-public/src/server/routes/prompt.ts` |
| POST | `/api/topups/invite/redeem` | 邀请码兑换余额(tryClaim 原子) | `apps/api-public/src/topups/invite-code/routes.ts` |

**详情(公开版)**: [public-edition-overview](domains/public-edition-overview.md) · [public-auth](domains/public-auth.md) · [public-image-gen](domains/public-image-gen.md) · [public-prompt-engine](domains/public-prompt-engine.md) · [public-topup](domains/public-topup.md) · [public-rate-limit](domains/public-rate-limit.md)

### 契约文件(前后端共享类型)

| 文件 | 类型 | 关键导出 |
| --- | --- | --- |
| `packages/shared/src/prompt.ts` | TS types | `ImagePrompt` / `TextElement` / `AmbiguityHint` / `PromptDraft` |
| `packages/shared/src/api.ts` | TS types + 常量 | `OutputLang` / `DraftPromptRequest/Response` / `GenerateImageRequest/Response` / `ProviderSummary` / `ProviderCapability` / `GenerationRecord` / `ReferenceImage` / `JobStatus` / `JobRecord` / `SubmitJobRequest/Response` / `ListJobsResponse` / `ImageGenerationMode` / `IMAGE_GENERATION_MODE_DEFAULT` / `SIZE_AUTO` / `SIZE_RATIO_PREFIX` / `isRatioSize()` / `extractRatio()` / `makeRatioSize()` / `BUILTIN_CLAUDE_CODE_PROVIDER_ID` |
| `apps/api/src/plugins/types.ts` | TS types | **`InkastPlugin` 接口** —— plugin overlay JSON schema 的代码端定义 |
| `apps/api/src/plugins/loader.ts` | zod schemas | **InkastPluginSchema + ImageSizeSchema + LlmBackendDescriptorSchema** —— overlay JSON 运行时校验 |

**详情**: [shared-contracts](shared/shared-contracts.md) · [plugin-overlay-loader](shared/plugin-overlay-loader.md)

### 数据库 Schema(主线 6 表)

`apps/api/src/storage/schema.sql` —— 启动时幂等 `CREATE TABLE IF NOT EXISTS` + `db.ts migrate()` ALTER 补列:

| 表 | 用途 |
| --- | --- |
| `providers` | OpenAI 兼容 provider 凭据(AES-256-GCM 加密 BLOB) |
| `provider_capabilities` | per-kind 能力行(`provider_id, kind, model, priority, disabled, extras`),复合索引 `(kind, priority)` |
| `generations` | Web UI 生图历史(含 `prose` / `ai_filled_fields` 字段) |
| `jobs` | Web UI 异步任务(同步加 `prose` / `ai_filled_fields`) |
| **`plugin_tasks`** | **Plugin 通道异步任务**(独立于 jobs):状态 + **`b64_json`(v2)** + **`image_url`(v2.1 起,r2 模式)** + callback_url + callback_token + provider_id/name + 24h GC |
| **`plugin_gallery_items`** | **Plugin 通道长期作品归档**(v2 引入):`markTaskSucceeded(r2)` 同事务双写,**不参与 GC**;按 `(created_at DESC, id DESC)` 索引,keyset cursor 分页;b64 模式不入此表 |

**详情**: [better-sqlite3](integrations/better-sqlite3.md) · [async-job-pipeline](domains/async-job-pipeline.md) · [plugin-channel](domains/plugin-channel.md) · [provider-capability-table-split](decisions/provider-capability-table-split.md)

### 公开版数据库 Schema(apps/api-public,8 表)

`apps/api-public/src/storage/schema.sql` + `topups/*/schema.sql` —— 独立 DB `inkast-public.sqlite`(`data-public/`):

| 表 | 用途 |
| --- | --- |
| `users` | Linux.do 用户(`linux_do_id` 唯一 + status active/banned) |
| `sessions` | 会话 token(32B hex,30 天 TTL,httpOnly cookie) |
| `oauth_states` | OAuth state + PKCE verifier(10min TTL,一次性消费防重放) |
| `user_balance` | 用户余额(单位"次",每用户 1 行,better-sqlite3 事务原子) |
| `balance_ledger` | 余额流水(`type` 开放字符串,`delta` 正负,`balance_after` 冗余可对账) |
| `gen_tasks` | 生图任务元数据(channel passthrough/builtin,凭据绝不入) |
| `rate_limit` | 限流计数(scope PK,固定窗口) |
| `invite_codes` | 邀请码(topups 外挂表,tryClaim 原子标记防并发) |

**详情**: [public-balance](domains/public-balance.md) · [public-auth](domains/public-auth.md) · [public-topup](domains/public-topup.md) · [public-image-gen](domains/public-image-gen.md) · [public-rate-limit](domains/public-rate-limit.md)

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
| `inkast-storage` | `static.124213.xyz` | (1) `previews/` sprite 预览图(主线+公开版同步);(2) `public/gen/` 公开版生图中转 |

**详情**: [cloudflare-r2](integrations/cloudflare-r2.md) · [previews-migrate-r2](decisions/previews-migrate-r2.md) · [public-image-gen](domains/public-image-gen.md) · cc 仓库 `servers/cloudflare-r2/README.md`
<!-- codewise-interfaces:end -->

---

## 按功能域

| 条目 | 一句话 |
| --- | --- |
| [architecture-overview](domains/architecture-overview.md) | 整体架构 + 数据流全景(Web UI 通道 + Plugin 通道) · **新人第一站** |
| [plugin-channel](domains/plugin-channel.md) | **Plugin 通道(v2 异步 callback,对外接入)** · submit + status + worker (MAX_CONCURRENT=25) + rewrite + post-review + retry + transcode + recovery |
| [rewrite-chain](domains/rewrite-chain.md) | **3 轮 LLM 改写降级**(round 0 失败 → r1 视觉重写 / r2 措辞重组 / r3 形态最宽),body+palette+archetype 三锚定 |
| [post-review-edit](domains/post-review-edit.md) | **r2/r3 后的视觉审查 + edit**(LLM 看图判 looks_like_target,不像就跑 image edit pipeline) |
| [admin-dashboard](domains/admin-dashboard.md) | **`/admin/plugin-stats` 服务端 HTML dashboard**(loopback only,两 section + attempts 徽章浮层 + plugin-gallery chip) |
| [plugin-gallery](domains/plugin-gallery.md) | **Web 端浏览 plugin 通道生成图**(SPA Tab + react-masonry,**长期归档**,cursor 分页 + 无限滚动 + 详情 Dialog 展开 rewrite chain) |
| [field-editor](domains/field-editor.md) | 字段编辑器中栏(collapsed/expanded 两态,lockMode 驱动) |
| [session-workspace](domains/session-workspace.md) | 起草 Tab 右栏 · 本次会话作品 + jobs 占位 tile · 刷新清空 |
| [async-job-pipeline](domains/async-job-pipeline.md) | Web UI 异步生图任务流水线 + polling + 重启 reaper |
| [reference-image](domains/reference-image.md) | 参考图生图(`images.edit` 路径) |
| [sprite-previews](domains/sprite-previews.md) | 字段选项真实预览图(14 张 sprite sheet) |
| [i18n](domains/i18n.md) | 中英双语 + LLM 输出语言切换 |
| [prompt-engine](domains/prompt-engine.md) | 散文 → JSON prompt 引擎(imagegen 方法论的实现) |
| [provider-pool](domains/provider-pool.md) | OpenAI 兼容 provider 池 + 故障切换语义 |
| [image-generation](domains/image-generation.md) | 生图端到端(driver → 纯 R2 持久化 → 入库) |
| [gallery](domains/gallery.md) | [作品] Tab 历史 · 搜索+type filter + 详情弹窗(readOnly 字段编辑器) |

### 公开版(apps/api-public + apps/web-public)

| 条目 | 一句话 |
| --- | --- |
| [public-edition-overview](domains/public-edition-overview.md) | **公开版整体架构 + 数据流全景** · 公开版新人第一站 |
| [public-auth](domains/public-auth.md) | Linux.do OAuth 登录 + session(PKCE + state CSRF + httpOnly cookie) |
| [public-balance](domains/public-balance.md) | 余额系统 + ledger 流水(better-sqlite3 事务原子 debit/credit) |
| [public-topup](domains/public-topup.md) | 充值外挂架构 + 邀请码(topups 插件化,tryClaim 防并发) |
| [public-image-gen](domains/public-image-gen.md) | 生图双通道(透明代理 cost=0 / 兜底 saga 扣费) + R2 中转 |
| [public-prompt-engine](domains/public-prompt-engine.md) | 公开版散文→JSON 引擎(imagegen 蒸馏 120 行) |
| [public-rate-limit](domains/public-rate-limit.md) | 限流(固定窗口 + IP/user 双维度) |
| [public-web](domains/public-web.md) | 公开版前端(fork 主线 + IndexedDB 本地存 + 登录入口) |

## 按技术层

| 条目 | 一句话 |
| --- | --- |
| [shared-contracts](shared/shared-contracts.md) | `@inkast/shared` 前后端共享类型契约 |
| [http-agent](shared/http-agent.md) | 全局 undici dispatcher(10 分钟超时,适配 CDN 排队) |
| [plugin-overlay-loader](shared/plugin-overlay-loader.md) | **Plugin overlay JSON 加载 + zod 校验** + env token 装配 |
| [llm-fallover](shared/llm-fallover.md) | **LLM 调用 multi-backend fallover helper**(env primary → priority → claude-code 兜底,postValidate hook 拒半残) |
| [throttle](shared/throttle.md) | **per-provider rate-limit throttle**(min_interval_ms,匀速节流,默认 60 RPM,can capability.extras 单调) |
| [shadcn-primitives](shared/shadcn-primitives.md) | 已 own 的 11 个 shadcn 原语 + 业务包装 |
| [field-dictionary](shared/field-dictionary.md) | 6 字段选项词典 + 双语 + sprite 元数据 |
| [i18n-dictionary](shared/i18n-dictionary.md) | `Translations` 类型 + zh/en 字典 + useLanguage hook |
| [paper-theme-tokens](shared/paper-theme-tokens.md) | paper.css token + globals 全站效果(**视觉真理源**) |
| [cn-util](shared/cn-util.md) | clsx + tailwind-merge 的 cn() helper |
| [crypto-utils](shared/crypto-utils.md) | AES-256-GCM 凭据加密 + master.key |
| [public-idb-storage](shared/public-idb-storage.md) | **公开版前端 IndexedDB 本地存储**(4 个独立 dbName,idb-keyval) |

## 设计决策

### Plugin 通道 / 产品化(2026-05-21 起持续)

| 条目 | 一句话 |
| --- | --- |
| [json-overlay-vs-branch](decisions/json-overlay-vs-branch.md) | **客户特化走 JSON overlay 而非 git fork**(数据 vs 代码 fork) |
| [v2-async-callback-protocol](decisions/v2-async-callback-protocol.md) | **Plugin 通道走 v2 异步 callback,不是 v1 同步**(60s 云函数硬约束 + 实测 533s 超长任务) |
| [plugin-channel-isolation](decisions/plugin-channel-isolation.md) | **Plugin 通道与 Web UI 完全分离**(独立 plugin-async + plugin_tasks 表) |
| **[r2-direct-upload-v2.1](decisions/r2-direct-upload-v2.1.md)** | **v2.1 R2 直传,callback 改返 image_url**(JDC 上行省 95% + uniCloud 出站归零) |
| **[webui-channel-pure-r2](decisions/webui-channel-pure-r2.md)** | **Web UI 通道生图改纯 R2**(v2.43,不留本地,302 跳 CDN,对齐 plugin 通道) |
| **[per-capability-retry-budget](decisions/per-capability-retry-budget.md)** | **每个 image provider 单独配 retry 次数**(0-5,默认 1) |
| **[three-anchor-design](decisions/three-anchor-design.md)** | **Rewrite chain 三锚定演进**(body+palette+archetype),从 v2.20 五字段 → v2.21 两字段砍过头 → v2.22 加 archetype 折中 |
| **[pipeline-policy](decisions/pipeline-policy.md)** | **调用方控制 rewrite chain + post-review 行为**(skipOriginal/maxRound/postReviewEdit,in-memory 不入库) |
| **[cjk-bracket-atomic-protocol](decisions/cjk-bracket-atomic-protocol.md)** | **v2.30**:plugin prompt 协议切到 CJK「」原子格式,`「char」. Style and theme: 「style」`,不留兼容 |
| **[style-as-fourth-anchor](decisions/style-as-fourth-anchor.md)** | **v2.30**:style 升级为第四个硬锚定(identity+character+palette+style),force-prepend 兜底防 LLM 翻译/近义改写 |
| **[palette-anchors-llm-not-keyword](decisions/palette-anchors-llm-not-keyword.md)** | **v2.31**:palette_anchors 用 R1 system prompt 加 style-aware 语义规则,**否决**关键词检测兜底(给 LLM 语义判断空间) |
| **[plugin-gallery-long-term-archive](decisions/plugin-gallery-long-term-archive.md)** | **v2.34**:plugin gallery 拆独立成品表 `plugin_gallery_items`,`markTaskSucceeded(r2)` 同事务双写,跟 `plugin_tasks` 24h GC 解耦 |

### 公开版(apps/api-public + apps/web-public)

| 条目 | 一句话 |
| --- | --- |
| **[public-edition-separate-app](decisions/public-edition-separate-app.md)** | **公开版做独立 app,不做 plugin overlay / 模式开关**(主线本地优先宪法保持纯净) |
| **[passthrough-vs-builtin-gen](decisions/passthrough-vs-builtin-gen.md)** | **生图二选一:透明代理(用户 key)vs 兜底(平台 key)**;CORS 下"零持久化"非"不出本机" |
| **[balance-saga](decisions/balance-saga.md)** | **builtin 生图用 saga**(先扣后退),失败 credit 补偿 + ledger 双笔留痕 |
| **[topup-plugin-architecture](decisions/topup-plugin-architecture.md)** | **充值通道插件化,核心只暴露 credit()**(新通道加目录 + 一行 register) |
| **[ledger-open-string-type](decisions/ledger-open-string-type.md)** | **balance_ledger.type 用开放字符串非 enum**(新通道免 schema migration) |
| **[ldc-deferred-invite-first](decisions/ldc-deferred-invite-first.md)** | **LDC 推迟 Phase 2,邀请码先行**(快速验证产品形态) |
| **[public-idb-over-backend](decisions/public-idb-over-backend.md)** | **公开版前端用 IndexedDB 而非后端存储**(多用户 stateless,key 留客户端) |
| **[responsive-deferred](decisions/responsive-deferred.md)** | **响应式做了又整体 revert**,改为以后单独做 mobile 版(演变记录) |

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
| **[codex-header-via-flag-not-freeform](decisions/codex-header-via-flag-not-freeform.md)** | **v2.33**:Codex CLI header 通过 `extras.useCodexHeader: bool` 暴露,后端常量化 headers,**否决** free-form headers JSON(v2.37 起 image + LLM driver 共用 `drivers/codex-header.ts`) |
| **[multi-channel-quota-exemption](decisions/multi-channel-quota-exemption.md)** | **多渠道聚合 provider 的 quota 豁免**(`extras.exemptAutoDisable`,单子渠道满不熔断整条,fall through retry) |
| **[fallover-pool-db-order](decisions/fallover-pool-db-order.md)** | **v2.37**:LLM fallover 池序以 DB priority 为准,env 不再重排(Web 拖拽所见即所得) |
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
| **[previews-migrate-r2](decisions/previews-migrate-r2.md)** | **Sprite 预览图迁 R2**(`static.124213.xyz`),jdc 带宽 + 公开版 SPA fallback 双动因 |

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
| **[cloudflare-r2](integrations/cloudflare-r2.md)** | **R2 对象存储 + S3 兼容 SDK**(plugin v2.1 直传 + previews + 公开版生图中转) |
| **[linuxdo-oauth](integrations/linuxdo-oauth.md)** | **Linux.do Connect OAuth**(Discourse OAuth2 + PKCE,公开版登录) |

## 工作流

| 条目 | 一句话 |
| --- | --- |
| [new-plugin-onboarding](workflows/new-plugin-onboarding.md) | **新客户接入 Plugin 通道**(链 docs/onboarding-new-plugin.md 完整版) |
| [deploy-jdc](workflows/deploy-jdc.md) | **部署 inkast-api 到 jdc**(build + rsync + restart + 健康检查 + changelog 留痕,含 env 改 / DB 改不重启的边界) |
| [migrate-webui-images-to-r2](workflows/migrate-webui-images-to-r2.md) | **Web UI 存量图迁 R2**(部署 → dry-run → apply → verify → 守卫删本地,无停机) |
| **[deploy-public-edition](workflows/deploy-public-edition.md)** | **部署公开版到 jdc**(api-public + web-public,systemd + nginx,含 chmod 711 / OAuth callback / R2 配置) |
| **[add-topup-channel](workflows/add-topup-channel.md)** | **新增充值通道**(外挂模式:schema + repository + service + routes + index + 挂载,invite-code 为模板) |
| [extend-image-mode](workflows/extend-image-mode.md) | 新增 image driver 模式(images / responses 之后再加 X) |
| [dnd-kit-row-pattern](workflows/dnd-kit-row-pattern.md) | dnd-kit 行拖拽 + 嵌套交互标准模式 |
| [add-sprite-preview-sheet](workflows/add-sprite-preview-sheet.md) | 新增字段 / 刷新 sprite preview sheet 流程 |
| [add-new-provider](workflows/add-new-provider.md) | 添加新 OpenAI 兼容 provider 步骤 |
| [add-llm-driver](workflows/add-llm-driver.md) | 实现新 LLM driver(为 Phase 1.5 OpenAI Chat 铺路) |
| [update-paper-theme](workflows/update-paper-theme.md) | 改 paper token 的步骤 + 7 条自检 |

## 踩坑记录

### 公开版(apps/api-public + apps/web-public)

| 条目 | 一句话 |
| --- | --- |
| **[idb-shared-dbname-race](pitfalls/idb-shared-dbname-race.md)** | **IndexedDB 多 store 共用 dbName** → 第 2-4 个 store 从未创建，事务报 "object store was not found"——拆成 4 个独立 dbName |
| **[nginx-spa-fallback-swallows-static](pitfalls/nginx-spa-fallback-swallows-static.md)** | **nginx SPA fallback 把缺失静态文件兜底成 index.html**，preview 图全返 text/html 404——迁 R2 绝对 URL 根治 |
| **[root-700-blocks-nginx](pitfalls/root-700-blocks-nginx.md)** | **/root 权限 700 阻挡 nginx 访问静态文件**，新服务器部署必须 `chmod 711 /root` |
| **[passthrough-key-in-transit](pitfalls/passthrough-key-in-transit.md)** | **透明代理 provider key 仍经 jdc 进程内存**，"不入库"≠"不出本机"——正确边界:零持久化,非零传输 |
| **[balance-saga-orphan](pitfalls/balance-saga-orphan.md)** | **saga 非原子留孤儿账**:debit 成功后进程 crash → consume:gen 无配对 refund:gen——Phase 1 接受,对账 SQL 可查孤儿 |

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
| **[moderation-low-ineffective-on-resellers](pitfalls/moderation-low-ineffective-on-resellers.md)** | **moderation:"low" 对二道贩子代理无效**(2026-05-22 反转:虽对二道贩子无收益,但对未来 OpenAI 直连账号有用 + 没副作用,**默认开**;若 duck 因此挂死可回滚 1 行) |
| **[quota-chinese-proxy-regex](pitfalls/quota-chinese-proxy-regex.md)** | **v2.32 修**:中文反代余额不足措辞多样(`预扣费/剩余额度`),quota regex 漏匹配 → auto-disable 不触发,每次提交浪费一次 attempt |
| **[quota-multi-channel-false-positive](pitfalls/quota-multi-channel-false-positive.md)** | **多渠道聚合 provider quota 虚警**:单子渠道满被误熔断整条——`exemptAutoDisable` 豁免 + fall through retry |

### Rewrite Chain / Post-Review(2026-05-25 实测产物)

| 条目 | 一句话 |
| --- | --- |
| **[llm-half-refusal-empty-rewritten](pitfalls/llm-half-refusal-empty-rewritten.md)** | **LLM 合法 JSON 但 rewritten 字段空**(stochastic 半截 refusal),v2.25 postValidate hook 修——让 fallover helper 把空字段也当 invalid_json 跳 backend |
| **[error-code-translation-layer](pitfalls/error-code-translation-layer.md)** | **plugin error_code 是转译层**,跟 inkast 内部 ImageGenError.code 不一一对应——排查时信 error_msg 多过 error_code |
| **[edit-mode-images-pool-shrunk](pitfalls/edit-mode-images-pool-shrunk.md)** | **post-review-edit 走 requireMode=images 让 pool 缩水 60%**——只剩 3 个 mode=images provider,3 个当前实测全有问题 |
| **[review-llm-too-lenient](pitfalls/review-llm-too-lenient.md)** | **review LLM 判 looks_like_target=true 偏宽松**(10/13 直接放过明显不像的图),"画风差异不重要"被 LLM 误解成"风格剧变后主体变化也放过" |
| **[character-key-prefix-required](pitfalls/character-key-prefix-required.md)** | **Rewrite r1 vision + post-review 都依赖 PascalCase 前缀**(`「IronMan」. Style and theme: 「...」` v2.30 起 CJK 格式),没前缀 r1 退化 text-only / review 直接 skip |
| **[cjk-bracket-style-translation](pitfalls/cjk-bracket-style-translation.md)** | **v2.30 修**:旧协议下 LLM 把 style 翻译/近义改写/省略,rewritten_prompt 看似正常但出图风格漂移 |
| **[grayscale-style-palette-conflict](pitfalls/grayscale-style-palette-conflict.md)** | **v2.31 修一半**:R1 提取的角色彩色 palette 跟 grayscale style 直接冲突,出图变彩色;style-aware 规则修了多数 case,LLM 不听话仍踩 |

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
| **[shadcn-dialog-sm-max-w-lg-default](pitfalls/shadcn-dialog-sm-max-w-lg-default.md)** | **shadcn DialogContent base 含 `sm:max-w-lg`(512px)**,外部传 base 级 `max-w-X` 不能覆盖 sm: 默认值——必须用同前缀 `sm:max-w-6xl` 才行(tailwind-merge 不跨 responsive variant 合 conflict group) |
| [dialog-grid-min-h-0](pitfalls/dialog-grid-min-h-0.md) | grid/flex 嵌套缺 min-h-0 → img max-h 失效 |
| [chinese-fallback-songti](pitfalls/chinese-fallback-songti.md) | 衬线字体让中文落到宋体 |
| [dark-class-position-bug](pitfalls/dark-class-position-bug.md) | dark class 加错位置 |

### LLM / API / 数据

| 条目 | 一句话 |
| --- | --- |
| [llm-sdk-cold-start](pitfalls/llm-sdk-cold-start.md) | Claude Agent SDK 首次冷启动 ~7s,warmup 缓解 |
| **[claude-code-not-logged-in-as-result](pitfalls/claude-code-not-logged-in-as-result.md)** | **v2.32 修**:claude-code SDK 无 OAuth 时返 "Not logged in" 作为 result 字符串(不抛 error),下游当 invalid_json,error_msg 误导排查 |
| **[claude-code-tail-bypassed-disabled](pitfalls/claude-code-tail-bypassed-disabled.md)** | **v2.32 修**:`with-fallover.ts` resolveCandidates 无条件追加 claude-code tail,绕过 DB capability disabled——改成尊重 DB 显式 disable |
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
                              POST /submit ──┬───→ │ 立即返 task_id (≤100ms),可附 pipeline_policy
                                              │   │   └─ 写 plugin_tasks 表
                                              │   │   └─ 入 in-memory queue
                                              │   │   └─ 后台 worker (MAX_CONCURRENT=25)
                                              │   │       ├─ skipLlmExpansion?
                                              │   │       │   是 → 拼 prompt + 约束块
                                              │   │       │   否 → draftPrompt + enforceFields 覆盖
                                              │   │       ├─ driveWithRewriteFallback:
                                              │   │       │   round 0 generateImage(走 provider 池)
                                              │   │       │   失败有 trigger code → r1/r2/r3 LLM 重写
                                              │   │       │   (body+palette+archetype 三锚定 force-prepend)
                                              │   │       ├─ successRound∈{2,3} && postReviewEdit?
                                              │   │       │   是 → reviewAndMaybeEdit(LLM 看图判像不像)
                                              │   │       │        不像 + edit_instructions → image edit pipeline
                                              │   │       ├─ 按 plugin.imageStorage.kind 分两条路:
                                              │   │       │   b64 → sharp JPEG q80 → markTaskSucceeded(b64Json)
                                              │   │       │   r2  → sharp PNG/WEBP → putImage(R2 retry 0.5/2/8s)
                                              │   │       │        → markTaskSucceeded(imageUrl)
                                              │   │       └─ POST callback_url + X-Callback-Token
                                              │   │           body:b64 模式 {b64_json,mime,success_round,
                                              │   │                          post_review_edited,...}
                                              │   │                r2 模式 {image_url,mime,success_round,...}
                                              │   │           ↓(非 2xx 退避重试 5s/30s/5min × 3)
                                              │   │       → 4 次失败 → callback_lost
                                              │
                              GET /status/:id ─────→ 兜底拉:image_url 优先,b64_json 兜底(v2.1 双协议)

INKAST_PLUGIN_DIR/*.json (overlay) ──→ registry.ts (loader.ts + zod) ──→ in-memory plugins Map
INKAST_PLUGIN_TOKEN_<UPPER_ID> env ──→ tokenToPluginId Map
R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY env ──→ r2.ts driver

/admin/plugin-stats (loopback only) ──→ HTML dashboard(两 section:Plugin + Web UI,attempts 链徽章 + 失败浮层 + plugin-gallery chip)
/admin/plugin-gallery.json (loopback) ──→ Web 主 SPA (/?tab=plugin-gallery) → react-masonry 浏览 R2 图(长期归档 plugin_gallery_items,cursor 分页)

per-provider throttle (apps/api/src/lib/throttle.ts):
  Map<providerId, Promise> 链 + acquireProviderSlot 匀速节流
  min_interval_ms 优先级: capability.extras > env INKAST_PROVIDER_MIN_INTERVAL_MS_DEFAULT > 0

LLM 调用 fallover (apps/api/src/drivers/llm/with-fallover.ts):
  rewrite r1/r2/r3 + post-review LLM 都走;env primary → priority → claude-code 兜底
  invalid_json 同 backend retry-once,其它 LlmDriverError 立即跳下个
  postValidate hook 拒"合法 JSON 但业务字段空"(v2.25 修 LLM 半残 bug)

────────────────────────────────────────────────────────────────────

第三条通道:公开版(apps/api-public + apps/web-public,多用户平台,独立进程/独立 DB inkast-public.sqlite)

公网 inkast.124213.xyz ──→ nginx ──→ api-public(:8788)
  浏览器 ──(Linux.do OAuth: authorize→callback,PKCE + state CSRF)──→ session cookie + users 表
  浏览器侧 provider 配置 / 生图历史 ──→ IndexedDB(4 个独立 dbName,本地存,不落后端)
  生图二选一(前端按有无 user provider key 自动选):
    有 key → POST /api/gen/passthrough(透明代理转发,cost=0,凭据零持久化)
    无 key → POST /api/gen/builtin(平台 env 凭据 + saga)
               debit consume:gen → passthroughGenerate → 成功 markSuccess / 失败 credit refund:gen
               → uploadOrFallback(R2 inkast-storage/public/gen/ 或 b64 fallback)
  充值:POST /api/topups/invite/redeem(tryClaim 原子标记 + credit topup:invite)
  限流:固定窗口 IP/user 双维度(gen / prompt / redeem)
  充值外挂(topups/*):每通道自带 schema+repository+service+routes+index,核心只暴露 credit()
```

---

<!-- codewise-meta:start -->
## 同步元信息

- **codewise_version**: `1`
- **baseline_commit**: `642753e192d0849a06296aae2a21944d462e1fd4`
- **synced_at**: `2026-06-17T00:15:00+08:00`
- **scope_root**: `.`
- **multi_codetree**: `apps/api/src/, apps/web/src/, packages/shared/src/, apps/api-public/src/, apps/web-public/src/`

> 此区域由 codewise 自动维护,**请勿手动编辑**。增量更新基于 `baseline_commit` 计算 git 差量、基于 `synced_at` 判定会话提取边界。`multi_codetree` 字段记录本次扫描覆盖的代码树范围,便于追溯。
<!-- codewise-meta:end -->
