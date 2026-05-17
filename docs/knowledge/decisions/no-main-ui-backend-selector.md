# 主 UI 不放 LLM backend 选择器,改成"via X"小标签

一句话:PromptComposer 不放 LLM provider 下拉/单选,只显示一个低调的"via ClaudeCode"小标签——点击直接打开配置弹窗。低频操作不该占主 UI 注意力。

## 背景

旧设计 LLM 配置有两个表达面:

- 主 UI 一个下拉框"backend: ClaudeCode / openai-compatible"
- 配置弹窗一个 provider 列表

这造成:
- 同一意图两个地方都能改,行为可能不一致
- "切换 backend" 是低频操作(用户配好一次就稳定),却占据 composer 顶部黄金位置
- 跟"拖拽决定 default"(详见 [drag-to-top-default](./drag-to-top-default.md))语义冲突

## 方案对比

| | A. 主 UI 下拉框 | B. 主 UI 标签 + 弹窗(选中) |
| --- | --- | --- |
| 位置 | composer 顶部 | composer 顶部一行小字 |
| 视觉密度 | 占一格 | 占半行 |
| 操作路径 | 直接换 | 点开弹窗 |
| 配置一致性 | 两个面同步 | 单一面 |

## 最终选择

B。"via X"标签内容:

```
backendStatus={
  <button onClick={() => setConfigOpen(true)}>
    via <span className="text-foreground/70">{backendDisplayName(...)}</span>
  </button>
}
```

`backendDisplayName` 接 effective default provider id + provider 列表 + 内置名,返回展示文本。点击 = `setConfigOpen(true)` 直接弹窗。

## 副作用

- 用户首次接触 inkast 时不知道"我可以换 LLM" → 用文档 / 弹窗内的提示弥补
- 弹窗里的"drag-to-top = default"是唯一的"切换"路径 → 一致性更高

## 关联条目

- [drag-to-top-default](./drag-to-top-default.md) — 唯一切换路径
- [claude-code-builtin-provider](./claude-code-builtin-provider.md) — 内置 provider 默认出现在 via 标签里
- [llm-as-accelerator-not-requirement](./llm-as-accelerator-not-requirement.md) — 整体哲学:LLM 是加速器,不该占主 UI
- [session-workspace](../domains/session-workspace.md) — composer 顶部的位置
