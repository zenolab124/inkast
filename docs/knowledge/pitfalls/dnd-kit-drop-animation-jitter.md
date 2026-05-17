# dnd-kit:`handleDragEnd` 里 setState 两次中断 drop 动画

## 现象

provider 配置弹窗用 dnd-kit 拖拽排序。拖一个 provider 到新位置松手——drop 动画(~200ms 弹性回落到新位)**走到一半被打断**,卡片"跳一下"到新位置,UI 闪烁。

## 根因

`handleDragEnd` 里原来的写法:

```ts
async function handleDragEnd(event) {
  // 第一次 setState:乐观更新
  setProviders(reorderedOptimistic);
  
  // POST /api/providers/reorder
  const response = await fetch(...);
  
  // 第二次 setState:用 server 响应"覆盖"
  setProviders(response.data);
}
```

server RTT 50-100ms,drop 动画 ~200ms。**server 响应到达时 drop 动画还在跑**,第二次 `setProviders` 触发 React 重渲染,dnd-kit 的 `transform` CSS 被重置,卡片"瞬移"——visible jitter。

## 规避

**不要在 dragEnd 里做两次 setState**。乐观更新就要"完成更新",server 响应只做"验证":

```ts
async function handleDragEnd(event) {
  // 乐观更新:本地直接计算新 priority(index+1),
  // 跟 server 响应预期一致
  const optimistic = (providers ?? []).map(p => {
    if (!reorderedIds.has(p.id)) return p;
    return {
      ...p,
      capabilities: p.capabilities.map(c =>
        c.kind === tab ? { ...c, priority: newPriorityFor.get(p.id)! } : c,
      ),
    };
  });
  setProviders(optimistic);

  try {
    await reorderProviders(tab, reordered.map(p => p.id));
    // 成功:不再 setState。server 返回的内容跟 optimistic 一致
  } catch (err) {
    setError((err as Error).message);
    // 失败:refetch 滚回
    refresh();
  }
}
```

要点:

1. server 响应**只用作"是否成功"**的信号——成功 no-op,失败才滚回
2. 失败滚回用 `refresh()`(refetch authoritative state),不是用 setState 局部 patch——因为本地状态可能跟 server 偏离更多

## 关联条目

- [drag-to-top-default](../decisions/drag-to-top-default.md) — 排序设计
- [provider-pool](../domains/provider-pool.md) — 排序消费方
- [dnd-kit-row-pattern](../workflows/dnd-kit-row-pattern.md) — 完整 row 拖拽模式
