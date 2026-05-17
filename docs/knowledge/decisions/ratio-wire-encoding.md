# Size wire 的第三种形态:`ratio:W:H`

一句话:`GenerateImageRequest.size` 字符串字段在 `auto` 和 `WxH` 之外加第三种形态 `ratio:W:H`(如 `ratio:9:16`),意为"固定纵横比,具体像素由上游决定"。driver 在传给上游前翻译。

## 背景

用户场景:选了 9:16 比例但**不想锁死像素**——`1080x1920` 这种精确像素会被某些第三方代理拒绝(它们只接受 OpenAI 官方枚举值如 `1024x1536`),而完全 auto 又丢失了"竖图"这个意图。

需要一个能同时表达"比例锁定 + 像素自由"的 wire 值。

## 方案对比

| | A. wire 改对象 `{ratio, size}` | B. 在 prompt 文本里说 | C. 字符串前缀(选中) |
| --- | --- | --- | --- |
| 协议改动 | 大 | 零(但参数能力丢) | 中(扩展第三种字符串) |
| GenerationRecord 历史值 | 要迁移 | 要迁移 | 不动(都是字符串) |
| 后端识别 | 解构对象 | 不识别 | 一次 `startsWith("ratio:")` |
| 可读性 | 高 | 低 | 中 |

## 最终选择

C 字符串前缀。三种 wire 值:

| Wire | 含义 |
| --- | --- |
| `"auto"` | 完全自动:方向/比例/尺寸都让上游定 |
| `"1024x1536"` | 精确像素 |
| `"ratio:9:16"` | 固定比例,像素自动 |

driver 翻译规则:

- **images mode**(openai-compatible.ts)`ratio:*` → **不传 size 参数**给 SDK,把 `"Target aspect ratio: 9:16."` 拼到 prompt 末尾
- **responses mode**(openai-responses.ts)`ratio:*` → prompt directive 改成 `"Target aspect ratio: 9:16."`(代替原本的 `"Target size: 1024x1024."`)
- **edit 路径** 同 images mode 处理

## 副作用

- `parseSize()` 在 SizeSelector 里要 short-circuit 这种形态返回 null
- `lookupPreset()` 反向找像素预设时直接跳过 ratio:* 值
- shared 包加了 `SIZE_RATIO_PREFIX = "ratio:"` 常量 + `isRatioSize()` / `extractRatio()` / `makeRatioSize()` 三个 helper,主流程不要手写前缀拼接
- SizeSelector 在尺寸行第一个位置加"自动"芯片,选中 = 切到这种 wire 形态
- custom orientation:用户填了自定义比例(如 7:5)但没填具体像素时,wire 默认就是 `ratio:7:5`——顺手修了老版本"wire 继承上次 sizePreset"的 bug

## 边界

- 关键约定:`ratio:*` 是 **inkast 私有协议**,OpenAI 官方 API 不认这种字符串,driver 必须翻译再传给上游
- 与 [ratio-not-resolution-guarantee](./ratio-not-resolution-guarantee.md) 一致:inkast 整个产品语义都是"保证比例,不保证像素"

## 关联条目

- [ratio-not-resolution-guarantee](./ratio-not-resolution-guarantee.md) — 产品层的承诺
- [image-mode-coexistence](./image-mode-coexistence.md) — driver 调度点
- [shared-contracts](../shared/shared-contracts.md) — `SIZE_RATIO_PREFIX` 等导出
- [image-generation](../domains/image-generation.md) — 翻译逻辑
