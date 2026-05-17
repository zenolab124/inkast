# 批量生图:前端 N 个独立 job 并发提交

一句话:用户拖滑块选"一次生 N 张图"(1-20),前端用 `Promise.allSettled` 并发 N 次 `submitJob`,**每张都是一个独立 job**——不是后端循环、不是 `n` 参数。

## 背景

需求:用户点一下生图按钮直接出 20 张。三条路:

| | A. 后端 `n` 参数 | B. 一个 job 内串/并 N 调用 | C. 前端 N 独立 job(选中) |
| --- | --- | --- | --- |
| HTTP 调用次数 | 1 | 1 | N |
| upstream 一次画几张 | n | 1 | 1 |
| 后端 schema 改动 | 无 | 大(一个 job → N generations 的关系) | 无 |
| 每张独立 fallback | ✗ | ✗ | ✓ |
| 每张独立失败 | ✗ | 一张错全错 | ✓ |
| 进度可观测 | 整体 | 整体 | 逐张 |

## 最终选择

C 方案。

**理由:**
- gpt-image-2 官方目前 `n` 只支持 1,代理多数跟进了同一限制;n 参数路死
- 一个 job 内循环 N 次破坏 jobs 表的 "一对一 generation" 设计——schema 改动太大,得不偿失
- N 个独立 job 复用现有 provider 池语义——每张独立走 priority、独立 fallback、独立 attempts trail。某一张被 moderation 拒绝不影响其他
- 前端心智:jobs 列表瞬间多 N 个 in-progress tile,跟现有 "占位 tile" 语义一致(见 [jobs-as-placeholder-tiles](./jobs-as-placeholder-tiles.md))

## 实现细节

`apps/web/src/App.tsx` 的 `generate()` 和 `generateRaw()`:

```ts
const n = Math.max(1, Math.min(20, count));
const results = await Promise.allSettled(
  Array.from({ length: n }, () => submitJob(req)),
);
const failed = results.filter(r => r.status === "rejected");
if (failed.length > 0) {
  setFlash({ kind: "error", text:
    failed.length === n ? firstErr.message
                        : `${failed.length}/${n} jobs failed to submit · ${firstErr.message}`,
  });
}
```

`Promise.allSettled` 而不是 `Promise.all`——即使一部分 `submitJob` 失败(比如 API 不可达),其他成功的仍然进入 jobs 列表。

UI:`PromptComposer` 内 `ParamsBlock` 在 SizeSelector 下加 `CountRow`(shadcn Slider 1-20),N>1 时显示"并发提交,池子按优先级 fallback"提示。

## 副作用 / 边界

- 滑块默认 1,Slider step=1,clamp 到 [1, 20] 双保险(防止外部代码塞非法值)
- N=20 时同时 20 个 HTTP 请求——provider 可能限流(429)。后端 provider 池的 fallback 仍会工作,但需要用户接受"有的成、有的不成"的现实
- 不引入并发上限——用户的目的就是"一次出 20 张",自己加节流违反产品意图

## 关联条目

- [jobs-as-placeholder-tiles](./jobs-as-placeholder-tiles.md) — N tile 进 grid 的视觉语义
- [async-job-pipeline](../domains/async-job-pipeline.md) — 单 job 流水线被并发 N 次
- [provider-pool](../domains/provider-pool.md) — 每张图独立走池
- [session-workspace](../domains/session-workspace.md) — 右栏 grid 同时接 N tile
