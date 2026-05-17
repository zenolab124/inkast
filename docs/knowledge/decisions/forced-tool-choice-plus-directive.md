# Responses mode 双保险:`tool_choice` 强制 + prompt 显式 directive

一句话:让通用聊天模型(gpt-5.3-codex 等)调 `image_generation` 工具,光靠 `tool_choice` 的 hint 不够——同时在 prompt 前缀加 `"Use the image_generation tool to..."` 文本指令,双层冗余防止模型当文字应答。

## 背景

[image-mode-coexistence](./image-mode-coexistence.md) 跑通后第一个失败现象:`response.output` 数组返回**空**——模型没调工具。错误是我们自己抛的 `model did not invoke image_generation tool (output types: <empty>)`。

调查:我们传给上游的 prompt 是 `JSON.stringify(structuredPrompt)`,模型看到 `{"type":"poster","style":"..."}`——它把这当成"用户递了个 spec 让我用文字讨论",不调工具直接回 plain text。

## 方案对比

| | 单独 `tool_choice: "auto"` | 单独 prompt directive | **双保险**(选中) |
| --- | --- | --- | --- |
| 协议层硬约束 | 无 | 无 | tool_choice 强制 |
| 文本层引导 | 无 | 有 | 有 |
| 兼容代理不严格的情况 | 翻车 | 翻车 | 总有一层抗住 |

## 最终选择

**两个改动同时上**:

1. `tool_choice` 从 `"auto"` 改成 `{ type: "image_generation" }`(SDK 类型支持)
2. prompt 文本前缀加一行 directive:
   ```
   Use the image_generation tool to create an image based on the following spec. Target size: 1024x1024. Target quality: high.

   {…JSON spec…}
   ```

具体实现在 `apps/api/src/drivers/image/openai-responses.ts` 的 `wrapPromptForImageGen()`。

## 为什么两层都要

- OpenAI 官方端点严格遵守 `tool_choice` 强制——单 tool_choice 够了
- 但 anyrouter 这类代理在转发请求时**可能把 tool_choice 改回 auto** 或忽略——单 tool_choice 翻车
- 反过来,某些早期版本的代理不识别 `{type:"image_generation"}` 这种对象形式 tool_choice,直接报错——这时纯 prompt 引导能扛住
- 所以两层都要,**互补**不冗余

## 边界

- prompt directive 用**英文**写,因为 OpenAI 模型对英文 system-style 指令最稳定
- size/quality 也由 `wrapPromptForImageGen` 一起拼进去(详见 [ratio-wire-encoding](./ratio-wire-encoding.md))
- 模型仍可能拒绝(内容审查),这种情况会得到 `response.failed` 或 `response.incomplete` 事件,driver 抛 `response ended with status="..."`

## 关联条目

- [responses-mode-raw-fetch-sse](./responses-mode-raw-fetch-sse.md) — 上层 driver 架构
- [image-mode-coexistence](./image-mode-coexistence.md) — 模式分发
- [responses-tool-not-invoked](../pitfalls/responses-tool-not-invoked.md) — 失败现象
- [ratio-wire-encoding](./ratio-wire-encoding.md) — directive 里的 size/ratio 部分
