# Image driver:images / responses 两 mode 共存

一句话:同一个图像 driver 池里允许两种调用形态共存——经典 `images.generate` 端点和 `/v1/responses` + `image_generation` 工具——通过 `provider_capabilities.extras.mode` 字段切换。

## 背景

新模型(gpt-5.3-codex 等"会聊天会画图的通用模型")**没有** `/v1/images/generations` 端点;它们只通过 `/v1/responses` API + 内置 `image_generation` 工具出图。同时,gpt-image-2 这类"专用画师"只走 `/v1/images/generations`。如果只支持一种,就必须二选一切断旧的或者拒绝新的。

## 方案对比

| | A. 替换 | B. 共存(选中) |
| --- | --- | --- |
| 改动面 | callProvider 整体改 | 在 driver dispatch 处加 mode 分支 |
| 旧 provider | 失效,需重配 | 不动 |
| 新增模型可达性 | ✓ | ✓ |
| UI 心智 | 简单 | 多一个 mode toggle |
| 失败可控 | 切了拿回不来 | 配错只影响一条 capability |

## 最终选择

**B 共存**——`provider_capabilities.extras.mode: "images" | "responses"`,driver 内按 mode 调度:

- `mode = "images"`(默认,缺省即此) → 现有 `client.images.generate / images.edit` 路径
- `mode = "responses"` → 新的 `/v1/responses` 路径(详见 [responses-mode-raw-fetch-sse](./responses-mode-raw-fetch-sse.md))

dispatch 点在 `drivers/image/openai-compatible.ts` 池循环里——一行 if 决定走哪个 helper,attempts 计数 / fallback / 错误分类完全共享。

## 副作用

- shared 包加了 `ImageGenerationMode` 类型 + `IMAGE_GENERATION_MODE_DEFAULT` 常量
- size 参数语义:responses mode 不接受 size 参数,会被 driver 翻译成提示词文本(详见 [ratio-wire-encoding](./ratio-wire-encoding.md))
- reference image:两个 mode 都支持,但 responses mode 用 `input_image` content part 传图,不走 `images.edit` 端点
- provider 配置弹窗"图像"能力下加了 `[images | responses]` toggle,默认 images

## 关联条目

- [responses-mode-raw-fetch-sse](./responses-mode-raw-fetch-sse.md) — responses mode 为何用裸 fetch
- [forced-tool-choice-plus-directive](./forced-tool-choice-plus-directive.md) — responses mode 如何强制工具调用
- [ratio-wire-encoding](./ratio-wire-encoding.md) — size 参数翻译
- [image-generation](../domains/image-generation.md) — driver 调度点
- [shared-contracts](../shared/shared-contracts.md) — `ImageGenerationMode` 类型
