# 生图喂 prompt:JSON 字符串而非散文

## 背景

LLM 起草完结构化 prompt 后,要喂给生图模型(gpt-image-2 via OpenAI 兼容)。两种喂法:

- **A**:展开 JSON 为自然语言("一张电影感的照片,主体是 ...")
- **B**:`JSON.stringify(prompt)` 直接喂,让模型按字段处理

## 方案对比

|  | A: 展开为散文 | B: JSON 字符串 |
| --- | --- | --- |
| 模型理解准度 | 散文可能丢字段(模型自由发挥) | 字段化更准,不会漏 |
| prompt 长度 | 通常 ~200 字 | 通常 1-2KB |
| 一致性 | 难复用(每次散文略不同) | 100% 可复用(JSON 直接拷) |
| 上游兼容 | 任何生图模型都吃 | gpt-image-2 等接受,旧 DALL-E 2 可能差 |
| 失败模式 | 字段丢失,无报错 | prompt 偏长可能慢 / 触发更严格安全检查 |

## 最终选择

**B**:JSON 字符串直接喂。这是 imagegen 方法论的核心论点——`reference/decomposition.md` 主张"JSON 优于散文"。

> "GPT Image 2 按字段处理,散文里'好看的光线'远不如 `"lighting": "soft daylight from the left, warm tungsten fill from overhead"`。"

## 实现位置

`apps/api/src/domain/generate/index.ts`:

```ts
const promptText = JSON.stringify(input.prompt);

const outcome = await drive({ promptText, size, quality, ... });
```

一行 `JSON.stringify`,没有任何"展开"逻辑。

## 副作用

- prompt 偏长(1-2KB),部分 provider 处理时间稍长
- 用户最初看 prompt 时可能误以为"模型只收 JSON,白搭这么多字段"——实际模型能解
- 跟 gpt-image-canvas 的"散文 prompt"路线**故意不同**,这是 inkast 的差异化身份

## 反对意见(未来可能动)

如果发现某些 provider 明确不接 JSON 字符串(触发非常严格的安全检查),可以在 driver 层加一个 "json → prose 展开器" 作 fallback。Phase 1 不做。

## 关联条目

- [prompt-engine](../domains/prompt-engine.md) — JSON 的产出
- [image-generation](../domains/image-generation.md) — JSON 在哪喂出去
- [openai-sdk-over-fetch](./openai-sdk-over-fetch.md) — 这是和 gpt-image-canvas 故意保留的差异
