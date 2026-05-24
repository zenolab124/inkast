# Pipeline Policy(调用方控制 rewrite chain + post-review 行为)

Plugin submit 时可在 body 里传 `pipeline_policy` 对象,**让调用方按 prompt 类型动态决定流水线行为**——而不是让 plugin overlay 一刀切。在调用方语义里:"我知道这条 prompt 一定会被审查拒,跳过 round 0";或"我不需要 post-review,出图越快越好"。

## 背景

v2.21 之前 rewrite chain 行为是写死的:**必跑 round 0**,**默认 3 轮 rewrite**,**post-review 由 plugin overlay 静态配置**。多次实测发现两个不灵活点:

1. **某些 prompt 已知 round 0 会拒**(用户给的 prompt 含明显敏感词,SnapUB 那边手动绕开过)——浪费 round 0 等三十秒拒图
2. **某些场景不需要 post-review**(纯 style 变换、prompt 信息量大、调用方 self-sufficient)——浪费 LLM 调用

## 字段

```ts
interface PipelinePolicy {
  skipOriginal?: boolean;     // 跳过 round 0,直接 r1。默认 false
  maxRound?: 0 | 1 | 2 | 3;   // 最高重写轮数。默认 3
  postReviewEdit?: boolean;   // r2/r3 成功后是否跑 post-review。默认 false
}
```

`skipOriginal=true` 与 `maxRound=0` **不允许同时**——前者要求至少跑一轮 rewrite,后者禁止任何 rewrite,矛盾 → `driveWithRewriteFallback` 立刻抛 `no_providers`。

## 持久化

提交时 policy 存 **in-memory** Map(`taskPolicies: Map<taskId, PipelinePolicy>`),task 完成后 finally 块清掉。**不入库**——重启会丢,但 reaper 已经把所有 inflight task 标 failed,reschedule 重试时由调用方决定新 policy。

## 协议层(submit body)

```json
{
  "prompt": "...",
  "callback_url": "...",
  "callback_token": "...",
  "pipeline_policy": {
    "skip_original": false,
    "max_round": 3,
    "post_review_edit": true
  }
}
```

字段名是 snake_case(REST 习惯),内部转 camelCase。

## 决策点

**为什么不入 plugin overlay JSON**(plugin 静态配置):因为同一个 plugin 的不同 prompt 类型需要不同 policy(纯人物变体 vs 纯 style 变换 vs 已知拒图 prompt)。调用方比 plugin admin 更知道每条 prompt 的特性。

**为什么放 submit body 而不是 query string**:body 已经走 JSON,加字段成本低;query string 容易被 nginx / CF 中间层截断。

**为什么不入库**:policy 只对单次 task 生效,reaper 重启时 task 直接标 fail,policy 跟着失效是预期行为。入库反而带来"重启后 policy 持久化但 task 状态丢失"的奇怪状态。

## 关联条目

- [rewrite-chain](../domains/rewrite-chain.md) — `skipOriginal` / `maxRound` 影响哪些轮
- [post-review-edit](../domains/post-review-edit.md) — `postReviewEdit` 决定要不要跑
- [v2-async-callback-protocol](v2-async-callback-protocol.md) — submit body 协议来源
- [plugin-channel](../domains/plugin-channel.md) — 上层流程
