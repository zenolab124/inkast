# Prompt 精修循环(段 1 简化版)

用户输入散文 → 起草 → 看 hints → 点"采纳"把 suggestion 追加回输入框 → 重新起草 → hints 越来越少。imagegen 方法论里最核心的对话循环,**Phase 1 实现为"按钮 + 输入框追加"版本**(不是真对话式)。

## 架构

```
App.tsx
  ├─ input: string   ← 受控
  ├─ state: { draft, meta, adopted: Set<number> }
  ├─ appendNonce: number  ← 用于通知 Composer 自动滚回 textarea + focus
  │
  ├─ <PromptComposer value={input} onChange={setInput} appendNonce={...}>
  │    textarea + 示例 + "起草 prompt" / "重新起草"
  │
  ├─ <PromptDraftView draft={state.draft} adoptedHints={state.adopted} onAdoptHint>
  │    左:JsonTreeView(prompt)  · 顶部"生图"按钮
  │    右:hints 侧栏 — 每条 "采纳,追加到输入" 按钮 / 已采纳√删除线
  │
  └─ adoptHint(i) {
       setState(prev => { prev.adopted.add(i) }
       setInput(prevInput => appendSuggestion(prevInput, hint.field, hint.suggestion))
       setAppendNonce(n => n + 1)
     }
```

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `apps/web/src/App.tsx` | 顶层编排:input/state/pending/galleryKey/flash 等状态 |
| `apps/web/src/features/prompt/PromptComposer.tsx` | textarea + 示例按钮 + 起草/重新起草按钮 |
| `apps/web/src/features/prompt/PromptDraftView.tsx` | 双栏(JSON + hints) + 重新起草时旧 draft 半透明 + 生图按钮 |
| `apps/web/src/features/prompt/JsonTreeView.tsx` | 字段化渲染,色板特别处理 |
| `apps/web/src/features/prompt/api.ts` | POST /api/draft-prompt 客户端 |

## appendNonce 模式

输入框 textarea 由父组件控的 `value` 推。但**采纳 hint 时,父组件想要 textarea 自动聚焦 + 滚到视口 + 光标移到末尾**——这些是 imperative DOM 动作,不能仅靠 value 变化触发。

解决:加一个 `appendNonce: number` prop,采纳时 `setAppendNonce(n => n + 1)`。`PromptComposer` 的 `useEffect([appendNonce])` 监听这个 nonce,在副作用里执行 `focus + scrollIntoView + 光标移末尾`。

## 追加格式

`appendSuggestion(current, field, suggestion)`:

```
补充·<field>: <suggestion>
```

每条 hint 独立一行,模型下一轮能识别为分散的"refinement",不会被融合成一坨。

## 重新起草态

`PromptDraftView` 的 `pending` 时,整个区域 `opacity-60 + pointer-events-none`,中央叠一个 loading 浮卡。**旧 draft 保留可见**(用户能对比新旧)。

## Phase 1.5 演进方向

按 CLAUDE.md / decisions 路线,**整套交互未来重写为对话流**:

- 输入框升级为对话气泡流
- hints 显示为"推荐下一句话"快捷气泡
- 模型支持 multi-turn,**JSON diff/patch** 不是每轮重生成全部字段
- 流式输出降延迟

见 [defer-conversational-redesign](../decisions/defer-conversational-redesign.md)。

## 关联条目

- [prompt-engine](./prompt-engine.md) — 后端引擎
- [json-tree-view](../shared/json-tree-view.md) — JSON 渲染
- [defer-conversational-redesign](../decisions/defer-conversational-redesign.md) — 为什么不真对话化
- [shared-contracts](../shared/shared-contracts.md) — `PromptDraft` 契约
