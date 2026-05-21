import { Hono } from "hono";
import {
  getCallbackHealth,
  getHourBuckets,
  getLatency,
  getOverview,
  getProviderBreakdown,
  getRecentTasks,
  getTopErrorCodes,
  type CallbackHealth,
  type ErrorCodeRow,
  type HourBucket,
  type LatencyStats,
  type OverviewStats,
  type ProviderBreakdownRow,
  type RecentTaskRow,
} from "../../storage/plugin-stats.js";
import {
  getJobsHourBuckets,
  getJobsLatency,
  getJobsOverview,
  getJobsTopErrorCodes,
  getRecentJobs,
  type JobErrorCodeRow,
  type JobHourBucket,
  type JobLatencyStats,
  type JobOverviewStats,
  type RecentJobRow,
} from "../../storage/job-stats.js";

/**
 * Admin dashboard for the plugin channel. Loopback-only — `nginx /inkast/`
 * reverse-proxy only exposes `/plugins/*` to public; this `/admin/*` namespace
 * is not in any nginx location block, so it's reachable only via SSH port
 * forward (`ssh -L 8787:127.0.0.1:8787 jdc` → `http://localhost:8787/admin/...`).
 *
 * No auth middleware on purpose — loopback only + ssh tunnel is the security
 * boundary, an extra token here would just be ceremony.
 */
export const adminRoutes = new Hono();

const WINDOW_OPTIONS: Record<string, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  all: Number.MAX_SAFE_INTEGER,
};

adminRoutes.get("/plugin-stats", c => {
  const window = (c.req.query("window") || "24h") as keyof typeof WINDOW_OPTIONS;
  const windowMs = WINDOW_OPTIONS[window] ?? WINDOW_OPTIONS["24h"]!;
  const since = window === "all" ? 0 : Date.now() - windowMs;

  const overview = getOverview(since);
  const latency = getLatency(since);
  const callback = getCallbackHealth(since);
  const errors = getTopErrorCodes(since, 10);
  const providers = getProviderBreakdown(since);
  const buckets = getHourBuckets(Date.now() - 24 * 60 * 60 * 1000); // 24h 趋势固定
  const recent = getRecentTasks(50);

  // Web UI 通道(jobs 表)— 与 plugin_tasks 完全独立
  const webOverview = getJobsOverview(since);
  const webLatency = getJobsLatency(since);
  const webErrors = getJobsTopErrorCodes(since, 10);
  const webBuckets = getJobsHourBuckets(Date.now() - 24 * 60 * 60 * 1000);
  const webRecent = getRecentJobs(50);

  return c.html(
    renderHtml({
      window,
      overview,
      latency,
      callback,
      errors,
      providers,
      buckets,
      recent,
      webOverview,
      webLatency,
      webErrors,
      webBuckets,
      webRecent,
    }),
  );
});

// ─────────────────────────────────────────────────────────────────────────
// HTML 渲染
// ─────────────────────────────────────────────────────────────────────────

interface RenderInput {
  window: string;
  overview: OverviewStats;
  latency: { llm: LatencyStats; image: LatencyStats; total: LatencyStats };
  callback: CallbackHealth;
  errors: ErrorCodeRow[];
  providers: ProviderBreakdownRow[];
  buckets: HourBucket[];
  recent: RecentTaskRow[];
  webOverview: JobOverviewStats;
  webLatency: JobLatencyStats;
  webErrors: JobErrorCodeRow[];
  webBuckets: JobHourBucket[];
  webRecent: RecentJobRow[];
}

const STATUS_ZH: Record<string, string> = {
  queued: "排队中",
  running: "进行中",
  pending: "排队中",
  succeeded: "成功",
  failed: "失败",
  callback_lost: "回调丢失",
};

function renderHtml(d: RenderInput): string {
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  const winLink = (w: string, label: string) =>
    `<a href="?window=${w}" class="${d.window === w ? "active" : ""}">${label}</a>`;

  const fmtMs = (ms: number): string =>
    ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;

  const statusBadge = (s: string): string =>
    `<span class="badge b-${escapeAttr(s)}">${escapeText(STATUS_ZH[s] ?? s)}</span>`;

  const overviewStatusRows = Object.entries(d.overview.byStatus)
    .map(
      ([s, n]) =>
        `<div class="row"><span class="key">${statusBadge(s)}</span><span class="val num">${n}</span></div>`,
    )
    .join("");

  const pluginRows = Object.entries(d.overview.byPlugin)
    .map(([p, c]) => {
      const successRate = c.total > 0 ? ((c.succeeded / c.total) * 100).toFixed(0) : "—";
      return `<tr>
        <td><code>${escapeText(p)}</code></td>
        <td class="num">${c.total}</td>
        <td class="num">${c.succeeded}</td>
        <td class="num">${c.failed}</td>
        <td class="num">${c.callbackLost}</td>
        <td class="num">${successRate}%</td>
      </tr>`;
    })
    .join("");

  const renderLatencyCol = (label: string, s: LatencyStats): string => `
    <div>
      <div class="key" style="font-size:11px">${escapeText(label)}</div>
      <div class="num" style="font-size:13px;margin-top:2px">
        n=${s.count}<br>
        p50 ${fmtMs(s.p50)}<br>
        p90 ${fmtMs(s.p90)}<br>
        p99 ${fmtMs(s.p99)}<br>
        max ${fmtMs(s.max)}
      </div>
    </div>`;

  const callbackRows = Object.entries(d.callback.successAtAttempt)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(
      ([n, c]) =>
        `<div class="row"><span class="key">第 ${escapeText(n)} 次尝试成功</span><span class="val num">${c}</span></div>`,
    )
    .join("");

  const errorRows = d.errors.length
    ? d.errors
        .map(
          e =>
            `<div class="row"><span class="key"><code>${escapeText(e.code)}</code></span><span class="val num">${e.count}</span></div>`,
        )
        .join("")
    : `<div class="meta">(窗口内无失败任务)</div>`;

  const providerRows = d.providers.length
    ? d.providers
        .map(
          p => `<tr>
        <td><code>${escapeText(p.providerName)}</code></td>
        <td class="num">${p.succeeded}</td>
        <td class="num">${fmtMs(p.avgImageMs)}</td>
      </tr>`,
        )
        .join("")
    : `<tr><td colspan="3" class="meta">(窗口内无成功出图)</td></tr>`;

  const maxBucket = Math.max(1, ...d.buckets.map(b => b.total));
  const barlineHtml = d.buckets
    .map(b => {
      const totalH = Math.round((b.total / maxBucket) * 100);
      const failH = b.total > 0 ? Math.round((b.failed / b.total) * totalH) : 0;
      return `<div class="barcol" title="${escapeAttr(b.hour)}: 总=${b.total} 成功=${b.succeeded} 失败=${b.failed}">
        <div class="bar fail" style="height:${failH}%"></div>
        <div class="bar ok" style="height:${totalH - failH}%"></div>
      </div>`;
    })
    .join("");

  const recentRows = d.recent
    .map(r => {
      const created = new Date(r.createdAt).toISOString().replace("T", " ").slice(5, 19);
      const total = r.totalDurationMs != null ? fmtMs(r.totalDurationMs) : "—";
      const llm = r.llmDurationMs ? fmtMs(r.llmDurationMs) : "—";
      const img = r.imageDurationMs ? fmtMs(r.imageDurationMs) : "—";
      const lostMark = r.callbackLost ? `<span title="回调重试已耗尽">⚠</span>` : "";
      const provider = r.providerName ? `<code>${escapeText(r.providerName)}</code>` : "—";
      return `<tr>
        <td><code title="${escapeAttr(r.id)}">${escapeText(r.id.slice(0, 14))}…</code></td>
        <td><code>${escapeText(r.pluginId)}</code></td>
        <td>${statusBadge(r.status)}</td>
        <td>${provider}</td>
        <td class="num">${llm}</td>
        <td class="num">${img}</td>
        <td class="num">${total}</td>
        <td class="num">${r.callbackAttempts}${lostMark}</td>
        <td>${r.errorCode ? `<code>${escapeText(r.errorCode)}</code>` : "—"}</td>
        <td><span class="meta-host" title="${escapeAttr(r.callbackHost)}">${escapeText(r.callbackHost)}</span></td>
        <td class="num meta-time">${escapeText(created)}</td>
      </tr>`;
    })
    .join("");

  // ── Web UI 通道(jobs)对应变量 ─────────────────────────────────────────
  const webOverviewStatusRows = Object.entries(d.webOverview.byStatus)
    .map(
      ([s, n]) =>
        `<div class="row"><span class="key">${statusBadge(s)}</span><span class="val num">${n}</span></div>`,
    )
    .join("");

  const webErrorRows = d.webErrors.length
    ? d.webErrors
        .map(
          e =>
            `<div class="row"><span class="key"><code>${escapeText(e.code)}</code></span><span class="val num">${e.count}</span></div>`,
        )
        .join("")
    : `<div class="meta">(窗口内无失败任务)</div>`;

  const webMaxBucket = Math.max(1, ...d.webBuckets.map(b => b.total));
  const webBarlineHtml = d.webBuckets
    .map(b => {
      const totalH = Math.round((b.total / webMaxBucket) * 100);
      const failH = b.total > 0 ? Math.round((b.failed / b.total) * totalH) : 0;
      return `<div class="barcol" title="${escapeAttr(b.hour)}: 总=${b.total} 成功=${b.succeeded} 失败=${b.failed}">
        <div class="bar fail" style="height:${failH}%"></div>
        <div class="bar ok" style="height:${totalH - failH}%"></div>
      </div>`;
    })
    .join("");

  const webRecentRows = d.webRecent
    .map(r => {
      const created = new Date(r.createdAt).toISOString().replace("T", " ").slice(5, 19);
      const total = r.totalDurationMs != null ? fmtMs(r.totalDurationMs) : "—";
      return `<tr>
        <td><code title="${escapeAttr(r.id)}">${escapeText(r.id.slice(0, 14))}…</code></td>
        <td>${statusBadge(r.status)}</td>
        <td><code>${escapeText(r.size)}</code></td>
        <td><code>${escapeText(r.quality)}</code></td>
        <td class="num">${total}</td>
        <td>${r.errorCode ? `<code>${escapeText(r.errorCode)}</code>` : "—"}</td>
        <td class="num meta-time">${escapeText(created)}</td>
      </tr>`;
    })
    .join("");

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="60">
<title>inkast · 任务统计</title>
<style>
* { box-sizing: border-box; }
body { font: 14px/1.5 -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif; margin: 0; padding: 20px; background: #F2EBDC; color: #2A2620; }
h1 { font-size: 18px; margin: 0 0 6px; font-weight: 600; letter-spacing: -0.012em; }
h2.section { font-size: 14px; margin: 20px 0 10px; font-weight: 600; letter-spacing: 0.02em; color: #3A5A40; border-bottom: 1px solid rgba(58,90,64,0.18); padding-bottom: 4px; }
.topmeta { color: #7A6F5E; font-size: 12px; margin-bottom: 20px; }
.topmeta a { color: #3A5A40; margin: 0 4px; text-decoration: none; padding: 2px 8px; border-radius: 3px; }
.topmeta a.active { background: #3A5A40; color: #FBF6EA; }
.grid { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); margin-bottom: 14px; }
.card { background: #FBF6EA; padding: 14px 16px; border-radius: 4px; box-shadow: inset 0 0 0 1px rgba(70,45,20,0.08), 0 1px 3px rgba(70,45,20,0.06); }
.card.wide { grid-column: 1 / -1; }
.card h2 { font-size: 12px; margin: 0 0 10px; font-weight: 600; letter-spacing: 0.04em; color: #7A6F5E; }
.big { font-size: 28px; font-weight: 600; letter-spacing: -0.012em; }
.row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 13px; }
.row + .row { border-top: 1px dashed rgba(70,45,20,0.12); }
.key { color: #7A6F5E; }
.val { font-variant-numeric: tabular-nums; }
.num { font-variant-numeric: tabular-nums; font-family: "SF Mono", Menlo, "Courier New", monospace; }
.badge { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 11px; font-weight: 500; }
.b-queued { background: #E1DBC9; color: #5C5544; }
.b-running { background: #FCE3A0; color: #6E5612; }
.b-succeeded { background: #C8E0CA; color: #2A4A2E; }
.b-failed { background: #F0C4BC; color: #6B2620; }
.b-callback_lost { background: #E0CCFA; color: #4A2E6E; }
table { width: 100%; border-collapse: collapse; font-size: 12px; }
table th, table td { text-align: left; padding: 6px 8px; border-bottom: 1px solid rgba(70,45,20,0.08); }
table th { font-weight: 600; color: #7A6F5E; font-size: 11px; letter-spacing: 0.04em; }
table tr:hover td { background: rgba(70,45,20,0.03); }
.meta-host { color: #7A6F5E; font-size: 11px; }
.meta-time { color: #7A6F5E; font-size: 11px; }
.latencyrow { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
.barline { display: flex; align-items: flex-end; gap: 1px; height: 60px; margin-top: 8px; }
.barcol { display: flex; flex-direction: column-reverse; flex: 1; min-width: 3px; height: 100%; }
.bar.ok { background: #3A5A40; }
.bar.fail { background: #A4453B; }
code { font-family: "SF Mono", Menlo, "Courier New", monospace; font-size: 11px; background: rgba(70,45,20,0.06); padding: 1px 4px; border-radius: 2px; }
.meta { color: #7A6F5E; font-size: 11px; margin: 4px 0; }
</style>
</head>
<body>
<h1>inkast · 任务统计</h1>
<div class="topmeta">
  生成时间 ${now} · 60 秒自动刷新 · 时间窗口:
  ${winLink("24h", "最近 24 小时")} ${winLink("7d", "最近 7 天")} ${winLink("30d", "最近 30 天")} ${winLink("all", "全部")}
</div>

<h2 class="section">Plugin 通道(外部客户)</h2>
<div class="grid">

  <div class="card">
    <h2>总览</h2>
    <div class="big">${d.overview.total}</div>
    <div class="meta">时间窗口内任务数</div>
    <div style="margin-top:10px">
      ${overviewStatusRows || '<div class="meta">(无任务)</div>'}
    </div>
  </div>

  <div class="card">
    <h2>耗时分布 · 毫秒</h2>
    <div class="latencyrow">
      ${renderLatencyCol("LLM 拆解", d.latency.llm)}
      ${renderLatencyCol("生图", d.latency.image)}
      ${renderLatencyCol("总耗时", d.latency.total)}
    </div>
  </div>

  <div class="card">
    <h2>回调健康度</h2>
    <div class="row"><span class="key">总尝试回调数</span><span class="val num">${d.callback.totalCallbacks}</span></div>
    <div class="row"><span class="key">每任务平均尝试次数</span><span class="val num">${d.callback.avgAttempts.toFixed(2)}</span></div>
    <div class="row"><span class="key">回调丢失(4 次重试都失败)</span><span class="val num">${d.callback.callbackLost}</span></div>
    ${callbackRows || '<div class="meta">(窗口内未触发回调)</div>'}
  </div>

  <div class="card">
    <h2>错误码 Top 10</h2>
    ${errorRows}
  </div>

  <div class="card wide">
    <h2>渠道分布(出图来源)</h2>
    <div class="meta">仅统计 succeeded + callback_lost(图已生成);前置失败(如 LLM 不可用)未到 driver,不计入</div>
    <table>
      <thead><tr><th>渠道(provider)</th><th>成功出图数</th><th>平均生图耗时</th></tr></thead>
      <tbody>${providerRows}</tbody>
    </table>
  </div>

  <div class="card wide">
    <h2>最近 24 小时趋势(按小时)</h2>
    <div class="meta">绿 = 成功 · 红 = 失败 · 悬停柱状条看详情</div>
    <div class="barline">${barlineHtml || '<div class="meta">(无数据)</div>'}</div>
  </div>

  <div class="card wide">
    <h2>按 Plugin 拆分</h2>
    <table>
      <thead><tr><th>Plugin</th><th>总数</th><th>成功</th><th>失败</th><th>回调丢失</th><th>成功率</th></tr></thead>
      <tbody>${pluginRows || '<tr><td colspan="6" class="meta">(无 plugin 任务)</td></tr>'}</tbody>
    </table>
  </div>

  <div class="card wide">
    <h2>最近任务(最近 50 条,不限时间窗口)</h2>
    <table>
      <thead><tr><th>任务 ID</th><th>Plugin</th><th>状态</th><th>渠道</th><th>LLM</th><th>生图</th><th>总耗时</th><th>回调次数</th><th>错误</th><th>回调主机</th><th>创建时间</th></tr></thead>
      <tbody>${recentRows || '<tr><td colspan="11" class="meta">(暂无任务)</td></tr>'}</tbody>
    </table>
  </div>

</div>

<h2 class="section">Web UI 通道(本机生图)</h2>
<div class="grid">

  <div class="card">
    <h2>总览</h2>
    <div class="big">${d.webOverview.total}</div>
    <div class="meta">时间窗口内任务数</div>
    <div style="margin-top:10px">
      ${webOverviewStatusRows || '<div class="meta">(无任务)</div>'}
    </div>
  </div>

  <div class="card">
    <h2>总耗时 · 毫秒</h2>
    <div class="meta">仅成功任务;Web UI 通道未拆分 LLM/生图阶段</div>
    <div class="num" style="font-size:13px;margin-top:6px">
      n=${d.webLatency.count}<br>
      p50 ${fmtMs(d.webLatency.p50)}<br>
      p90 ${fmtMs(d.webLatency.p90)}<br>
      p99 ${fmtMs(d.webLatency.p99)}<br>
      max ${fmtMs(d.webLatency.max)}
    </div>
  </div>

  <div class="card">
    <h2>错误码 Top 10</h2>
    ${webErrorRows}
  </div>

  <div class="card wide">
    <h2>最近 24 小时趋势(按小时)</h2>
    <div class="meta">绿 = 成功 · 红 = 失败 · 悬停柱状条看详情</div>
    <div class="barline">${webBarlineHtml || '<div class="meta">(无数据)</div>'}</div>
  </div>

  <div class="card wide">
    <h2>最近任务(最近 50 条,不限时间窗口)</h2>
    <table>
      <thead><tr><th>任务 ID</th><th>状态</th><th>尺寸</th><th>质量</th><th>总耗时</th><th>错误</th><th>创建时间</th></tr></thead>
      <tbody>${webRecentRows || '<tr><td colspan="7" class="meta">(暂无任务)</td></tr>'}</tbody>
    </table>
  </div>

</div>
</body>
</html>`;
}

function escapeText(s: string | null | undefined): string {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(s: string | null | undefined): string {
  return escapeText(s).replace(/"/g, "&quot;");
}
