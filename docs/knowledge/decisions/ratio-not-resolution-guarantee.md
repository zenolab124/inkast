# Inkast 保证比例,**不保证**像素分辨率

一句话:产品层承诺只到"按你选的纵横比出图",**不承诺像素分辨率会被上游严格遵守**——因为第三方 OpenAI 兼容代理对 size 字段的兼容程度各异,有的拒绝非官方枚举值,有的接受但实际生成尺寸偏移。

## 背景

SizeSelector 让用户能输任意像素(`1920x1080`、`1234x5678`),但实测:

- OpenAI 官方 gpt-image-2 **只**接受 `1024x1024 / 1024x1536 / 1536x1024 / auto`,其它直接 400
- 兼容代理(grok2api / aggregator)态度不一:有的接受任意值;有的"接受不报错"但实际生成默认尺寸;有的偏移到最近的官方枚举值
- `/v1/responses` + image_generation 工具**完全不接受 size 参数**,只能拼到提示词文本里(详见 [ratio-wire-encoding](./ratio-wire-encoding.md))

如果我们承诺"你选 1920x1080 就出 1920x1080",上游一翻脸用户体感就是 inkast bug。

## 最终选择

**只承诺比例,不承诺像素**。具体表现:

- SizeSelector 显示"设定的尺寸不一定跟出图的尺寸保持一致"提示文案(i18n `t.size.disclaimer`)
- 默认 ratio chip 用 ★ 标注"OpenAI 官方 standard tier"(1024² / 1536×1024 / 1024×1536),其它候选标 "math-legal but provider may reject"
- 鼓励用户选 `auto`(完全自动)或 `ratio:W:H`(锁比例,放像素)——这两种 wire 形态在第三方代理上稳定性最高
- GenerationRecord 里 `size` 字段存的是"用户当时选的 wire 值",不是"上游实际生成的尺寸"——后者拿不到稳定信号

## 对开发者的意味

- 调试"生图尺寸不对"投诉:第一反应不是 inkast bug,先看 provider 响应里实际什么 size
- 给前端做"按比例展示作品"时,**不能假定** `GenerationRecord.size` 解析出的 W×H 等于实际像素——以图片本身为准
- 新增 size 预设时,标 ★ 的必须是 OpenAI 官方枚举,其它给用户警示

## 关联条目

- [ratio-wire-encoding](./ratio-wire-encoding.md) — `ratio:*` wire 是这个承诺的协议落地
- [image-generation](../domains/image-generation.md) — driver 翻译 size 给上游
- [shared-contracts](../shared/shared-contracts.md) — `ImageSize = string` 故意宽松
