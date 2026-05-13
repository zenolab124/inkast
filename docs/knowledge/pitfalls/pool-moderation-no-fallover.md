# Provider 池:moderation 拒绝故意不切下家

**What**: 一个 provider 返回内容审查拒绝(`content_policy_violation` 或上游 message 含 moderation/safety 关键字),inkast **立即终止 pool walk**,抛 `ImageGenError("moderation_rejected")`——**不**继续尝试 priority 更低的 provider。

**Why**: 这**不是 bug,是故意的**。

如果 moderation 拒绝触发 fallover,那 inkast 就变成了"绕审查工具":
- 用户用一个 prompt 测某 prompt 是不是有问题
- 第一家拒了 → 自动跳到第二家
- 第二家拒了 → 自动跳到第三家
- 直到找到一家不审查的 → 成功生图

这违反所有 provider 的服务条款,也是 inkast **不能背的法律责任**。Provider 池是为了"网络/服务不稳定"的 fallover,不是为了"内容策略不一致"的 fallover。

**Action**:
- **driver 默认行为不变**——moderation 立即抛
- 如果用户**明确**想试别家,可以传 `bypassModeration: true`(API 已支持,UI 暂未暴露)
- 若 Phase 2 暴露 UI,**必须二次确认**:弹个对话框,文案明确"你想绕过内容审查吗?这可能违反 provider TOS"

## 错误分类源代码

`apps/api/src/drivers/image/openai-compatible.ts:classifyError`:

```ts
const isModeration =
  err.code === "content_policy_violation" ||
  err.type === "content_policy_violation" ||
  /content[_ ]policy|moderation|safety/i.test(message);
```

任意一条命中就归到 `moderation`,driver 抛 `ImageGenError("moderation_rejected")`,**不 continue**。

## 关联条目

- [provider-pool](../domains/provider-pool.md)
- [openai-sdk-images](../integrations/openai-sdk-images.md)
