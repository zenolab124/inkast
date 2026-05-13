# Inkast

本地优先的 AI 生图网页工具。把粗糙想法 → 结构化 JSON prompt → 图，整个链路在本机闭环。LLM 后端默认走**本机 ClaudeCode**（无需 API key），也保留 OpenAI 兼容 API 作为备选。

## 项目血统

Inkast 是两个上游项目的有机结合，**不是 fork**，是借鉴 + 重写：

| 来源 | 路径 | 取什么 | 舍什么 |
| --- | --- | --- | --- |
| gpt-image-canvas | `~/workspace/cc-clone/gpt-image-canvas` | 工程骨架（monorepo / API / SQLite）、provider 池设计、SQLite 凭据加密存储、生图历史/Gallery、可选云备份 | tldraw 画布、Agent DAG 规划器（Phase 1 不做） |
| imagegen | `~/workspace/cc-skills/imagegen` | 散文 → JSON prompt 方法论、字段词典、模板库、安全红线、provider 池 + 故障切换语义 | macOS Keychain 凭据后端、Python 脚本实现、纯 CLI 形态 |

读源项目的具体细节时直接打开上面两个目录，别凭印象写。

## 关键设计决策（一次性记牢）

1. **LLM 后端双通道，ClaudeCode 是一等公民**
   - 默认通道：本机 ClaudeCode，通过 `@anthropic-ai/claude-agent-sdk` embed，**不要** spawn `claude` CLI。
   - 备选通道：OpenAI 兼容 Chat Completions（用户在配置弹窗填 base_url + key）。
   - 后端层用 driver 接口抽象，前端给一个明显的 toggle，默认 ClaudeCode。
   - 用 ClaudeCode 时不要把 API key 暴露给 SDK；走本机 OAuth 凭据。

2. **生图后端：OpenAI 兼容 + provider 池**
   - 沿用 gpt-image-canvas 的 provider 弹窗 + SQLite 加密存储（**不**用 macOS Keychain，要跨平台）。
   - 池语义沿用 imagegen：按 priority 升序尝试，网络/5xx/配额自动切换，**内容审查拒绝默认不切换**（防止把池子当绕审工具）。
   - 模型契约：OpenAI 兼容 `/v1/images/generations`，默认模型 `gpt-image-2`。

3. **画布：不用 tldraw**
   - 替换为网格 / 瀑布流（参考 Midjourney、Lexica 的浏览体验）。
   - 主交互：左边输入区 + 字段化 prompt 编辑器，右边/下方是生成结果流，点击可展开详情、下载、再生成、改 prompt 重跑。
   - 这意味着 gpt-image-canvas 的 `apps/web/src/features/canvas` 整块**不要复制**，重写。

4. **散文 → JSON prompt 引擎**
   - 把 imagegen 的方法论（`reference/fields.md` `templates.md` `decomposition.md` `safety.md`）作为 ClaudeCode driver 的 system prompt / 工具知识源。
   - JSON schema 沿用 imagegen 的字段定义：`type / style / subject / background / layout / text_elements`，按需扩展 `lighting / mood / camera / color_palette / count`。
   - **关键交互**：LLM 产出 JSON 后必须主动指出 2-3 个模糊点让用户补充，这是 imagegen 方法论里最重要的环节，别省略。

5. **本地优先**
   - 凭据、生成历史、生成图、JSON prompt 备份都先写本地（SQLite + 文件系统）。
   - 云备份（COS / R2）作为可选项，Phase 1 不做。

## 技术栈

```
Monorepo  : pnpm workspace
Node      : 24.10+ （原 gpt-image-canvas 锁 24.15，inkast 放宽）
后端       : Hono + better-sqlite3
前端       : Vite + React + TypeScript
LLM SDK   : @anthropic-ai/claude-agent-sdk (默认) + 自建 OpenAI 兼容 client (备选)
生图       : OpenAI 兼容 /v1/images/generations，默认 gpt-image-2
样式       : Tailwind CSS + shadcn/ui（组件源码 own 在 apps/web/src/components/ui）
图标       : lucide-react
字体       : Source Serif（标题）+ Source Sans（正文），通过 fontsource 本地化
```

## 视觉规范（PAPER 主题 · 已锁定）

主基调：**纸张质感（Paper）**——浓米色卡纸、墨色文字、低对比、暖阴影、系统字、SVG 颗粒 + 四角 vignette。参考 Notion + Are.na 的味道，反 Midjourney 那种深色科技感。

**真理源**：`apps/web/src/styles/themes/paper.css`。**所有视觉值通过 CSS 变量，不在组件里硬编码**。换主题 = 换 token 文件，不改组件。

### 当前 token 速查

| 维度 | 亮色 | 暗色 |
| --- | --- | --- |
| 背景 | 浓米色 `#F2EBDC` | 暗墨 `#1A1714` |
| 文字 | 深棕墨 `#2A2620` | 暖白 |
| 卡片 | 米黄 `#FBF6EA`（比背景亮一档） | 比背景亮一档 |
| 主色 | 墨绿 `#3A5A40` | 浅墨绿 |
| 强调 | 砖红 `#A4453B` | 浅砖红 |
| 圆角 | `--radius: 0.3rem`（4-6px） | 同 |
| 阴影 | 三层：内高光描边 + 紧贴棕投影 + 漫射软投影 | 同结构，黑色 |

全站叠两层 body 效果：

- `body::before` SVG fractalNoise 颗粒，7% 不透明度，multiply 混合
- `body::after` radial vignette，四角微暗，multiply 混合

### 字体（红线）

- ❌ **中文绝对禁止任何衬线字体**（Songti、SimSun、Source Serif、Lora、Newsreader 等）——宋体会让整体瞬间"出版社感"过时
- ❌ **禁止 import 任何 webfont**（@fontsource / Google Fonts / 本地 ttf）——零网络字体是硬规则
- ❌ **禁止在组件里写 `font-family` 字面量**
- ✅ 字体统一来自 `var(--font-sans)` / Tailwind `font-sans`，最终落到系统栈：`-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI Variable", "Segoe UI", "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", system-ui, sans-serif`
- ✅ 标题：sans + 600，字距 `-0.012em`
- ✅ 正文：sans + 400-500

### 颜色（红线）

- ❌ **禁止在组件里写颜色字面量**（`#xxx` / `rgb(...)` / `bg-zinc-50` 等）
- ❌ **禁止纯黑 `#000` 和纯白 `#FFF`**——最暗到 `--foreground`，最亮到 `--card`
- ❌ 阴影颜色禁止用中性灰，必须棕调（`rgba(70,45,20,*)` 系）——shadcn 默认灰阴影会破坏纸感
- ✅ 一律走语义 token：`bg-background` `text-foreground` `bg-card` `bg-primary` `text-muted-foreground` `border-border` 等
- ✅ 阴影走 `shadow-(--shadow-paper)` 或 `shadow-(--shadow-paper-lifted)`，不用 Tailwind 默认 `shadow-md` 等

### 形状 & 间距（准则）

- 圆角：卡片/按钮 `rounded-md`（=4-6px），小标签 `rounded-sm`，**不要** `rounded-xl`+
- 不要拟物大渐变、不要 glassmorphism 模糊（那是 glass 主题的事，paper 主题禁用 `backdrop-blur`）
- 不要"科技感"霓虹边、不要发光 `ring` 高饱和度

### 组件新增/修改自检清单

写或改任何 UI 组件前对照，每一条都过才能 merge：

1. 颜色全走语义 token，无 hex/rgb 字面量？
2. 字体未指定 `font-family`，继承系统栈？
3. 阴影用了 paper 三层投影变量，没有用 Tailwind 默认灰阴影？
4. 圆角 ≤ `rounded-md`？
5. 没有引入新的 webfont？
6. 中文文字在亮色和暗色下都是 PingFang（不是 Songti）？
7. 没有破坏全站 noise + vignette 层（不要在子容器再叠一遍噪点）？

### 备选主题：玻璃质感（Glass）

`themes/glass.css` 是占位，Phase 1 不实现。要做时**只动 token 文件**，不改任何组件代码。届时 glass 会允许 `backdrop-blur` 和深色渐变背景——那是 glass 的特权，paper 主题里禁止。

## 目录结构（规划，未生成）

```
apps/
  api/            Hono API、SQLite、provider 池、LLM driver
    src/
      domain/     生图、prompt、provider 等领域逻辑
      drivers/    llm/ (claude-code / openai) + image/ (openai-compatible)
      storage/    SQLite schema + 仓储
      server/     路由
  web/            Vite + React 前端
    src/
      components/
        ui/       shadcn/ui 组件源码（own）
      features/
        prompt/   散文输入 + 字段化编辑器 + 模糊点反馈
        gallery/  网格/瀑布流历史
        config/   provider + LLM 后端配置弹窗
      styles/
        themes/   paper.css (默认) + glass.css (备选占位)
        globals.css
packages/
  shared/         前后端共享契约（JSON prompt schema、API 类型）
docs/
data/             SQLite + 生成图本地存放，gitignored
```

## Phase 1 范围（MVP）

只做这四件事，**Agent DAG / 云备份 / tldraw 都不做**：

1. **散文 → JSON prompt 引擎**：复用 imagegen 方法论，LLM 产出 JSON + 模糊点建议。
2. **本机 ClaudeCode 接入**：Agent SDK driver，默认开启。
3. **OpenAI 兼容生图 + provider 池**：弹窗配置、加密入库、按 priority 故障切换。
4. **生图历史**：网格/瀑布流展示，本地 SQLite + 文件持久化，支持下载、重跑。

LLM 备选通道（OpenAI 兼容 Chat）可以 Phase 1 一起做，也可以 Phase 1.5 补。

## 不要做的事

- 不要把 gpt-image-canvas 的 `apps/web/src/features/canvas` `apps/web/src/features/agent` 整体复制过来。
- 不要引入 tldraw。
- 不要用 macOS Keychain 作为凭据后端（imagegen 的 generate.py 仅供参考，不直接复用）。
- 不要在 Phase 1 做 Agent DAG 多图规划。
- 不要在 Phase 1 做云备份（COS / R2）。
- 不要 spawn `claude` CLI，用 SDK。

## 参考资料

- gpt-image-canvas 中文说明：`~/workspace/cc-clone/gpt-image-canvas/README.zh-CN.md`
- imagegen 方法论：`~/workspace/cc-skills/imagegen/SKILL.md` + `reference/*.md`
- imagegen 多 provider 池脚本（语义参考）：`~/workspace/cc-skills/imagegen/scripts/generate.py`
- Claude Agent SDK：包名 `@anthropic-ai/claude-agent-sdk`
