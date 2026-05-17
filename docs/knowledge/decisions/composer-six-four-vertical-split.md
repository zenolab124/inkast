# PromptComposer 6:4 垂直比例

一句话:左栏 PromptComposer 内部分两块——上"草稿/锁定输入区"(`flex-[3]`)与下"全局参数区"(`flex-[2]`),固定 6:4 视觉占比,textarea 用 `flex-1 min-h-0 resize-none` 撑满草稿块,禁用手动 resize。

## 背景

composer 列在三栏布局中宽度有限(默认 1.4fr),内部要塞:

- 文本草稿区(用户输入散文)
- "AI 扩充 / 直接生图 / 跳过文本" 三个动作按钮
- 全局参数(参考图 + 尺寸选择器 + 数量滑块)

如果草稿和参数自由伸缩,经常出现"textarea 撑得太大,参数被挤出视口" 或者反之。

## 最终选择

固定 6:4 垂直比例,通过 flex grow 比例稳定占比:

```
PromptComposer 容器  · h-full flex flex-col
  ├─ <Section flex-[3]>  ← 草稿区(textarea + 动作按钮)
  │    └─ textarea  · flex-1 min-h-0 resize-none
  └─ <Section flex-[2]>  ← ParamsBlock(参考图 + size + count)
```

要点:

- **textarea `min-h-0`** —— Flex 默认 min-height=auto,加 `min-h-0` 才允许 textarea 在 6:4 切割下被压缩到草稿块剩余空间
- **textarea `resize-none`** —— 用户手动 resize 会破坏 6:4 比例,直接禁用
- **flex-[3] / flex-[2]** —— 6:4 既不让任何一块吃掉对方,也保证两块都有最小可用空间

## 副作用

- 内容超过容器时 textarea 内部滚动条出现,而不是把参数区挤掉
- 参数行多时(参考图 + size 三轴 + count 滑块)整体占 40%,密度比之前的"参数挤到底部"舒服
- 草稿块底部三个动作按钮位置稳定,用户能形成肌肉记忆

## 关联条目

- [session-workspace](../domains/session-workspace.md) — composer 在三栏中的位置
- [three-column-accordion-layout](./three-column-accordion-layout.md) — 列宽手风琴(6:4 是列内的事,不影响列外)
- [dialog-grid-min-h-0](../pitfalls/dialog-grid-min-h-0.md) — `min-h-0` 同样的坑
