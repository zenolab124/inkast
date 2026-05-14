# Inkast 知识库

快速理解项目的入口。按需跳转,不需要全部阅读。

**技术栈**: pnpm monorepo · Hono + better-sqlite3(后端) · Vite + React 18 + Tailwind v4 + shadcn/ui(前端) · @anthropic-ai/claude-agent-sdk(LLM 默认通道) · openai SDK(图像生成 + 参考图)

<!-- codewise-docs:start -->
## 项目文档导航

本项目作者维护的人写文档,**这些是权威源**——比 knowledge/ 自动生成的更准。

### 入门 / 项目说明

- [CLAUDE.md](../../CLAUDE.md) — 项目宪法。覆盖五件事:(1) 项目血统(来自 gpt-image-canvas + imagegen);(2) 五条关键设计决策(LLM 双通道、provider 池语义、不用 tldraw、imagegen 方法论、本地优先);(3) 技术栈速查;(4) **Paper 主题视觉规范红线**(字体/颜色/形状/UI 组件库 4 套自检清单);(5) Phase 1 MVP 范围 + 不要做的事清单。**新增 "UI 组件库" 硬性规则段:UI 一律优先 shadcn,禁止手撸通用交互组件**,见 [shadcn-first-rule](decisions/shadcn-first-rule.md)。
<!-- codewise-docs:end -->

<!-- codewise-interfaces:start -->
## 接口契约速查

inkast 所有对外调用入口的快速地图。**完整签名以代码为准**——本表只列"名 + 职责 + 入口位置"。

### REST endpoints(12 个)

| 方法 | 路径 | 职责 | 入口 |
| --- | --- | --- | --- |
| GET | `/api/health` | 健康检查(`{status, service, version}`) | `apps/api/src/server/app.ts` |
| POST | `/api/draft-prompt` | 散文 → 结构化 JSON prompt(走 ClaudeCode driver + lang 注入) | `apps/api/src/server/routes/prompt.ts` |
| POST | `/api/generate-image` | **同步**生图(走 provider 池);前端已不调用,留作兜底 | `apps/api/src/server/routes/generate.ts` |
| GET | `/api/generations` | 历史列表(默认 100,可 `?limit=`) | `apps/api/src/server/routes/generate.ts` |
| GET | `/api/generations/:id/image` | 返图片字节(`image/png` + 长缓存) | `apps/api/src/server/routes/generate.ts` |
| GET | `/api/providers` | provider 列表(keyMasked) | `apps/api/src/server/routes/providers.ts` |
| POST | `/api/providers` | 创建 provider(加密入库) | `apps/api/src/server/routes/providers.ts` |
| PATCH | `/api/providers/:id` | 编辑 provider(apiKey 留空不变) | `apps/api/src/server/routes/providers.ts` |
| DELETE | `/api/providers/:id` | 删除 provider(`generations.provider_id` SET NULL) | `apps/api/src/server/routes/providers.ts` |
| **POST** | **`/api/jobs/generate`** | **异步**生图——立返 `jobId`,fire-and-forget 跑 runGenerationJob | `apps/api/src/server/routes/jobs.ts` |
| **GET** | **`/api/jobs`** | 任务列表(支持 `?status=&since=&limit=`) | `apps/api/src/server/routes/jobs.ts` |
| **GET** | **`/api/jobs/:id`** | 任务详情 | `apps/api/src/server/routes/jobs.ts` |

**详情**: [async-job-pipeline](domains/async-job-pipeline.md) · [provider-pool](domains/provider-pool.md) · [image-generation](domains/image-generation.md) · [prompt-engine](domains/prompt-engine.md) · [reference-image](domains/reference-image.md)

### 契约文件(前后端共享类型)

| 文件 | 类型 | 关键导出 |
| --- | --- | --- |
| `packages/shared/src/prompt.ts` | TS types | `ImagePrompt` / `TextElement` / `AmbiguityHint` / `PromptDraft` |
| `packages/shared/src/api.ts` | TS types | `OutputLang` / `DraftPromptRequest/Response` / `GenerateImageRequest/Response` / `ProviderSummary` / `GenerationRecord` / `ReferenceImage` / `JobStatus` / `JobRecord` / `SubmitJobRequest/Response` / `ListJobsResponse` |

**详情**: [shared-contracts](shared/shared-contracts.md)

### 数据库 Schema(3 表)

`apps/api/src/storage/schema.sql` —— 启动时幂等 `CREATE TABLE IF NOT EXISTS`:

| 表 | 用途 |
| --- | --- |
| `providers` | OpenAI 兼容 provider 凭据(AES-256-GCM 加密 BLOB) |
| `generations` | 生图历史(`promptSnapshot / imagePath / providerId` FK 等) |
| **`jobs`** | **异步任务**(status / promptSnapshot / generation_id FK / attempts / error / 时间戳) |

**详情**: [better-sqlite3](integrations/better-sqlite3.md) · [async-job-pipeline](domains/async-job-pipeline.md)
<!-- codewise-interfaces:end -->

---

## 按功能域

| 条目 | 一句话 |
| --- | --- |
| [architecture-overview](domains/architecture-overview.md) | 整体架构 + 数据流全景(**新人第一站**) |
| [field-editor](domains/field-editor.md) | 字段编辑器(核心交互,取代 hint 采纳循环) |
| [async-job-pipeline](domains/async-job-pipeline.md) | 异步生图任务流水线 + polling + 重启 reaper |
| [reference-image](domains/reference-image.md) | 参考图生图(`images.edit` 路径) |
| [sprite-previews](domains/sprite-previews.md) | 字段选项真实预览图(14 张 sprite sheet) |
| [i18n](domains/i18n.md) | 中英双语 + LLM 输出语言切换 |
| [prompt-engine](domains/prompt-engine.md) | 散文 → JSON prompt 引擎(imagegen 方法论的实现) |
| [provider-pool](domains/provider-pool.md) | OpenAI 兼容 provider 池 + 故障切换语义 |
| [image-generation](domains/image-generation.md) | 生图端到端(driver → 落盘 → 入库) |
| [gallery](domains/gallery.md) | 历史网格 + 详情弹窗(用 PromptFieldEditor readOnly) |

## 按技术层

| 条目 | 一句话 |
| --- | --- |
| [shared-contracts](shared/shared-contracts.md) | `@inkast/shared` 前后端共享类型契约 |
| [shadcn-primitives](shared/shadcn-primitives.md) | 已 own 的 11 个 shadcn 原语 + 业务包装 |
| [field-dictionary](shared/field-dictionary.md) | 6 字段选项词典 + 双语 + sprite 元数据 |
| [i18n-dictionary](shared/i18n-dictionary.md) | `Translations` 类型 + zh/en 字典 + useLanguage hook |
| [paper-theme-tokens](shared/paper-theme-tokens.md) | paper.css token + globals 全站效果(**视觉真理源**) |
| [cn-util](shared/cn-util.md) | clsx + tailwind-merge 的 cn() helper |
| [crypto-utils](shared/crypto-utils.md) | AES-256-GCM 凭据加密 + master.key |

## 设计决策

| 条目 | 一句话 |
| --- | --- |
| [llm-as-accelerator-not-requirement](decisions/llm-as-accelerator-not-requirement.md) | 字段编辑器是核心,LLM 只是加速器 |
| [shadcn-first-rule](decisions/shadcn-first-rule.md) | UI 一律优先 shadcn,禁止手撸通用交互组件 |
| [async-jobs-over-sync-http](decisions/async-jobs-over-sync-http.md) | 异步 jobs 取代同步 HTTP(浏览器 idle timeout) |
| [reaper-abandoned-jobs](decisions/reaper-abandoned-jobs.md) | API 启动时 reap 残留 pending/running jobs |
| [generate-now-raw-prompt-path](decisions/generate-now-raw-prompt-path.md) | "直接生图"绕过 prompt engine |
| [reference-image-via-edit](decisions/reference-image-via-edit.md) | Reference image 走 `images.edit` 端点 |
| [sprite-sheets-over-per-option-images](decisions/sprite-sheets-over-per-option-images.md) | Sprite 大图分格 vs 每选项独立图 |
| [edge-to-edge-no-border-prompts](decisions/edge-to-edge-no-border-prompts.md) | Sprite 提示词:严格边对边,无外框无 gridline |
| [inset-zoom-on-sprite-slice](decisions/inset-zoom-on-sprite-slice.md) | Sprite 切片 4% inset 缩放 |
| [square-sprite-cells](decisions/square-sprite-cells.md) | Sprite cells 一律 1:1 正方形(包括 Type) |
| [claude-code-sdk-over-cli](decisions/claude-code-sdk-over-cli.md) | LLM 通道用 Agent SDK 而非 spawn `claude` CLI |
| [structured-output-json-schema](decisions/structured-output-json-schema.md) | 用 SDK schema 强制 JSON,放弃 prompt 约束(80% → 100%) |
| [openai-sdk-over-fetch](decisions/openai-sdk-over-fetch.md) | 用 openai SDK 不手搓 fetch(CDN 403 教训) |
| [sqlite-over-keychain](decisions/sqlite-over-keychain.md) | 跨平台 SQLite 凭据 vs macOS Keychain |
| [prompt-as-json-not-prose](decisions/prompt-as-json-not-prose.md) | `JSON.stringify(prompt)` 直接喂给生图模型 |
| [paper-theme-locked](decisions/paper-theme-locked.md) | 视觉规范红线锁定 + glass 主题留位 |
| [defer-conversational-redesign](decisions/defer-conversational-redesign.md) | 段 1 重对话化推迟(已被字段编辑器路径覆盖 70%) |

## 外部集成

| 条目 | 一句话 |
| --- | --- |
| [claude-agent-sdk](integrations/claude-agent-sdk.md) | Agent SDK + OAuth + structured output + 禁用工具 |
| [openai-sdk-images](integrations/openai-sdk-images.md) | OpenAI SDK images.generate + images.edit(reference image) + 兼容代理 |
| [shadcn-ui-radix-cmdk](integrations/shadcn-ui-radix-cmdk.md) | shadcn/ui own 模式 + radix-ui + cmdk |
| [better-sqlite3](integrations/better-sqlite3.md) | better-sqlite3 用法 + WAL + native binding + 3 张表 |
| [hono](integrations/hono.md) | Hono 路由 + cors + HTTPException |
| [tailwind-v4](integrations/tailwind-v4.md) | Tailwind v4 CSS-first + `@theme inline` 映射 |
| [vite-dev-proxy](integrations/vite-dev-proxy.md) | Vite dev proxy 超时(生图慢链路关键,异步后不再关键) |
| [lucide-react](integrations/lucide-react.md) | 图标库,strokeWidth 1.5/1.75 视觉约定 |

## 工作流

| 条目 | 一句话 |
| --- | --- |
| [add-sprite-preview-sheet](workflows/add-sprite-preview-sheet.md) | 新增字段 / 刷新 sprite preview sheet 流程 |
| [add-new-provider](workflows/add-new-provider.md) | 添加新 OpenAI 兼容 provider 步骤 |
| [add-llm-driver](workflows/add-llm-driver.md) | 实现新 LLM driver(为 Phase 1.5 OpenAI Chat 铺路) |
| [update-paper-theme](workflows/update-paper-theme.md) | 改 paper token 的步骤 + 7 条自检 |

## 踩坑记录

| 条目 | 一句话 |
| --- | --- |
| [hmr-restart-aborts-jobs](pitfalls/hmr-restart-aborts-jobs.md) | tsx watch 重启会丢 in-flight jobs,reaper 兜底 |
| [browser-idle-timeout-long-http](pitfalls/browser-idle-timeout-long-http.md) | 浏览器 4-5min idle 断 fetch,后端实际成功 |
| [asymmetric-cell-descriptions](pitfalls/asymmetric-cell-descriptions.md) | Sprite cells 描述长度不均 → 行高/列宽不等 |
| [numbers-leak-into-sprite-cells](pitfalls/numbers-leak-into-sprite-cells.md) | 提示词用 "1./2./..." 数字编号会画进 cells |
| [cream-paper-creates-outer-border](pitfalls/cream-paper-creates-outer-border.md) | "cream paper + gridlines" 提示词制造外层 paper 边框 |
| [sprite-cell-edge-artifacts](pitfalls/sprite-cell-edge-artifacts.md) | Sprite cell 边缘像素瑕疵,4% inset 兜底 |
| [object-shaped-subject-stringify](pitfalls/object-shaped-subject-stringify.md) | LLM 返回 object 形态 subject 渲染成 `[object Object]` |
| [reference-edit-endpoint-not-universal](pitfalls/reference-edit-endpoint-not-universal.md) | OpenAI 兼容 `/v1/images/edits` 不一定都实现 |
| [cdn-edge-403-without-ua](pitfalls/cdn-edge-403-without-ua.md) | raw fetch 无 UA 被 CDN 边缘拦截 |
| [base-url-typo-silent-403](pitfalls/base-url-typo-silent-403.md) | provider base URL 错一个字 → 静默 403 |
| [image-driver-timeout-chain](pitfalls/image-driver-timeout-chain.md) | driver / vite proxy / SDK 三层超时要协调 |
| [llm-json-quote-escaping](pitfalls/llm-json-quote-escaping.md) | 模型字符串内未转义引号(用 schema 强制解决) |
| [chinese-fallback-songti](pitfalls/chinese-fallback-songti.md) | 衬线字体让中文落到宋体(已锁规范) |
| [dark-class-position-bug](pitfalls/dark-class-position-bug.md) | dark class 加错位置导致 body 不翻(已知未修) |
| [sdk-output-format-missing](pitfalls/sdk-output-format-missing.md) | SDK 不传 output_format 走 URL 慢路径 |
| [pool-moderation-no-fallover](pitfalls/pool-moderation-no-fallover.md) | 内容审查拒绝故意不切,防绕审 |
| [schema-sql-path-resolution](pitfalls/schema-sql-path-resolution.md) | schema.sql 用 import.meta.url 解析(build 要复制) |
| [tsx-watch-syntax-kill](pitfalls/tsx-watch-syntax-kill.md) | tsx watch 遇语法错会 kill 进程 |
| [dev-server-port-collision](pitfalls/dev-server-port-collision.md) | 老进程没死透导致 8787 双 listen |

---

## 数据流全景

```
散文输入(浏览器 5173,LanguageProvider zh/en)
  │
  │ POST /api/draft-prompt { input, lang }
  ▼
Hono(8787) → routes/prompt → domain/prompt-engine
  │
  │ getPromptEngineSystemPrompt(lang) → ClaudeCode driver(JSON schema)
  ▼
本机 ClaudeCode(子进程 cli.js + Keychain OAuth)
  │
  │ structured_output: { prompt: ImagePrompt, hints: AmbiguityHint[] }
  ▼
浏览器:PromptFieldEditor 5 分组卡片 + AI 推荐 Badge
  │
  │ 用户改任一字段 → Badge 消失;可以从零编辑;不接 LLM 也能用
  │
  │ ───── 三条入口生图 ─────
  │ (A) 编辑器底部"生图"          → submitJob({ prompt })
  │ (B) 散文区"直接生图"          → submitJob({ prompt:placeholder, rawPrompt:prose })
  │ (C) 任一入口 + 选 ReferenceImage → submitJob({ ..., referenceImage })
  │
  ▼ POST /api/jobs/generate
  │
  │ routes/jobs createJob → markJobRunning → runGenerationJob (fire-and-forget)
  │ ← 立即返回 { jobId, status: "pending" }
  │
  ▼ domain/generate
  │   有 ref → resolveReferenceImage(ref) → Buffer → driver.image.edit
  │   无 ref → driver.image.generate
  │
  ▼ provider 池 walk:listProviderKeys() ORDER BY priority ASC
  │   try provider[0] → fail(non-moderation) → continue
  │   try provider[1] → openai SDK → b64_json
  ▼
data/images/YYYY/MM/<uuid>.png 落盘 + INSERT generations row
+ markJobSucceeded(generationId)
  │
  ▼ 前端 useJobs 2s polling
  │ list active → diff → 完成的调 getJob → onSucceeded → galleryKey++
  │ Banner: "生图完成 · provider · 47.3s"
  │
  ▼ Gallery refreshKey++ → GET /api/generations → 网格刷新
  │ 点卡片 → 详情弹窗(shadcn Dialog + PromptFieldEditor readOnly + 复制 JSON + 下载 + 复用)
  ▼
复用 → 把历史 promptSnapshot 注回主编辑器 → 调整 → 再生图

刷新页面?  useJobs 启动 listJobs({status:["pending","running"]}) → ActiveJobs 卡片重显
重启 API?  reaperAbandonedJobs() 把 pending/running 标 failed → 前端看到 onFailed 提示
```

---

<!-- codewise-meta:start -->
## 同步元信息

- **codewise_version**: `1`
- **baseline_commit**: `73db628bb3f0d016f8c1756bdf53b9cf67b383d1`
- **synced_at**: `2026-05-14T23:46:56+08:00`
- **scope_root**: `.`
- **multi_codetree**: `apps/api/src/, apps/web/src/, packages/shared/src/`

> 此区域由 codewise 自动维护,**请勿手动编辑**。增量更新基于 `baseline_commit` 计算 git 差量、基于 `synced_at` 判定会话提取边界。`multi_codetree` 字段记录本次扫描覆盖的代码树范围,便于追溯。
<!-- codewise-meta:end -->
