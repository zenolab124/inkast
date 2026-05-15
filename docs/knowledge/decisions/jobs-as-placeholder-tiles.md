# 进行中任务作为占位 tile,不要独立卡片

任务进行中**不显示独立的过渡卡片**——直接在 SessionWorkspace grid 里占一个 tile,中间转圈 Loading,完成后被实际图替换。删除了 `ActiveJobs.tsx` 组件。

## 背景

V1 的实现方式:

- `SessionWorkspace` 顶部用 `<ActiveJobs jobs={activeJobs} />` 渲染独立卡片
- 卡片样式:横向 `<Card>`,左 spinner + 中 prompt 截断 + 右 elapsed
- 完成后卡片消失,下方 grid 新增一张图

用户反馈:**这个过渡态多余**。当前作品区是 grid,任务进行中应该直接占一个 grid 位置,而不是先在上方显示一个横向卡片然后突然挪到下方。

## 方案对比

| | 独立 ActiveJobs 卡片(原) | **占位 LoadingTile(选)** |
| --- | --- | --- |
| 视觉一致性 | 横向卡 + 下方方块——两种形态 | 始终方块 grid,只是内容不同 |
| 完成动效 | 上方卡片消失 + 下方多一张 | 同位置替换内容(自然) |
| 多任务并行 | 多张卡片堆叠挤压主内容 | 多个方块进 grid,自动布局 |
| 信息密度 | 卡片宽 + 信息多(prompt 全文) | 方块小 + 信息浓缩(状态 + 计时) |

## 最终选择

`SessionWorkspace` grid 同时渲染:

```tsx
<div className="grid grid-cols-3 gap-2">
  {activeJobs.map(job => <LoadingTile key={`job-${job.id}`} job={job} />)}
  {records.map(record => <Tile key={record.id} record={record} onReuse={onReuse} />)}
</div>
```

LoadingTile 的样式:

```tsx
<article className="aspect-square border-primary/30 bg-primary/5">
  <Loader2 className="size-6 animate-spin text-primary" />
  <div className="absolute inset-x-0 bottom-0 bg-card/80 backdrop-blur-sm px-2 py-1">
    {job.status === "running" ? "生成中" : "等待中"} · {elapsed}s
  </div>
</article>
```

完成后:
- useJobs polling 把 job 从 activeJobs 移除
- onJobSucceeded(job) → 把 job.generationId push 到 sessionGenerationIds
- SessionWorkspace re-render:LoadingTile 消失 + records 多一项 + 实际图 Tile 出现
- **视觉上是同一个 grid 位置内容替换**(LoadingTile 和 Tile 都 aspect-square,占同样 grid cell)

## 副作用

1. **`ActiveJobs.tsx` 删了** —— 无人引用,死代码清掉。如果将来需要"全屏任务监控视图",在新位置重写
2. **任务信息密度低** —— LoadingTile 只能放 "状态 · elapsed" 一行,塞不下完整 prompt。如需看 prompt,加 title 属性 hover 显示(已加)
3. **不显示后端失败的详细 attempt 链** —— 失败时 onJobFailed 弹 Banner 显示 attempts 详情,LoadingTile 完成时就消失。可接受

## 关联条目

- [session-workspace](../domains/session-workspace.md) — 主消费方
- [async-job-pipeline](../domains/async-job-pipeline.md) — useJobs hook
- [three-column-accordion-layout](./three-column-accordion-layout.md) — 三栏主壳
