# Provider 优先级:拖拽到顶 = 默认,没有"设为默认"按钮

一句话:provider 池没有"设为默认"radio,**顺序就是优先级**——拖到第一位就是默认;前端 `useEffectiveLlmBackend` hook 选第一个 enabled 的 LLM capability 作为"effective default"。

## 背景

旧设计每个 provider 行有一个"设为默认"radio,这造成两套独立但相关的状态:

- 排序(priority 数组)
- 默认(default_provider_id 字段)

要"用户拖到顶 = 自动成为默认"还要写双向同步逻辑,容易出 bug。

## 方案对比

| | A. priority + default 双状态 | B. 仅 priority(选中) |
| --- | --- | --- |
| 状态来源 | 2 个 | 1 个 |
| 默认 = top 的一致性 | 要写双向同步 | 自然一致 |
| UI | radio + drag | 只 drag |
| 直觉 | 中(两个独立操作) | 高("我把它拖到第一就是默认") |

## 最终选择

B,只 priority。"effective default" 是个**派生概念**而不是状态。

```ts
// 前端 useEffectiveLlmBackend.ts
const sorted = providers
  .map(p => ({ p, cap: p.capabilities.find(c => c.kind === "llm") }))
  .filter(x => x.cap && !x.cap.disabled)
  .sort((a, b) => a.cap.priority - b.cap.priority);
return sorted[0]?.p.id ?? BUILTIN_CLAUDE_CODE_ID;
```

排序由 dnd-kit `SortableContext` 驱动,handleDragEnd 把新顺序 POST 到 `/api/providers/reorder`,后端批量更新 priority = index+1。

## 配套 UI 表现

- provider 行第一项(priority 最低,数字最小)显示 "默认" 徽章
- 拖拽改顺序时,徽章实时跟着第一行走(乐观更新)
- 禁用 (Switch off) 的 provider 即使排第一也不算"default"——下一个 enabled 的递补

## 关联条目

- [provider-pool](../domains/provider-pool.md) — 池消费 priority
- [no-main-ui-backend-selector](./no-main-ui-backend-selector.md) — 主 UI 不重复 default 概念
- [claude-code-builtin-provider](./claude-code-builtin-provider.md) — ClaudeCode 也参与同样的排序
- [dnd-kit-drop-animation-jitter](../pitfalls/dnd-kit-drop-animation-jitter.md) — 实现里踩的坑
