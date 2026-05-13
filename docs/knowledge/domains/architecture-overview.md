# 架构整体观

inkast 是本地优先的 AI 生图工具:把散文 → 结构化 JSON prompt → 图,**全部链路在用户机器上闭环**。LLM 默认走本机已登录的 ClaudeCode(无 API key),生图走用户配置的 OpenAI 兼容 provider 池。

## 整体架构

```
┌──────────────────────────────────────────────────────────────────┐
│ 浏览器(5173) — Vite + React 18 + Tailwind v4 + paper 主题       │
│   ┌─ features/prompt   散文输入 + 字段化 JSON 编辑 + hint 采纳   │
│   ├─ features/config   provider 配置弹窗(CRUD)                  │
│   └─ features/gallery  网格历史 + 详情弹窗                       │
└──────────────────────────────────────────────────────────────────┘
                            │ /api/* (vite proxy)
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│ Hono API(8787) — apps/api/src                                    │
│   server/routes/                                                 │
│     · /api/draft-prompt   prompt-engine → ClaudeCode             │
│     · /api/generate-image image driver → provider 池             │
│     · /api/providers      provider CRUD(加密入库)               │
│     · /api/generations    历史 + 图片字节                        │
│   drivers/llm/claude-code  Agent SDK(默认 LLM 通道)              │
│   drivers/image/openai-compatible  openai SDK + 池故障切换       │
│   storage/  better-sqlite3 + AES-256-GCM 凭据加密                │
└──────────────────────────────────────────────────────────────────┘
        │                                          │
        ▼                                          ▼
┌────────────────────────┐                ┌────────────────────────┐
│ 本机 ClaudeCode        │                │ OpenAI 兼容 provider   │
│ (OAuth 凭据 / Keychain)│                │ (用户配置,加密入库)    │
│ 用于 prompt 工程       │                │ /v1/images/generations │
└────────────────────────┘                └────────────────────────┘
        │
        ▼
~/.claude/projects/...    data/inkast.sqlite   data/images/YYYY/MM/<uuid>.png
session 历史               凭据 + 历史 row         真实图片落盘
```

## 核心数据流

**起草 prompt**: 浏览器输入散文 → POST `/api/draft-prompt` → ClaudeCode driver(`outputFormat: json_schema` 强制结构化)→ 返回 `{ prompt, hints }`。

**精修循环**: 用户点 hint → `补充·field: suggestion` 追加到输入框 → 重新起草 → hints 越来越少。

**生图**: 用户点"生图" → POST `/api/generate-image` → 走 provider 池(`priority ASC`)→ 第一家失败自动切下家 → 图字节 base64 解码 → 落盘到 `data/images/YYYY/MM/<uuid>.png` → 入库 generations 表。

**Gallery**: 主页加载时 GET `/api/generations` → 网格渲染 → 图片 URL 直指 GET `/api/generations/:id/image`(Hono 直接返字节)→ 点击打开详情弹窗(完整 JSON + 复制 + 下载 + 复用)。

## 三个代码树

| 代码树 | 角色 |
| --- | --- |
| `apps/api/src` | Hono API、SQLite、driver 抽象、加密 |
| `apps/web/src` | Vite + React 前端,paper 主题 UI |
| `packages/shared/src` | 前后端共享的 TS 类型契约 |

## 关键约束(贯穿全项目)

- **本地优先**: 凭据、历史、图都不出本机
- **不持有用户凭据**: 公网部署时 inkast 不会向远端用户提供凭据,合规边界在用户机器
- **paper 主题红线**: 见 [视觉规范 token](../shared/paper-theme-tokens.md)
- **LLM 双通道**: ClaudeCode 默认 + OpenAI 兼容备选(Phase 1.5 实现)

## 关联条目

- [prompt-engine](./prompt-engine.md) — 散文 → JSON 的实现细节
- [provider-pool](./provider-pool.md) — 故障切换语义
- [image-generation](./image-generation.md) — 生图端到端流水
- [gallery](./gallery.md) — 历史展示
- [prompt-composer-loop](./prompt-composer-loop.md) — 输入 + 精修循环
- [shared-contracts](../shared/shared-contracts.md) — 前后端类型契约
- [claude-code-sdk-over-cli](../decisions/claude-code-sdk-over-cli.md) — LLM 通道选型
