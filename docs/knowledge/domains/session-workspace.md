# 本次工作区(右栏)

起草 Tab 三栏中的右栏。展示**本次会话**生成的图,**刷新即清空**——历史看 [作品] Tab。

## 架构

```
App.tsx
  state: sessionGenerationIds: string[]   ← 仅 React state,不持久化
         activeJobs: JobRecord[]          ← 来自 useJobs hook(2s polling)

  job 成功 onJobSucceeded(job):
    if (job.generationId)
      setSessionGenerationIds([job.generationId, ...prev])
    setGalleryKey(k => k + 1)   ← [作品] Tab 也刷新一次

  ▼ props
<SessionWorkspace sessionGenerationIds activeJobs onReuse />
    useEffect on sessionGenerationIds:
      listGenerations(100) → 过滤 + 按 ID 顺序排好
    setRecords(ordered)

    grid grid-cols-3 gap-2:
      [LoadingTile × activeJobs.length]  ← spinning placeholder
      [Tile × records.length]            ← 实际图(同尺寸)
```

## 关键文件

| 文件 | 职责 |
| --- | --- |
| [apps/web/src/features/workspace/SessionWorkspace.tsx](../../../apps/web/src/features/workspace/SessionWorkspace.tsx) | 主组件:header(标题 + count)+ grid + LoadingTile + Tile + EmptyState |
| [apps/web/src/App.tsx](../../../apps/web/src/App.tsx) | 维护 `sessionGenerationIds` state;`onJobSucceeded` 时 prepend |

## LoadingTile 设计

任务进行中**不要单独的过渡卡片**——直接进 grid 占位,跟实际图同 aspect-square。

```tsx
<article className="aspect-square rounded-md border border-primary/30 bg-primary/5">
  <Loader2 className="size-6 animate-spin text-primary" />
  <div className="absolute inset-x-0 bottom-0 ...">
    {job.status === "running" ? "生成中" : "等待中"} · {elapsed}s
  </div>
</article>
```

完成后这个 tile 会被实际图 tile 替换(因为 activeJobs 数组里移除了 job,records 里增加了对应的 generation)。

详见 [jobs-as-placeholder-tiles](../decisions/jobs-as-placeholder-tiles.md)。

## 为什么不复用 [作品] Tab

[作品] Tab 是**历史档案**——全部生成记录、可搜索、可筛选,适合 Power 浏览。
本次工作区是**当前心流**——只看刚做的几张,适合"再来一张/调字段重生/复用"的快速迭代。

如果合并:
- 在起草 Tab 看不到刚生的图(滚动到底部 Gallery 才能见)
- 改字段时丢失"我刚做了什么"的上下文
- 历史一多就把当前作品淹没

分离后:右栏只关心 ≤10 张当前作品,小尺寸 grid-cols-3 紧凑展示。

## 刷新行为

`sessionGenerationIds` 是纯 React state(不写 localStorage / sessionStorage)。刷新页面后:
- 起草 Tab 右栏变空(显示"这次生成的图会出现在这里")
- [作品] Tab 仍然显示所有历史
- 但 `useJobs` 启动时会 fetch in-flight jobs(后端还在跑的),所以 LoadingTile 可能复现

## 关联条目

- [architecture-overview](./architecture-overview.md) — 三栏主壳
- [gallery](./gallery.md) — [作品] Tab 历史
- [async-job-pipeline](./async-job-pipeline.md) — useJobs polling 和 job 数据来源
- [jobs-as-placeholder-tiles](../decisions/jobs-as-placeholder-tiles.md) — LoadingTile 设计决策
- [three-column-accordion-layout](../decisions/three-column-accordion-layout.md) — 主壳布局
