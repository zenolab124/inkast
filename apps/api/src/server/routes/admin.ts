import type {
  GenerateImageAttempt,
  ListPluginGalleryResponse,
  PluginGalleryItem,
} from "@inkast/shared";
import { Hono } from "hono";
import {
  listPluginGallery as listPluginGalleryRows,
  pluginGalleryCountsByPlugin,
  pluginGalleryTotal,
} from "../../storage/plugin-gallery.js";
import {
  getCallbackHealth,
  getHourBuckets,
  getLatency,
  getOverview,
  getProviderBreakdown,
  getProviderFailures,
  getRecentTasks,
  getTopErrorCodes,
  type CallbackHealth,
  type ErrorCodeRow,
  type HourBucket,
  type LatencyStats,
  type OverviewStats,
  type ProviderBreakdownRow,
  type ProviderFailureRow,
  type RecentTaskRow,
} from "../../storage/plugin-stats.js";
import {
  getJobsHourBuckets,
  getJobsLatency,
  getJobsOverview,
  getJobsProviderBreakdown,
  getJobsProviderFailures,
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
  const providerFailures = getProviderFailures(since);
  const buckets = getHourBuckets(Date.now() - 24 * 60 * 60 * 1000); // 24h 趋势固定
  const recent = getRecentTasks(50);

  // Web UI 通道(jobs 表)— 与 plugin_tasks 完全独立
  const webOverview = getJobsOverview(since);
  const webLatency = getJobsLatency(since);
  const webErrors = getJobsTopErrorCodes(since, 10);
  const webProviders = getJobsProviderBreakdown(since);
  const webProviderFailures = getJobsProviderFailures(since);
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
      providerFailures,
      buckets,
      recent,
      webOverview,
      webLatency,
      webErrors,
      webProviders,
      webProviderFailures,
      webBuckets,
      webRecent,
    }),
  );
});

/**
 * Loopback-only JSON feed for the admin plugin-gallery page (rendered in the
 * main React UI as a Tab — `?tab=plugin-gallery`). Backed by the long-lived
 * `plugin_gallery_items` table; rows survive the 24h GC on `plugin_tasks`.
 *
 * Keyset pagination: pass `?cursor=<createdAt>_<id>` to get the next page.
 * `nextCursor` is null when no more rows remain. `pluginCounts` + `total` are
 * computed across the entire gallery (ignoring the cursor) so the filter chip
 * bar shows stable totals even mid-scroll.
 *
 * Sits under `/admin/*` for the same reason as `plugin-stats`: nginx's public
 * vhost only proxies `/plugins/v1/*`, so `/admin/*` is loopback-only.
 */
adminRoutes.get("/plugin-gallery.json", c => {
  const limit = Math.min(200, Math.max(1, Number(c.req.query("limit")) || 60));
  const cursor = c.req.query("cursor") ?? null;
  const pluginId = c.req.query("pluginId")?.trim() || null;

  const { items, nextCursor } = listPluginGalleryRows({ cursor, limit, pluginId });
  const mapped: PluginGalleryItem[] = items.map(r => ({
    id: r.id,
    pluginId: r.pluginId,
    providerName: r.providerName,
    imageUrl: r.imageUrl,
    mime: r.mime,
    prompt: r.prompt,
    promptJson: r.promptJson ? safeParseJson(r.promptJson) : null,
    rewrittenPrompts: r.rewrittenPrompts,
    successRound: r.successRound,
    postReviewEdited: r.postReviewEdited,
    llmDurationMs: r.llmDurationMs,
    imageDurationMs: r.imageDurationMs,
    createdAt: r.createdAt,
  }));

  const body: ListPluginGalleryResponse = {
    items: mapped,
    nextCursor,
    total: pluginGalleryTotal(),
    pluginCounts: pluginGalleryCountsByPlugin(),
  };
  return c.json(body);
});

function safeParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

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
  providerFailures: ProviderFailureRow[];
  buckets: HourBucket[];
  recent: RecentTaskRow[];
  webOverview: JobOverviewStats;
  webLatency: JobLatencyStats;
  webErrors: JobErrorCodeRow[];
  webProviders: ProviderBreakdownRow[];
  webProviderFailures: ProviderFailureRow[];
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

// 北京时间(Asia/Shanghai)格式化。sv-SE locale 天然输出 "YYYY-MM-DD HH:mm:ss"
// ISO 风格,免去手动 padStart。short=true 返回 "MM-DD HH:mm:ss"。
function formatBeijing(ms: number, opts?: { short?: boolean }): string {
  const full = new Date(ms).toLocaleString("sv-SE", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  return opts?.short ? full.slice(5) : full;
}

function renderHtml(d: RenderInput): string {
  const now = formatBeijing(Date.now());
  const winLink = (w: string, label: string) =>
    `<a href="?window=${w}" class="${d.window === w ? "active" : ""}">${label}</a>`;

  const fmtMs = (ms: number): string =>
    ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;

  const statusBadge = (s: string): string =>
    `<span class="badge b-${escapeAttr(s)}">${escapeText(STATUS_ZH[s] ?? s)}</span>`;

  // 渠道链:把 ImageGenAttempt[] 渲染成 "p1 ✓ · p2 ✗server · p3 ✗moderation"
  // 这种横向徽章序列。失败徽章 hover 时弹一个 CSS 浮层(.tip 子元素),
  // 里面 pretty-print 完整 raw body(httpStatus / requestId / errorBody)。
  // 当 attempts 为空时,用最终 provider_name 兜底显示(老数据/失败到达 driver 前)。
  const renderAttemptChain = (
    finalProvider: string | null,
    attempts: GenerateImageAttempt[],
  ): string => {
    if (attempts.length === 0) {
      return finalProvider
        ? `<code>${escapeText(finalProvider)}</code>`
        : "—";
    }
    const parts = attempts.map(a => {
      if (a.ok) {
        return `<span class="att att-ok" title="${escapeAttr(`${a.providerName} · ${a.durationMs}ms`)}"><code>${escapeText(a.providerName)}</code> ✓</span>`;
      }
      const code = a.errorCode ?? "unknown";
      return `<span class="att att-fail"><code>${escapeText(a.providerName)}</code> ✗<span class="att-code">${escapeText(code)}</span>${renderAttemptTip(a)}</span>`;
    });
    return `<div class="chain">${parts.join('<span class="att-sep">·</span>')}</div>`;
  };

  const renderProviderFailures = (rows: ProviderFailureRow[]): string => {
    if (rows.length === 0) {
      return `<tr><td colspan="4" class="meta">(窗口内无 attempt 记录)</td></tr>`;
    }
    return rows
      .map(r => {
        const failRate =
          r.totalAttempts > 0
            ? ((r.failedAttempts / r.totalAttempts) * 100).toFixed(0)
            : "—";
        const codes = Object.entries(r.byErrorCode)
          .sort(([, a], [, b]) => b - a)
          .map(([code, n]) => `<code title="${escapeAttr(code)}">${escapeText(code)}</code>×${n}`)
          .join(" ");
        return `<tr>
          <td><code>${escapeText(r.providerName)}</code></td>
          <td class="num">${r.totalAttempts}</td>
          <td class="num">${r.failedAttempts} (${failRate}%)</td>
          <td>${codes || "—"}</td>
        </tr>`;
      })
      .join("");
  };

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
      const created = formatBeijing(r.createdAt, { short: true });
      const total = r.totalDurationMs != null ? fmtMs(r.totalDurationMs) : "—";
      const llm = r.llmDurationMs ? fmtMs(r.llmDurationMs) : "—";
      const img = r.imageDurationMs ? fmtMs(r.imageDurationMs) : "—";
      const lostMark = r.callbackLost ? `<span title="回调重试已耗尽">⚠</span>` : "";
      // 进行中任务:实时进度由 worker 的 onProgress 增量写库(current_round +
      // 已走渠道 attempts)。终态行不显示轮徽章(看 chain / err 即可)。
      const roundTag =
        r.status === "running" && r.currentRound != null
          ? `<span class="round-tag" title="当前进行到第 ${r.currentRound} 轮(0=原图 1/2/3=改写降级轮)">r${r.currentRound}</span> `
          : "";
      const chain = roundTag + renderAttemptChain(r.providerName, r.attempts);
      const rewrite = renderRewriteSummary(r);
      const errCell = r.errorCode
        ? `<div class="error-cell"><code>${escapeText(r.errorCode)}</code>${
            r.errorMsg ? `<span>${escapeText(shorten(r.errorMsg, 96))}</span>` : ""
          }</div>`
        : "—";
      return `<tr>
        <td><code title="${escapeAttr(r.id)}">${escapeText(r.id.slice(0, 14))}…</code></td>
        <td><code>${escapeText(r.pluginId)}</code></td>
        <td>${statusBadge(r.status)}</td>
        <td>${chain}</td>
        <td>${rewrite}</td>
        <td class="num">${llm}</td>
        <td class="num">${img}</td>
        <td class="num">${total}</td>
        <td class="num">${r.callbackAttempts}${lostMark}</td>
        <td>${errCell}</td>
        <td><span class="meta-host" title="${escapeAttr(r.callbackHost)}">${escapeText(r.callbackHost)}</span></td>
        <td class="num meta-time">${escapeText(created)}</td>
      </tr>`;
    })
    .join("");

  const providerFailureRows = renderProviderFailures(d.providerFailures);

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
      const created = formatBeijing(r.createdAt, { short: true });
      const total = r.totalDurationMs != null ? fmtMs(r.totalDurationMs) : "—";
      const chain = renderAttemptChain(r.providerName, r.attempts);
      const errCell = r.errorCode
        ? `<code title="${escapeAttr(r.errorMessage ?? "")}">${escapeText(r.errorCode)}</code>`
        : "—";
      return `<tr>
        <td><code title="${escapeAttr(r.id)}">${escapeText(r.id.slice(0, 14))}…</code></td>
        <td>${statusBadge(r.status)}</td>
        <td><code>${escapeText(r.size)}</code></td>
        <td><code>${escapeText(r.quality)}</code></td>
        <td>${chain}</td>
        <td class="num">${total}</td>
        <td>${errCell}</td>
        <td class="num meta-time">${escapeText(created)}</td>
      </tr>`;
    })
    .join("");

  const webProviderRows = d.webProviders.length
    ? d.webProviders
        .map(
          p => `<tr>
        <td><code>${escapeText(p.providerName)}</code></td>
        <td class="num">${p.succeeded}</td>
        <td class="num">${fmtMs(p.avgImageMs)}</td>
      </tr>`,
        )
        .join("")
    : `<tr><td colspan="3" class="meta">(窗口内无成功出图)</td></tr>`;

  const webProviderFailureRows = renderProviderFailures(d.webProviderFailures);

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
.topmeta a.tabjump { background: #A4453B; color: #FBF6EA; }
.topmeta a.tabjump:hover { background: #8C3A33; }
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
.chain { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; line-height: 1.5; }
.round-tag { display: inline-block; padding: 0 5px; border-radius: 3px; font-size: 10px; font-weight: 600; background: #3A5A40; color: #FBF6EA; margin-bottom: 3px; }
.rewrite-state { display: flex; flex-direction: column; gap: 2px; min-width: 128px; max-width: 220px; }
.rewrite-state strong { font-size: 11px; font-weight: 600; }
.rewrite-state span { color: #7A6F5E; font-size: 10px; line-height: 1.35; overflow-wrap: anywhere; }
.rewrite-state.is-fail strong { color: #6B2620; }
.rewrite-state.is-ok strong { color: #2A4A2E; }
.error-cell { display: flex; flex-direction: column; gap: 3px; min-width: 160px; max-width: 280px; }
.error-cell span { color: #6B2620; font-size: 10px; line-height: 1.35; overflow-wrap: anywhere; }
.att { position: relative; display: inline-flex; align-items: center; gap: 3px; padding: 1px 4px; border-radius: 3px; font-size: 11px; white-space: nowrap; cursor: default; }
.att-ok { background: rgba(58,90,64,0.12); color: #2A4A2E; }
.att-fail { background: rgba(164,69,59,0.10); color: #6B2620; cursor: help; }
.att-code { font-size: 10px; opacity: 0.85; font-family: "SF Mono", Menlo, "Courier New", monospace; }
.att-sep { color: #B5A88E; font-size: 10px; }
.att code { background: transparent; padding: 0; }
/* Hover-floating detail panel for failed attempts. CSS-only — no JS.
   .att-fail::after is a transparent bridge so hover survives the gap between
   badge and tip. Otherwise moving the mouse down loses hover and tip closes. */
.att-fail::after { content: ""; position: absolute; top: 100%; left: 0; right: 0; height: 6px; }
.att-fail .tip { display: none; position: absolute; top: calc(100% + 4px); left: 0; z-index: 1000; background: #FBF6EA; color: #2A2620; border: 1px solid rgba(70,45,20,0.15); border-radius: 4px; padding: 10px 12px; min-width: 320px; max-width: 560px; max-height: 380px; overflow: auto; box-shadow: 0 6px 22px rgba(70,45,20,0.20), 0 0 0 1px rgba(255,255,255,0.6) inset; white-space: normal; text-align: left; }
.att-fail:hover .tip { display: block; }
.tip-header { font-weight: 600; font-size: 12px; color: #6B2620; margin-bottom: 4px; }
.tip-meta { font-size: 11px; color: #7A6F5E; margin-bottom: 6px; font-family: "SF Mono", Menlo, "Courier New", monospace; }
.tip-message { font-size: 11px; color: #2A2620; margin: 6px 0; padding: 4px 6px; background: rgba(164,69,59,0.06); border-radius: 3px; word-break: break-word; }
.tip-body { font-size: 11px; font-family: "SF Mono", Menlo, "Courier New", monospace; background: rgba(70,45,20,0.04); padding: 6px 8px; border-radius: 3px; margin: 4px 0 0; white-space: pre-wrap; word-break: break-word; max-height: 280px; overflow: auto; }
/* table cells must allow the tip to escape — overflow:visible is default but
   spell it out so future themes don't accidentally clip with overflow:hidden */
table td { overflow: visible; }
</style>
</head>
<body>
<h1>inkast · 任务统计</h1>
<div class="topmeta">
  生成时间 ${now} · 60 秒自动刷新 · 时间窗口:
  ${winLink("24h", "最近 24 小时")} ${winLink("7d", "最近 7 天")} ${winLink("30d", "最近 30 天")} ${winLink("all", "全部")}
  · <a href="/?tab=plugin-gallery" target="_blank" rel="noreferrer" class="tabjump">插件作品图 →</a>
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
    <h2>渠道失败 Top(按 attempt 维度)</h2>
    <div class="meta">从每条任务的 attempts 链聚合,包含 retry 内 + provider 切换。鼠标悬停错误码可看 raw 字符串</div>
    <table>
      <thead><tr><th>渠道(provider)</th><th>总 attempt</th><th>失败 attempt(率)</th><th>错误码分布</th></tr></thead>
      <tbody>${providerFailureRows}</tbody>
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
      <thead><tr><th>任务 ID</th><th>Plugin</th><th>状态</th><th>渠道</th><th>重写</th><th>LLM</th><th>生图</th><th>总耗时</th><th>回调次数</th><th>错误</th><th>回调主机</th><th>创建时间</th></tr></thead>
      <tbody>${recentRows || '<tr><td colspan="12" class="meta">(暂无任务)</td></tr>'}</tbody>
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
    <h2>渠道分布(出图来源)</h2>
    <div class="meta">仅统计 succeeded;平均耗时含排队 + LLM + 生图(Web UI 通道未拆段点)</div>
    <table>
      <thead><tr><th>渠道(provider)</th><th>成功出图数</th><th>平均耗时</th></tr></thead>
      <tbody>${webProviderRows}</tbody>
    </table>
  </div>

  <div class="card wide">
    <h2>渠道失败 Top(按 attempt 维度)</h2>
    <div class="meta">从每条 job 的 attempts 链聚合,包含 retry 内 + provider 切换</div>
    <table>
      <thead><tr><th>渠道(provider)</th><th>总 attempt</th><th>失败 attempt(率)</th><th>错误码分布</th></tr></thead>
      <tbody>${webProviderFailureRows}</tbody>
    </table>
  </div>

  <div class="card wide">
    <h2>最近 24 小时趋势(按小时)</h2>
    <div class="meta">绿 = 成功 · 红 = 失败 · 悬停柱状条看详情</div>
    <div class="barline">${webBarlineHtml || '<div class="meta">(无数据)</div>'}</div>
  </div>

  <div class="card wide">
    <h2>最近任务(最近 50 条,不限时间窗口)</h2>
    <table>
      <thead><tr><th>任务 ID</th><th>状态</th><th>尺寸</th><th>质量</th><th>渠道</th><th>总耗时</th><th>错误</th><th>创建时间</th></tr></thead>
      <tbody>${webRecentRows || '<tr><td colspan="8" class="meta">(暂无任务)</td></tr>'}</tbody>
    </table>
  </div>

</div>
</body>
</html>`;
}

const REWRITE_TRIGGER_CODES = new Set([
  "provider_blocked_content",
  "upstream_safety_rejected",
  "moderation",
]);

/**
 * Keep rewrite diagnostics visible in the table instead of hiding the only
 * explanation in a mouse-only title attribute. Old rows predate explicit
 * policy persistence, so a terminal r0 content rejection is labelled as an
 * inference rather than claimed as stored fact.
 */
function renderRewriteSummary(r: RecentTaskRow): string {
  const message = r.errorMsg ?? "";
  const rewriteFailure = message.match(/rewrite r(\d+) LLM failed:\s*([\s\S]*?)(?:\s+— and earlier rounds|$)/i);
  if (rewriteFailure) {
    return rewriteState(
      `r${rewriteFailure[1]} 改写失败`,
      shorten(rewriteFailure[2] ?? "LLM 未返回可用改写", 120),
      "is-fail",
    );
  }

  if (message.includes("rewrite disabled by pipeline_policy.max_round=0")) {
    return rewriteState("未启用", "调用方设置 max_round=0", "is-fail");
  }

  if (r.status === "running") {
    if ((r.currentRound ?? 0) > 0) {
      return rewriteState(`正在 r${r.currentRound}`, `已完成 ${r.rewrittenPrompts.length} 次改写`);
    }
    return rewriteState("等待触发", "正在执行原提示词 r0");
  }

  if (r.rewrittenPrompts.length > 0) {
    if (r.status === "succeeded" || r.status === "callback_lost") {
      return rewriteState(
        `r${r.successRound ?? r.rewrittenPrompts.length} 生效`,
        `共完成 ${r.rewrittenPrompts.length} 次改写`,
        "is-ok",
      );
    }
    return rewriteState(
      `已改写 ${r.rewrittenPrompts.length} 轮`,
      "改写后渠道仍未成功",
      "is-fail",
    );
  }

  if (r.status === "succeeded" || r.status === "callback_lost") {
    return rewriteState("无需改写", "原提示词 r0 已成功", "is-ok");
  }

  if (r.status === "queued") {
    return rewriteState("尚未开始", "等待 worker 执行");
  }

  const hasRewriteTrigger = r.attempts.some(
    attempt =>
      !attempt.ok &&
      attempt.errorCode != null &&
      REWRITE_TRIGGER_CODES.has(attempt.errorCode),
  );
  if (hasRewriteTrigger) {
    return rewriteState(
      "未进入改写",
      "内容拒绝后在 r0 终止；旧记录推断为策略上限 0",
      "is-fail",
    );
  }

  return rewriteState("未触发", "渠道错误不属于可改写的内容拒绝");
}

function rewriteState(title: string, detail: string, tone = ""): string {
  return `<div class="rewrite-state ${tone}"><strong>${escapeText(title)}</strong><span>${escapeText(detail)}</span></div>`;
}

function shorten(value: string, max: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact;
}

/**
 * Render the hover-floating detail panel for a failed attempt. Three blocks:
 *   - header line:provider · errorCode · durationMs
 *   - meta line:HTTP status + request id(when present)
 *   - body block:errorMessage + pretty-printed raw upstream JSON
 *
 * Designed to be inert when attempts succeed (renderAttemptChain skips this
 * branch). HTML must be fully escaped — body content comes from the upstream.
 */
function renderAttemptTip(a: GenerateImageAttempt): string {
  const code = a.errorCode ?? "unknown";
  const headerParts = [`${a.providerName}`, `✗ ${code}`, `${a.durationMs}ms`];
  const metaBits: string[] = [];
  if (a.httpStatus != null) metaBits.push(`HTTP ${a.httpStatus}`);
  if (a.requestId) metaBits.push(`req-id: ${a.requestId}`);
  const metaLine = metaBits.length ? metaBits.join(" · ") : "";

  let bodyBlock = "";
  if (a.errorBody !== undefined && a.errorBody !== null) {
    let pretty: string;
    if (typeof a.errorBody === "string") {
      pretty = a.errorBody;
    } else {
      try {
        pretty = JSON.stringify(a.errorBody, null, 2);
      } catch {
        pretty = String(a.errorBody);
      }
    }
    bodyBlock = `<pre class="tip-body">${escapeText(pretty)}</pre>`;
  }

  return `<span class="tip">
    <div class="tip-header">${escapeText(headerParts.join(" · "))}</div>
    ${metaLine ? `<div class="tip-meta">${escapeText(metaLine)}</div>` : ""}
    ${a.errorMessage ? `<div class="tip-message">${escapeText(a.errorMessage)}</div>` : ""}
    ${bodyBlock}
  </span>`;
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
