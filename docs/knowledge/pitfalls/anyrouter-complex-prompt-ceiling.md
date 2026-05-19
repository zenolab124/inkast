# anyrouter + image_generation 工具对"复杂 prompt × 参考图"的硬上限

## What

`POST /v1/responses` + `image_generation` 工具走 anyrouter 时,**成功率随 prompt 复杂度阶梯式下降**:

| Prompt 形态 | refs | 累计样本 | 成功率 |
| --- | --- | --- | --- |
| `Draw a simple red apple` | 1 | 13 | **100%** ✅ |
| `Draw mecha, refer style`(英文极简带参考) | 1 | 8 | **75%** |
| `画机甲战士,参考风格`(中文极简带参考) | 1 | 8 | **50%** |
| 复杂 EN prompt + EXACTLY ONCE guard | 0 | 8 | **37.5%** |
| 复杂 EN prompt + EXACTLY ONCE guard | 1 | 18+ | **0%** ❌ |
| 复杂 ZH(用户原 prompt,多元宇宙变体) | 1+ | 9+ | **0%** ❌ |
| 手工结构化 JSON prompt(`{"type":"trading card",...}`) | 1 | 8 | **0%** ❌ |

失败模式:`output_item.added → in_progress → generating` 之后就**永远卡住**,不发 partial_image 也不发 output_item.done。`upstreamErrors=[]` 全空——代理彻底沉默,7-10 分钟后流被 close。

## Why

不是渠道波动(simple prompt 13/13 = 100% 健康)。不是 driver 任何参数(15 个对照实验全部证伪——reasoning_effort / instructions / tool_choice / detail / partial_images / 不同 model / 不传 reasoning / 改 ref 数量,无一改善)。**是上游 `image_generation` 工具对"复合任务描述 + 视觉上下文"的处理能力本身就是 0**。

机制推测:
1. 复杂 prompt(含"保留 frame/logo/数值"+ 多约束 + 变体叙事)让模型进入"复合规划"reasoning 状态
2. `image_generation` 工具 OpenAI 官方锁死了**必须配 reasoning**(见 [image-gen-requires-reasoning](image-gen-requires-reasoning.md)),reasoning 阶段大量消耗 token
3. 工具内部 budget 不够输出 base64 result,卡 generating 永不出 partial
4. 代理 close 流时上游也沉默,无错误事件

**模型多调不是根因,是症状**:同一 prompt 偶尔 1 call 偶尔 6 calls,calls=1 也死。

`JSON.stringify(prompt)` 路径**反而比一句话命令式更糟**——序列化字符串在模型眼里是多字段叙事,触发更多 reasoning。

## Action

driver 层无解。能做的只有:

1. **降级 prompt**:让用户写极简英文命令式(`Draw [X], referring to the style of this image`)能拉到 75% 成功
2. **`/codewise refresh-docs` 不能解决——这是渠道能力上限**
3. **可选治标方案(没实现)**:driver 加 LLM prompt-rewrite,把用户复杂 prompt 改写为命令式。失去严格"保留外框"约束,得到 50-75% 成功率
4. **拒绝重试**:用相同输入 retry 没意义(同一卡点),retry 只对网络瞬时抖动有效

## 关联条目

- [pitfalls/image-gen-requires-reasoning](image-gen-requires-reasoning.md) — OpenAI 锁死 reasoning_effort=minimal
- [pitfalls/responses-tool-not-invoked](responses-tool-not-invoked.md) — 模型不调工具(另一个独立失败模式)
- [pitfalls/responses-stream-result-missing](responses-stream-result-missing.md) — 流结束没 result 的诊断角度
- [decisions/diagnostics-first-not-fix](../decisions/diagnostics-first-not-fix.md) — 无法 fix 渠道时优先做诊断的态度
