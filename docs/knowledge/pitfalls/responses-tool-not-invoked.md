# Responses 模式:模型不调 image_generation 工具

## 现象

POST `/v1/responses` 带 `tools: [{type:"image_generation"}], tool_choice: "auto"`,流式调用顺利完成(没有 HTTP 错误),但 `response.output` 数组**空**。driver 抛我们自己的错:

```
responses mode: model did not invoke image_generation tool (output types: <empty>).
Prompt may need to explicitly ask for an image.
```

整个调用耗时正常(几十秒),完全没有 `image_generation_call.*` 系列事件。

## 根因

通用聊天模型(gpt-5.3-codex 等)在 `tool_choice: "auto"` 模式下**自行判断**要不要调工具。inkast 传给上游的 prompt 是 `JSON.stringify(structuredPrompt)`(`{"type":"poster","style":"...","subject":"..."}`)——模型把这当成"用户递了一个图像规格让我用文字讨论",直接回 plain text,跳过工具调用。

证据:`response.output` 里只有 message 类 item,内容形如"That sounds like a great poster idea! For 1024x1024..."

## 规避

两个改动**叠加**(单一不够):

1. **强制 tool_choice**:
   ```
   tool_choice: { type: "image_generation" }
   ```
   协议层硬约束,告诉模型"这次必须用这个工具"。SDK 类型已支持。

2. **prompt 显式 directive** 拼到 JSON 前面:
   ```
   Use the image_generation tool to create an image based on the following spec.
   Target size: 1024x1024. Target quality: high.

   {…JSON…}
   ```
   文本层引导,即使代理不严格遵守 tool_choice 也能扛住。

详见 [forced-tool-choice-plus-directive](../decisions/forced-tool-choice-plus-directive.md)。

## 为什么两层都要

- OpenAI 官方端点严格遵守 forced tool_choice
- 第三方代理可能把 tool_choice 改回 auto 或忽略——这时纯 prompt 引导能扛住
- 反之早期代理不识别 `{type:"image_generation"}` 对象形 tool_choice 会报错——这时纯 directive 也能让模型主动选工具
- 双保险互补

## 关联条目

- [forced-tool-choice-plus-directive](../decisions/forced-tool-choice-plus-directive.md) — 完整决策
- [responses-mode-raw-fetch-sse](../decisions/responses-mode-raw-fetch-sse.md) — 上层 driver 架构
- [prompt-as-json-not-prose](../decisions/prompt-as-json-not-prose.md) — 为什么传 JSON 不传散文(根因在这里)
