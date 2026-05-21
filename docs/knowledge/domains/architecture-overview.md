# 架构整体观

inkast 是本地优先的 AI 生图工具:把散文 → 结构化 JSON prompt → 图,**全部链路在用户机器上闭环**。LLM 默认走本机已登录的 ClaudeCode(无 API key),生图走用户配置的 OpenAI 兼容 provider 池。

**核心交互哲学**:字段编辑器是核心,LLM 是加速器(见 [llm-as-accelerator-not-requirement](../decisions/llm-as-accelerator-not-requirement.md))。

## 整体架构

```
┌──────────────────────────────────────────────────────────────────────────┐
│ 浏览器(5173) — Vite + React 18 + Tailwind v4 + paper 主题 + shadcn/ui   │
│ 视口锁定 h-screen overflow-hidden,只允许列内滚动                          │
│                                                                          │
│   ┌─ LanguageProvider (zh/en, localStorage)                              │
│   │                                                                      │
│   ├─ App.tsx — Tab 切换 [起草|作品] + 三栏 grid 手风琴 + ⌘E 全局快捷键  │
│   │     [起草] Tab 内三栏:左 prose | 中 fields | 右 session workspace    │
│   │       手风琴: 1.4fr/0.42fr/0.6fr ⇄ 0.42fr/1.4fr/0.6fr (0.3s)         │
│   │       lockMode: null(默认) | "ai-filled"(AI 扩充后) | "m2"(跳过文本)│
│   │                                                                      │
│   ├─ features/prompt                                                     │
│   │    PromptComposer (左栏,有 locked / unlocked 两态)                  │
│   │      默认: textarea + [直接生图] [AI 扩充] + 底部"跳过文本"小链接    │
│   │      locked: 只读 prose 文本 + Lock bar + 解锁/回到起草链接           │
│   │    PromptFieldEditor (中栏,collapsed/expanded 两态)                  │
│   │      collapsed: 窄列 stub(5 个分组数字编号 + 提示展开)              │
│   │      expanded:  5 分组卡片(基本+氛围同行 2:3, 画面/色彩/文字 独占) │
│   │                                                                      │
│   ├─ features/workspace                                                  │
│   │    SessionWorkspace (右栏,本次会话作品,刷新清空)                  │
│   │      grid-cols-3 ; jobs 渲染为转圈 placeholder tile (而非独立卡片)   │
│   │                                                                      │
│   ├─ features/jobs                                                       │
│   │    useJobs hook (启动恢复 + 2s polling)                              │
│   │    ActiveJobs.tsx 已删除 — jobs 直接进 SessionWorkspace grid 占位    │
│   │                                                                      │
│   ├─ features/config — ProviderConfigDialog(shadcn Dialog)               │
│   └─ features/gallery — GalleryPage (独立 [作品] Tab,搜索+type filter)  │
│        + GalleryDetailDialog (复用历史 prompt 注入回起草)                │
│                                                                          │
│   公共原语:components/ui/* (11 个 shadcn primitives)                     │
│            components/{combobox, option-picker} (业务包装)               │
│            features/prompt/PreviewIcon (SVG + sprite 双路)               │
└──────────────────────────────────────────────────────────────────────────┘
                            │ /api/* (vite proxy)
                            ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ Hono API(8787) — apps/api/src                                            │
│                                                                          │
│   server/routes/                                                         │
│     · /api/draft-prompt        prompt-engine → ClaudeCode + lang 注入    │
│     · /api/generate-image      [同步,前端已不调用,保留兜底]            │
│     · /api/jobs/generate       异步 — createJob + fire-and-forget        │
│     · /api/jobs(/:id)         任务查询(前端 polling)                   │
│     · /api/providers           provider CRUD(加密入库)                  │
│     · /api/generations(/:id) 历史 + 图片字节                            │
│                                                                          │
│   domain/                                                                │
│     prompt-engine  getPromptEngineSystemPrompt(lang) → BASE + LANG       │
│     generate       generate() + runGenerationJob() 异步包装              │
│     reference      resolveReferenceImage(ref) → Buffer + mimeType        │
│                                                                          │
│   drivers/                                                               │
│     llm/claude-code            Agent SDK(内置 provider `__builtin_*`)    │
│     llm/openai-compatible      OpenAI 兼容 Chat Completions(配置驱动)   │
│     image/openai-compatible    池 walk + 错误分类 + mode dispatch         │
│       mode="images"            openai SDK images.generate / images.edit  │
│       mode="responses"         raw fetch /v1/responses + 手写 SSE parser │
│                                  + force tool_choice=image_generation    │
│                                  + size/ratio/quality 拼进 prompt 文本   │
│                                                                          │
│   storage/                                                               │
│     db.ts             better-sqlite3 + schema.sql 启动幂等               │
│     providers.ts      凭据 AES-256-GCM 加密                              │
│     generations.ts    生图历史                                           │
│     jobs.ts           异步任务表 + reaper(启动 reap pending/running)   │
└──────────────────────────────────────────────────────────────────────────┘
        │                                          │
        ▼                                          ▼
┌────────────────────────┐                ┌────────────────────────────┐
│ 本机 ClaudeCode        │                │ OpenAI 兼容 provider 池     │
│ (OAuth 凭据 / Keychain)│                │ (用户配置,加密入库)        │
│ 用于 prompt 工程       │                │ mode=images:                │
│ 输出 zh / en JSON      │                │   /v1/images/generations    │
│                        │                │   /v1/images/edits          │
│                        │                │ mode=responses (新):        │
│                        │                │   /v1/responses (SSE)       │
│                        │                │   + image_generation 工具   │
└────────────────────────┘                └────────────────────────────┘
        │                                          │
        ▼                                          ▼
~/.claude/projects/...    data/inkast.sqlite       data/images/YYYY/MM/<uuid>.png
session 历史               凭据/历史/jobs row       图片落盘
                                                  
                                                  apps/web/public/previews/<field>-<n>.png
                                                  14 张 sprite sheet(已生成,跟代码一起 commit)
```

## 核心数据流

**三模式渐进披露 (M1 / M2 / M3)**: 见 [three-modes-progressive-disclosure](../decisions/three-modes-progressive-disclosure.md)。
- **M1 直接生图**: 散文 → "直接生图" → 后端走 raw 路径绕 prompt-engine。**不触发手风琴**——保留"轻盈起草"轮回(改文本→再来一张)
- **M2 字段精修**: 初始态点"跳过文本"或按 ⌘E → 触发手风琴 + lockMode="m2",左栏标"已锁定·无散文",中栏字段空白等用户填。**M2 入口只在初始态出现**——一旦写了文本就消失,见 [m2-entry-textless-only](../decisions/m2-entry-textless-only.md)
- **M3 AI 扩充**: 散文 → "AI 扩充到字段" → `/api/draft-prompt` 拆解 → 触发手风琴 + lockMode="ai-filled",左栏锁定显示文本 + 重新预填/解锁链接,中栏字段已被 AI 填好,挂 "AI 推荐" Badge

**手风琴布局切换**: 左栏 grid 从 `1.4fr` 缩到 `0.42fr`,中栏从 `0.42fr` 扩到 `1.4fr`,右栏始终 `0.6fr`。CSS `transition: grid-template-columns 0.3s`。M1 不触发,M2/M3 都触发。见 [three-column-accordion-layout](../decisions/three-column-accordion-layout.md)。

**生图(异步)**: 用户点"生图"或"直接生图" → submitJob → POST `/api/jobs/generate` 立即返回 `jobId`。后端 `runGenerationJob` fire-and-forget:`markJobRunning` → provider 池故障切换。**按 `capability.extras.mode` 派发到两个 driver**:`images` 走 openai SDK `images.generate / images.edit`;`responses` 走 raw fetch `/v1/responses` + SSE 解析。图字节落盘 → `markJobSucceeded(generationId)` 或 `markJobFailed`。前端 `useJobs` 2s polling 看到任务从 active 移除 → `onSucceeded` 调用,把 `generationId` push 到 `sessionGenerationIds` state → SessionWorkspace 右栏立即出现新 tile / `onFailed` 弹错。

**批量生图**: composer 的 count 滑块(1-20)让一次按钮**前端 fan-out N 个独立 job** 并发提交。每张图独立走 provider 池 fallback,互不影响。详见 [batch-fan-out-frontend](../decisions/batch-fan-out-frontend.md)。

**本次工作区(右栏)**: jobs 直接渲染为 spinning placeholder tile 进 grid(不再有独立 ActiveJobs 卡片),完成后被实际图片 tile 替换。`sessionGenerationIds` 是 React state,**刷新清空**——历史看 [作品] Tab。见 [session-workspace](./session-workspace.md) 和 [jobs-as-placeholder-tiles](../decisions/jobs-as-placeholder-tiles.md)。

**参考图链**: ReferencePicker 选 Gallery 历史图(`{kind:"generation", generationId}`)或上传新图(`{kind:"upload", mimeType, dataBase64}`)。后端 `resolveReferenceImage` 转 Buffer,driver 走 `images.edit`,模型保留视觉风格 + 主体形态。

**[作品] Tab**: 全屏页面(`<GalleryPage>`),顶部 toolbar 含搜索框(模糊匹配 type/style/subject)+ Type filter chips(取数据里最高频 8 种 type)。点击卡片打开 `<GalleryDetailDialog>` → `PromptFieldEditor readOnly` 展示完整字段 + 复制 JSON + 下载 + 复用(注回起草 Tab 字段 + 切回 [起草])。

## 三个代码树

| 代码树 | 角色 |
| --- | --- |
| `apps/api/src` | Hono API、SQLite、driver 抽象、加密、异步 jobs |
| `apps/web/src` | Vite + React 前端,paper 主题 + shadcn UI + i18n + sprite |
| `packages/shared/src` | 前后端共享的 TS 类型契约(ImagePrompt / GenerateImageRequest / JobRecord / ReferenceImage / OutputLang 等) |

## 关键约束(贯穿全项目)

- **本地优先**: 凭据、历史、图都不出本机
- **paper 主题红线**: 见 [视觉规范 token](../shared/paper-theme-tokens.md)
- **shadcn-first 硬性规则**: UI 一律优先 shadcn,禁止手撸通用交互组件,见 [shadcn-first-rule](../decisions/shadcn-first-rule.md)
- **LLM is accelerator**: 不接 / 失败 / 网络断 不阻塞主流程,见 [llm-as-accelerator-not-requirement](../decisions/llm-as-accelerator-not-requirement.md)
- **同步生图路径保留但前端不调**: `POST /api/generate-image` 留兜底,异步 jobs 是主路径

## 关联条目

- [field-editor](./field-editor.md) — 字段编辑器(中栏,核心交互)
- [session-workspace](./session-workspace.md) — 右栏本次工作区
- [async-job-pipeline](./async-job-pipeline.md) — 异步任务流水线
- [reference-image](./reference-image.md) — 参考图生图
- [sprite-previews](./sprite-previews.md) — 真实预览图
- [i18n](./i18n.md) — 中英双语 + LLM 输出语言
- [prompt-engine](./prompt-engine.md) — 散文 → JSON
- [provider-pool](./provider-pool.md) — 故障切换语义
- [image-generation](./image-generation.md) — 生图端到端
- [gallery](./gallery.md) — [作品] Tab 历史
- [shared-contracts](../shared/shared-contracts.md) — 类型契约
- [three-column-accordion-layout](../decisions/three-column-accordion-layout.md) — 主页面布局决策
- [three-modes-progressive-disclosure](../decisions/three-modes-progressive-disclosure.md) — M1/M2/M3 渐进披露
- [m2-entry-textless-only](../decisions/m2-entry-textless-only.md) — M2 入口只在初始态
- [jobs-as-placeholder-tiles](../decisions/jobs-as-placeholder-tiles.md) — Jobs 占位 tile
- [llm-as-accelerator-not-requirement](../decisions/llm-as-accelerator-not-requirement.md)
- [shadcn-first-rule](../decisions/shadcn-first-rule.md)
- [async-jobs-over-sync-http](../decisions/async-jobs-over-sync-http.md)

---

## 第二条通道:Plugin Channel(对外接入)

主 Web UI 之外,inkast 还提供一条**完全独立**的对外通道,给 snap-ub 这种外部业务系统调用。**路由 / 表 / 流程全部隔离**,只共享 LLM driver + image provider 池入口。

```
公网 → nginx /inkast/ 反代 → 127.0.0.1:8787
                                      │
                                      ├─ /plugins/v1/images/{submit,status}  ← v2 异步 callback 协议
                                      └─ /admin/plugin-stats                  ← loopback only HTML dashboard

Plugin 通道流程(submit → worker → callback):
  POST submit(立返 task_id,≤100ms)
    → plugin_tasks 表 + in-memory queue + concurrency cap=2
    → worker: skip-LLM 或 LLM 拆解 → image driver 池 → JPEG transcode + 可选 resize
    → markTaskSucceeded → POST callback_url(retry 5s/30s/5min × 3)
    → 4 次失败 → callback_lost(调用方走 GET status/:id 兜底)

Plugin 配置: JSON overlay(INKAST_PLUGIN_DIR/*.json + zod 校验) — 主仓 0 客户特化代码
```

- [plugin-channel](plugin-channel.md) — 完整架构 + 数据流
- [admin-dashboard](admin-dashboard.md) — `/admin/plugin-stats` HTML dashboard
- [json-overlay-vs-branch](../decisions/json-overlay-vs-branch.md) — 客户特化为何走 JSON overlay 而非 git fork
