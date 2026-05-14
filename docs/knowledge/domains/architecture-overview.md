# 架构整体观

inkast 是本地优先的 AI 生图工具:把散文 → 结构化 JSON prompt → 图,**全部链路在用户机器上闭环**。LLM 默认走本机已登录的 ClaudeCode(无 API key),生图走用户配置的 OpenAI 兼容 provider 池。

**核心交互哲学**:字段编辑器是核心,LLM 是加速器(见 [llm-as-accelerator-not-requirement](../decisions/llm-as-accelerator-not-requirement.md))。

## 整体架构

```
┌──────────────────────────────────────────────────────────────────────────┐
│ 浏览器(5173) — Vite + React 18 + Tailwind v4 + paper 主题 + shadcn/ui   │
│                                                                          │
│   ┌─ LanguageProvider (zh/en, localStorage)                              │
│   │                                                                      │
│   ├─ features/prompt                                                     │
│   │    PromptComposer (散文输入 + AI 预填 + 直接生图 + ReferencePicker)  │
│   │    PromptFieldEditor (5 分组卡片:basic/scene/mood/colors/text)      │
│   │    FieldPicker → OptionPicker (Dialog 弹窗 + 真实预览图)             │
│   │    FieldCombobox → Combobox (Popover + Command,text_elements 用)    │
│   │    ColorPaletteEditor / TextElementsEditor                           │
│   │                                                                      │
│   ├─ features/jobs                                                       │
│   │    useJobs hook (启动恢复 + 2s polling)                              │
│   │    ActiveJobs cards (进行中任务可见)                                 │
│   │                                                                      │
│   ├─ features/config — ProviderConfigDialog(shadcn Dialog)               │
│   └─ features/gallery — Gallery 网格 + GalleryDetailDialog               │
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
│     llm/claude-code            Agent SDK(默认 LLM 通道)                 │
│     image/openai-compatible    openai SDK + 池故障切换                   │
│                                  · 无 ref → images.generate              │
│                                  · 有 ref → images.edit + toFile(buffer) │
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
│ 用于 prompt 工程       │                │ /v1/images/generations      │
│ 输出 zh / en JSON      │                │ /v1/images/edits (可选支持) │
└────────────────────────┘                └────────────────────────────┘
        │                                          │
        ▼                                          ▼
~/.claude/projects/...    data/inkast.sqlite       data/images/YYYY/MM/<uuid>.png
session 历史               凭据/历史/jobs row       图片落盘
                                                  
                                                  apps/web/public/previews/<field>-<n>.png
                                                  14 张 sprite sheet(已生成,跟代码一起 commit)
```

## 核心数据流

**起草 prompt**: 浏览器输入散文 → POST `/api/draft-prompt` `{input, lang}` → ClaudeCode driver(structured output JSON schema)→ 返回 `{ prompt, hints }`。

**字段编辑**: prompt 进入 `<PromptFieldEditor>`,5 分组卡片渲染,AI 推荐字段挂 Badge。用户改任一字段移除该字段的 Badge。也可不点 AI 预填,**从零直接填字段 → 生图**。

**生图(异步)**: 用户点"生图" / "直接生图" → submitJob → POST `/api/jobs/generate` 立即返回 `jobId`。后端 `runGenerationJob` fire-and-forget:`markJobRunning` → provider 池故障切换调 `images.generate` 或 `images.edit`(有 reference 时)→ 图字节落盘 → `markJobSucceeded(generationId)` 或 `markJobFailed(code, message)`。前端 `useJobs` 2s polling 看到状态变化 → `onSucceeded` 触发 Gallery 刷新 + 成功 Banner / `onFailed` 弹错。

**参考图链**: ReferencePicker 选 Gallery 历史图(`{kind:"generation", generationId}`)或上传新图(`{kind:"upload", mimeType, dataBase64}`)。后端 `resolveReferenceImage` 转 Buffer,driver 走 `images.edit`,模型保留视觉风格 + 主体形态。

**Gallery**: 主页加载时 GET `/api/generations` → 网格渲染 → 图片 URL 直指 GET `/api/generations/:id/image`(Hono 直接返字节)→ 点击打开详情弹窗(`PromptFieldEditor readOnly` 展示完整字段 + 复制 JSON + 下载 + 复用)。

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

- [field-editor](./field-editor.md) — 字段编辑器(核心交互)
- [async-job-pipeline](./async-job-pipeline.md) — 异步任务流水线
- [reference-image](./reference-image.md) — 参考图生图
- [sprite-previews](./sprite-previews.md) — 真实预览图
- [i18n](./i18n.md) — 中英双语 + LLM 输出语言
- [prompt-engine](./prompt-engine.md) — 散文 → JSON
- [provider-pool](./provider-pool.md) — 故障切换语义
- [image-generation](./image-generation.md) — 生图端到端
- [gallery](./gallery.md) — 历史展示
- [shared-contracts](../shared/shared-contracts.md) — 类型契约
- [llm-as-accelerator-not-requirement](../decisions/llm-as-accelerator-not-requirement.md)
- [shadcn-first-rule](../decisions/shadcn-first-rule.md)
- [async-jobs-over-sync-http](../decisions/async-jobs-over-sync-http.md)
