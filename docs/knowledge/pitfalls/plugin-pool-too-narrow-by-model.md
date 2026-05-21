# Plugin 通道 image pool 过窄(按 model 过滤掉一半)

Plugin 通道实际使用的 image provider pool 是全量 pool 的子集——按 plugin overlay 的 `imageDefaults` 过滤后,**8 个 image provider 通常只剩 3 个**。某些 provider 故障时 pool 整层失效。

## What

实测 plugin 通道日志:
```
[image] ▶ attempt 1/3: cpa (priority=1, mode=responses) → ...
       (1/3 表示 pool 实际只 3 个)
```

但 sqlite `provider_capabilities` 表里 image kind 有 8 个:
```
cpa     (responses) gpt-5.3-codex
any     (responses) gpt-5.3-codex
duck2   (images)    gpt-image-2
duck    (images)    gpt-image-2
🌿      (responses) gpt-5.3-codex
cpa-hub (images)    gpt-image-2
ciallo  (responses) gpt-5.3-codex
```

Plugin 通道只有 3 个进 pool,**其他 5 个被过滤掉**——意味着 cpa(假活流)+ ciallo(CF 切断)+ duck(漫威拒)三个都失败时,整 pool 失效,任务报 `image_provider_unavailable: exhausted all 3 providers`。

## Why

`listEnabledCapabilities("image")` 返回的 pool 跟 plugin overlay 配置交互后,**某些 model / mode / size 组合不匹配的 capability 会被跳过**——具体过滤逻辑分散在多处:

- `provider_capabilities.disabled = 1` → 不进 pool
- plugin overlay `imageDefaults.size = "auto"` + 某些 provider 不支持 → 被跳过
- model 类别错配(`gpt-image-2` 模型走 responses mode 等)→ 被跳过

具体过滤是**事实归纳**,不是文档化的规则。snapub plugin 配 `imageDefaults: { size: "auto", quality: "high", format: "png" }`,实测过滤后 pool 是 [cpa, ciallo, any](都是 gpt-5.3-codex + responses),duck/duck2/cpa-hub(gpt-image-2 + images)全被跳。

## Action

**1. 加新 provider 时,要测一次 plugin 通道实际是否进 pool**——只看 sqlite 不够,要 trigger 一次 plugin task 看 `attempt N/M` 的 M 是不是改变了
**2. 不要假设 pool 大小等于 capability 表行数**——尤其在 plugin 通道
**3. 出现 `image_provider_unavailable: exhausted all N providers` 报警时**,N 跟全量 capability 数对不上属正常,不要直接质疑过滤逻辑;先看 attempts 字段确认 N 个 provider 都 attempt 过
**4. 长期改造方向**(未做):pool walker 应该把"capability 不满足 plugin overlay 要求"显式 log 出来,而不是静默跳过——可观测性能让运维更快发现"我加了 N 个 provider 但只有 M 个真用上"

## 关联

- [[provider-pool]] — 全量 provider 池设计
- [[plugin-channel]] — Plugin 通道走 pool 的入口
- [[provider-capability-table-split]] — capability 表结构
- [[duck-moderation-probabilistic]] — duck 即使在 pool 也不可靠
- [[anyrouter-pseudo-stream-deep-failure]] — cpa/any 失败时,pool 备份不够全部完蛋
