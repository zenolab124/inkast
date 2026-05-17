# LLM driver 旋钮:`model / effort / thinking / fallbackModel / maxTurns` 显式可调

一句话:从 Claude Agent SDK 的可配项中筛出 5 个关键旋钮,通过 `provider_capabilities.extras` JSON 字段暴露给前端配置——之前 inkast 直接吃 SDK 默认(Opus 4.7 + adaptive thinking + high effort),对"散文 → JSON 这种简单任务"性能严重过剩。

## 背景

Claude Agent SDK 默认配:`model: claude-opus-4-7`、`effort: high`、`thinking: { type: "adaptive" }`,适合复杂代码生成。inkast 的 LLM 任务**只**是把散文塞进 prompt-engine 让它输出 JSON——任务难度不高,Opus 4.7 + 高 effort + adaptive thinking 是炮打蚊子,**贵且慢**。

但完全降级到 Haiku 又怕 JSON 输出质量塌方。需要让用户能根据自己的 LLM provider 配额 / 偏好动态调。

## 方案对比

| | A. 写死默认 | B. 全部 SDK 选项 expose | C. 5 个关键旋钮(选中) |
| --- | --- | --- | --- |
| 配置面 | 0 | 20+ 个字段 | 5 个 |
| 用户决策成本 | 0 | 高(查 SDK 文档) | 中 |
| 性能可调 | 不可 | 可 | 可 |

## 最终选择

C,5 个旋钮:

| 旋钮 | 字段 | 取值 | 默认 |
| --- | --- | --- | --- |
| 模型 | `model` | `sonnet` / `opus` / `haiku` / full id(如 `claude-3-5-sonnet-20241022`) | sonnet |
| Effort | `effort` | `minimal` / `low` / `medium` / `high` / `xhigh` / `max` | medium |
| 思考模式 | `thinking` | `{ type: "adaptive" }` / `{ type: "disabled" }` / `{ type: "enabled", budgetTokens: number }` | adaptive |
| 回退模型 | `fallbackModel` | 同 `model` 字段格式 | (无) |
| 最大轮数 | `maxTurns` | number | (SDK 默认) |

存储:`provider_capabilities.extras` JSON(详见 [provider-capability-table-split](./provider-capability-table-split.md))。

```json
{
  "model": "sonnet",
  "effort": "low",
  "thinking": { "type": "disabled" },
  "maxTurns": 3
}
```

UI 在 LLM provider 编辑表单"高级"折叠区,默认折叠。

## 为什么是这 5 个

- `model` / `effort`:最直接的成本/质量旋钮,任何用户都该能改
- `thinking`:**散文→JSON 不需要思考链**,关掉这个直接省 70% token + 大幅降时延;Phase 1 的实际默认值改成 `disabled`
- `fallbackModel`:用户配 Opus 但限流时自动降到 Sonnet——比让整个请求挂掉好
- `maxTurns`:防止 prompt-engine 进入意外 multi-turn(`<system-reminder>` 引起的 SDK 内 retry 等),设硬上限

## 副作用

- 把 thinking 默认改 `disabled` 后,散文→JSON 任务时延从 ~7s 降到 ~2s
- `model: "sonnet"` 替代了之前的 Opus 默认——Sonnet 4.6 输出 JSON 质量足够 [structured-output-json-schema](./structured-output-json-schema.md) 的 schema 约束
- 用户配错(`effort: "ultra"` 等不存在的值)→ SDK 在调用时报错,driver 把错信息透传

## 关联条目

- [claude-agent-sdk](../integrations/claude-agent-sdk.md) — SDK 全部配项
- [structured-output-json-schema](./structured-output-json-schema.md) — JSON 输出由 schema 保证,不需要厚重 thinking
- [provider-capability-table-split](./provider-capability-table-split.md) — extras 字段存储
- [llm-sdk-cold-start](../pitfalls/llm-sdk-cold-start.md) — 关 thinking 也能缓解冷启动
