# Inkast 知识库

快速理解项目的入口。按需跳转,不需要全部阅读。

**技术栈**: pnpm monorepo · Hono + better-sqlite3(后端) · Vite + React 18 + Tailwind v4(前端) · @anthropic-ai/claude-agent-sdk(LLM 默认通道) · openai SDK(图像生成)

<!-- codewise-docs:start -->
## 项目文档导航

本项目作者维护的人写文档,**这些是权威源**——比 knowledge/ 自动生成的更准。

### 入门 / 项目说明

- [CLAUDE.md](../../CLAUDE.md) — 项目宪法。覆盖五件事:(1)项目血统(来自 gpt-image-canvas + imagegen,各取舍什么);(2)五条关键设计决策(LLM 双通道、provider 池语义、不用 tldraw、imagegen 方法论、本地优先);(3)技术栈速查;(4)**Paper 主题视觉规范红线**(字体/颜色/形状自检清单);(5)Phase 1 MVP 范围 + 不要做的事清单。**AI 接手项目第一份必读**,所有设计取舍的事实源。
<!-- codewise-docs:end -->

<!-- codewise-interfaces:start -->
## 接口契约速查

inkast 所有对外调用入口的快速地图。**完整签名以代码为准**——本表只列"名 + 职责 + 入口位置"。

### REST endpoints(9 个)

| 方法 | 路径 | 职责 | 入口 |
| --- | --- | --- | --- |
| GET | `/api/health` | 健康检查(`{status, service, version}`) | `apps/api/src/server/app.ts:10` |
| POST | `/api/draft-prompt` | 散文 → 结构化 JSON prompt(走 ClaudeCode driver) | `apps/api/src/server/routes/prompt.ts:9` |
| POST | `/api/generate-image` | 生图(走 provider 池),返回 `{generation, driver.attempts}` | `apps/api/src/server/routes/generate.ts:16` |
| GET | `/api/generations` | 历史列表(默认 100,可 `?limit=`) | `apps/api/src/server/routes/generate.ts:69` |
| GET | `/api/generations/:id/image` | 返图片字节(`image/png` + 长缓存) | `apps/api/src/server/routes/generate.ts:74` |
| GET | `/api/providers` | provider 列表(keyMasked) | `apps/api/src/server/routes/providers.ts:23` |
| POST | `/api/providers` | 创建 provider(加密入库) | `apps/api/src/server/routes/providers.ts:27` |
| PATCH | `/api/providers/:id` | 编辑 provider(apiKey 留空不变) | `apps/api/src/server/routes/providers.ts:49` |
| DELETE | `/api/providers/:id` | 删除 provider(`generations.provider_id` SET NULL) | `apps/api/src/server/routes/providers.ts:64` |

**详情**: [domains/provider-pool](domains/provider-pool.md) · [domains/image-generation](domains/image-generation.md) · [domains/prompt-engine](domains/prompt-engine.md)

### 契约文件(前后端共享类型)

| 文件 | 类型 | 关键导出 |
| --- | --- | --- |
| `packages/shared/src/prompt.ts` | TS types | `ImagePrompt` / `TextElement` / `AmbiguityHint` / `PromptDraft` |
| `packages/shared/src/api.ts` | TS types | `DraftPromptRequest/Response` / `GenerateImageRequest/Response` / `ProviderSummary` / `GenerationRecord` 等 |

**详情**: [shared/shared-contracts](shared/shared-contracts.md)

### 数据库 Schema

- `apps/api/src/storage/schema.sql` — 两表(`providers` + `generations`),通过 better-sqlite3 启动时幂等 `CREATE TABLE IF NOT EXISTS`

**详情**: [integrations/better-sqlite3](integrations/better-sqlite3.md)
<!-- codewise-interfaces:end -->

---

## 按功能域

| 条目 | 一句话 |
| --- | --- |
| [architecture-overview](domains/architecture-overview.md) | 整体架构 + 数据流全景(**新人第一站**) |
| [prompt-engine](domains/prompt-engine.md) | 散文 → JSON prompt 引擎(imagegen 方法论的实现) |
| [provider-pool](domains/provider-pool.md) | OpenAI 兼容 provider 池 + 故障切换语义 |
| [image-generation](domains/image-generation.md) | 生图端到端(driver → 落盘 → 入库) |
| [gallery](domains/gallery.md) | 历史网格 + 详情弹窗 + 下载/复用 |
| [prompt-composer-loop](domains/prompt-composer-loop.md) | 输入区 + hint 采纳循环(段 1 简化版) |

## 按技术层

| 条目 | 一句话 |
| --- | --- |
| [shared-contracts](shared/shared-contracts.md) | `@inkast/shared` 前后端共享类型契约 |
| [paper-theme-tokens](shared/paper-theme-tokens.md) | paper.css token + globals 全站效果(**视觉真理源**) |
| [cn-util](shared/cn-util.md) | clsx + tailwind-merge 的 cn() helper |
| [json-tree-view](shared/json-tree-view.md) | 字段化 JSON 树渲染(prompt + 历史详情共用) |
| [crypto-utils](shared/crypto-utils.md) | AES-256-GCM 凭据加密 + master.key |

## 设计决策

| 条目 | 一句话 |
| --- | --- |
| [claude-code-sdk-over-cli](decisions/claude-code-sdk-over-cli.md) | LLM 通道用 Agent SDK 而非 spawn `claude` CLI |
| [structured-output-json-schema](decisions/structured-output-json-schema.md) | 用 SDK schema 强制 JSON,放弃 prompt 约束(80% → 100%) |
| [openai-sdk-over-fetch](decisions/openai-sdk-over-fetch.md) | 用 openai SDK 不手搓 fetch(CDN 403 教训) |
| [sqlite-over-keychain](decisions/sqlite-over-keychain.md) | 跨平台 SQLite 凭据 vs macOS Keychain |
| [prompt-as-json-not-prose](decisions/prompt-as-json-not-prose.md) | `JSON.stringify(prompt)` 直接喂给生图模型 |
| [paper-theme-locked](decisions/paper-theme-locked.md) | 视觉规范红线锁定 + glass 主题留位 |
| [defer-conversational-redesign](decisions/defer-conversational-redesign.md) | 段 1 重对话化推迟到 Phase 1.5(理由 + 代价) |

## 外部集成

| 条目 | 一句话 |
| --- | --- |
| [claude-agent-sdk](integrations/claude-agent-sdk.md) | Agent SDK + OAuth + structured output + 禁用工具 |
| [openai-sdk-images](integrations/openai-sdk-images.md) | OpenAI SDK images.generate + 兼容代理 |
| [better-sqlite3](integrations/better-sqlite3.md) | better-sqlite3 用法 + WAL + native binding |
| [hono](integrations/hono.md) | Hono 路由 + cors + HTTPException |
| [tailwind-v4](integrations/tailwind-v4.md) | Tailwind v4 CSS-first + `@theme inline` 映射 |
| [vite-dev-proxy](integrations/vite-dev-proxy.md) | Vite dev proxy 超时(生图慢链路关键) |
| [lucide-react](integrations/lucide-react.md) | 图标库,strokeWidth 1.5/1.75 视觉约定 |

## 工作流

| 条目 | 一句话 |
| --- | --- |
| [add-new-provider](workflows/add-new-provider.md) | 添加新 OpenAI 兼容 provider 步骤 |
| [add-llm-driver](workflows/add-llm-driver.md) | 实现新 LLM driver(为 Phase 1.5 OpenAI Chat 铺路) |
| [update-paper-theme](workflows/update-paper-theme.md) | 改 paper token 的步骤 + 7 条自检 |

## 踩坑记录

| 条目 | 一句话 |
| --- | --- |
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
散文输入(浏览器 5173)
  │
  │ POST /api/draft-prompt { input }
  ▼
Hono(8787) → routes/prompt → domain/prompt-engine
  │
  │ drivers/llm/claude-code · query({ systemPrompt, outputFormat: json_schema, tools: [] })
  ▼
本机 ClaudeCode(子进程 cli.js + Keychain OAuth)
  │
  │ structured_output: { prompt: ImagePrompt, hints: AmbiguityHint[] }
  ▼
浏览器渲染 → 用户点击 hint 采纳 → 输入框追加"补充·field: ..."
  │
  │ 重新起草 (循环)
  ▼
浏览器:用户满意 → 点"生图"
  │
  │ POST /api/generate-image { prompt }
  ▼
domain/generate → drivers/image/openai-compatible
  │ pool walk:listProviderKeys() ORDER BY priority ASC
  │   try provider[0] → fail(non-moderation) → continue
  │   try provider[1] → openai SDK images.generate({...,output_format:"png"})
  │   ← b64_json
  │
  ▼
data/images/YYYY/MM/<uuid>.png 落盘 + INSERT generations row
  │
  ▼
Gallery refreshKey++ → GET /api/generations → 网格刷新
  │
  │ 点卡片 → 详情弹窗(完整 prompt JSON + 复制 + 下载 + 复用)
  ▼
复用 → 把历史 promptSnapshot 注回编辑器 → 调整 → 再生图
```

---

<!-- codewise-meta:start -->
## 同步元信息

- **codewise_version**: `1`
- **baseline_commit**: `6c07ff0e2d1f3830b658393840f5a7ec1f1eb0ea`
- **synced_at**: `2026-05-14T00:38:30+08:00`
- **scope_root**: `.`
- **multi_codetree**: `apps/api/src/, apps/web/src/, packages/shared/src/`

> 此区域由 codewise 自动维护,**请勿手动编辑**。增量更新基于 `baseline_commit` 计算 git 差量、基于 `synced_at` 判定会话提取边界。`multi_codetree` 字段记录本次扫描覆盖的代码树范围,便于追溯。
<!-- codewise-meta:end -->
