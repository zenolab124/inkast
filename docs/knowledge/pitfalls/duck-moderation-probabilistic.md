# duckcoding 漫威拒图是概率性,不是确定性

`duck` / `duck2`(`api.duckcoding.ai`,gpt-image-2)对漫威 IP 内容审查**有 false negative**——同 prompt 反复试,~20% 概率会漏审放行。

## What

snapub plugin 通道,同一个 prompt `Headpool. Style and theme: 极简主义,单色背景,纯净线条,留白构图`(1065 字节,完全相同):

| 任务 | 时间 | 走 duck 路径 | 结果 |
|---|---|---|---|
| ink-5a389ba0 | 00:03 | retry 2 次 | **HTTP 500 拒** |
| ink-e3c52d99 | 00:37 | retry 2 次 | **HTTP 500 拒** |
| ink-5d675f95 | 01:02 | retry 1 次后 | **✅ 155s 出图成功** |

duck 拒图错误体:
```
HTTP 500: 提交中含有违反平台政策的内容,请你立即停止或调整你的提交内容
(traceid: xxx)
```

**3 次 1 次过,但 prompt 完全没变**。再放宽看 plugin_tasks 历史,5 次漫威任务 1 次过 duck,**~20% 成功率**。

## Why

中文错误"提交中含有违反平台政策的内容"是 **duckcoding 平台自家审查话术**(不是 OpenAI 标准的 `moderation_blocked` JSON 响应)。意味着审查发生在**二道贩子代理层**,不是 OpenAI 原生。

代理层审查的实现可能有几种 false negative:
- 上游审查模型本身有抖动(同 prompt 不同时刻判断不同)
- duckcoding 在高负载时段降级跳过审查
- 审查 worker 内部 timeout 兜底成"放行"

duck 自己看不到内部,**无法精确归因**。但事实就是不是 100% 拒。

## Action

**1. 不要把 duck/duck2 当主力**——20% 成功率 + 一次 ~3 分钟出图 → 期望耗时 15 分钟才能拿到一张图,体感差。
**2. duck capability 配 `retryLimit = 3` 或更高**(per-capability retry,2026-05-22 上线)——多抽几次提高过审概率。原话:"既然是抽签型,多抽几次"。
**3. plugin pool 顺序保持 cpa → ciallo → ... → duck**,让健康 provider 先尝试。duck 是"实在没办法的兜底"。
**4. 不要加 `moderation: "low"` 参数**——已实测 duck 不读这个字段,加了反而把它推到另一条挂死的路径(见 [[moderation-low-ineffective-on-resellers]])。

## 关联

- [[per-capability-retry-budget]] — 为什么 duck 该单独配 retry=3
- [[moderation-low-ineffective-on-resellers]] — 别用这个参数想绕过 duck
- [[pool-moderation-no-fallover]] — 一般的内容审查拒不切走;但这条只针对**确定性**moderation_blocked,**概率性 HTTP 500 仍 retry**
- [[plugin-pool-too-narrow-by-model]] — duck 拒图时整 pool 被卡的根因
