# Admin Dashboard(`/admin/plugin-stats`)

inkast **两条通道**的运行状态可视化页面——Plugin 通道(对外接入)+ Web UI 通道(本机生图)。**Loopback only** —— 公网 nginx `/inkast/` 反代不暴露 `/admin/*`,只通过 SSH 端口转发可达。

**2026-05-21 起标题改为"inkast · 任务统计"**(原"plugin 通道 · 统计"),分两个 section 并列展示两通道。

## 入口

| | |
|---|---|
| URL | `http://127.0.0.1:8787/admin/plugin-stats` |
| 访问方式 | `ssh -L 8787:127.0.0.1:8787 jdc` 转发后本机浏览器 |
| 鉴权 | 无(loopback + ssh tunnel 是安全边界,加 token 是 ceremony) |
| Web UI 入口 | 主 Web UI header 右上角 "Stats" 按钮(`<a target="_blank">`) |
| 渲染 | 服务端单文件 HTML,inline CSS,**零外部 CDN**,meta refresh 60s |
| 时间窗口 | `?window=24h | 7d | 30d | all`(默认 24h) |

## Section 1: Plugin 通道(对外客户)

数据源 `plugin_tasks` 表,聚合查询在 `apps/api/src/storage/plugin-stats.ts`。

| 卡 | 内容 |
|---|---|
| 总览 | 总任务数 + 状态分布(中文:排队中/进行中/成功/失败/回调丢失) |
| 耗时分布 · 毫秒 | LLM 拆解 / 生图 / 总耗时 三列各 p50/p90/p99/max + 样本数 |
| 回调健康度 | 总尝试 + 平均次数 + 回调丢失数 + 每次尝试成功数分布 |
| 错误码 Top 10 | failed 任务按 `error_code` 聚合 |
| **渠道分布(出图来源)** | provider_name / 成功出图数 / 平均生图耗时 |
| 最近 24h 趋势(按小时) | 柱状图(绿=成功 红=失败)hover 详情 |
| 按 Plugin 拆分 | 每个 plugin 总数/成功/失败/回调丢失/成功率 |
| 最近 50 条任务 | task_id 短/plugin/状态/**渠道**/LLM/生图/总耗时/回调次数/错误/回调主机/创建时间 |
| **attempts 链徽章**(每行的"渠道"列) | `p1 ✓ · p2 ✗server` 形式,展示 task 经历的每个 provider attempt 结果。**失败徽章 hover 弹纯 CSS 浮层**(header / meta / pretty-print errorBody 三段),便于调试 |

**header 顶部新增"插件作品图 →" chip**(2026-05-22)——跳转 `/?tab=plugin-gallery` 看 plugin 通道生成图的瀑布流(react-masonry-css SPA 页)。chip 是 dashboard ↔ gallery 的双向入口之一。

**running 任务进度徽章**(2026-06)——"最近 50 条任务"表中,`status='running'` 的行在"渠道"列前显示墨绿 `r{n}` 轮徽章(`r0` 原图、`r1/r2/r3` 改写降级轮)。数据来源:plugin worker 的 `onProgress` 回调增量写 `plugin_tasks.current_round`(详见 [plugin-channel](plugin-channel.md) 实时进度小节)。终态行不显示徽章。

## Section 2: Web UI 通道(本机生图)

数据源 `jobs` 表(Web UI 通道异步任务),聚合查询在 `apps/api/src/storage/job-stats.ts`。

字段是 Plugin section 的**子集**——jobs 表没有 callback、plugin_id、LLM+生图拆分耗时,所以卡片不含"回调健康度"、"按 Plugin 拆分"、"渠道分布"。

| 卡 | 内容 |
|---|---|
| 总览 | 总任务数 + 状态分布(pending → running → succeeded/failed) |
| **总耗时 · 毫秒** | p50/p90/p99/max + 样本数(单列,**未拆分 LLM/生图阶段**——jobs 不打这两段点) |
| 错误码 Top 10 | 同 Plugin section |
| 最近 24h 趋势 | 同 Plugin section |
| 最近 50 条任务 | task_id 短/状态/**size**/**quality**/总耗时/错误/创建时间(无 plugin/渠道/callback 列) |

## 北京时间显示

**2026-06 新增**。所有时间戳统一显示北京时间(UTC+8)。

- `admin.ts` 内 `formatBeijing(ms, { short? })` 函数:用 `new Date(ms).toLocaleString("sv-SE", { timeZone: "Asia/Shanghai", ... })`——sv-SE locale 天然输出 `YYYY-MM-DD HH:mm:ss` 格式,免去手动 `padStart`。`short=true` 截取后 14 位得 `MM-DD HH:mm:ss`。
- 页面顶部"生成时间"用完整格式,recent 表各行创建时间用 `short` 格式。
- `plugin-stats.ts` 的 `getHourBuckets` 和 `job-stats.ts` 的 `getJobsHourBuckets` SQL 里 `strftime` 加 `'+8 hours'` 偏移,使小时分桶坐标轴与 recent 表时间同口径(都显示北京时)。

## 关键文件

| 文件 | 职责 |
|---|---|
| `apps/api/src/server/routes/admin.ts` | 路由 + HTML 渲染 + `formatBeijing` 时间格式化 + running 任务 `r{n}` 轮徽章渲染 + `/admin/plugin-gallery.json` JSON endpoint |
| `apps/api/src/storage/plugin-stats.ts` | Plugin 通道 aggregate(`getOverview` / `getLatency` / `getCallbackHealth` / `getTopErrorCodes` / `getProviderBreakdown` / `getHourBuckets` / `getRecentTasks`);`RecentTaskRow.currentRound` 字段;`getHourBuckets` strftime +8h 偏移 |
| `apps/api/src/storage/job-stats.ts` | **Web UI 通道 aggregate**(`getJobsOverview` / `getJobsLatency` / `getJobsTopErrorCodes` / `getJobsHourBuckets` / `getRecentJobs`);`getJobsHourBuckets` strftime +8h 偏移 |
| `apps/web/src/App.tsx`(header 段) | Web UI Stats 按钮 + plugin-gallery Tab 路由 |

## 设计原则

- **服务端渲染**:避免 SPA 复杂度,meta refresh 60s 自动刷
- **零外部资源**:CDN / webfont / npm chunk 都不依赖,确保 loopback 环境下完全本地加载
- **Paper 主题对齐**:复用主仓视觉 token(`#F2EBDC` 背景 / `#2A2620` 字 / `#3A5A40` accent green)
- **掩码隐私**:recent table 不显示 `callback_url` 全值,只显示 host
- **NO auth on purpose**:加 token 是 ceremony,loopback + ssh 转发就是安全边界

## 关联条目

- [plugin-channel](plugin-channel.md) — dashboard 服务的是这个通道;running 任务进度来源
- [plugin-gallery](plugin-gallery.md) — header chip 跳转的 SPA 作品图页
- [paper-theme-tokens](../shared/paper-theme-tokens.md) — 视觉对齐用
