# LLM 半残:合法 JSON 但 rewritten 字段空

## What

Rewrite r1 阶段 LLM 返回**合法 JSON**(driver 不报 `invalid_json`),`analysis` 字段完整(per_image / body_anchors / palette_anchors 都有),**但 `rewritten` 字段是空字符串**:

```json
{"analysis": {"per_image": [...], "body_anchors": "成年男性...", ...}, "rewritten": ""}
```

实测同一时段 3 个 CaptainMarvel task 短时间内全 fail,日志显示 `rewrite r1 LLM failed: rewrite LLM returned empty 'rewritten' field. raw={...}`,数据库里 `rewritten_prompt = null`。

## Why

LLM(gpt-5.5 等)的"**半截 refusal**":没有完全拒(完全拒会返 plain "我不能帮助..."触发 `invalid_json`),但**对最敏感字段(rewritten——它是要喂图模的)选择性留空**。属于 stochastic safety 行为,同 prompt 重试有概率出全。

**v2.25 之前的 bug**:`completeJsonWithFallover` helper 看到"driver 成功返回 JSON"就 return,**完全没机会 fallover** —— rewritten 字段空的检查在 `rewrite-prompt/index.ts:572` callsite 层,helper 退出后才抛 `LlmDriverError("invalid_json")`,这个 error 直接冒泡到 with-rewrite.ts catch → task fail。

## Action

**v2.25 修法**(2026-05-25):helper 加 `postValidate?: (data) => string | null` hook,driver 成功返回后调用一次,返回非 null 错误字符串则**构造 invalid_json error 走标准 retry-once + fallover**。详见 [[llm-fallover]]。

rewrite-prompt callsite 改成:
```ts
await completeJsonWithFallover(opts, `rewrite r${round}`,
  data => data.rewritten?.trim() ? null : "empty 'rewritten' field"
);
```

修后行为:
1. 半残 → 同 backend retry-once(stochastic seed 换一种)
2. 仍半残 → 跳下个 LLM backend
3. 所有 candidates 都半残 → error_msg 含 `postValidate rejected: empty 'rewritten' field`(明确诊断,不再误导成"LLM 挂了")

**全部 candidates 都半残时怎么办**:说明 prompt 触发了**普遍** safety(不是单 backend stochastic),应该考虑:
- r1 system prompt 太"求图模识别 IP"——软化措辞(已经做过几次,v2.18+ 持续优化)
- user prompt 本身敏感——这是产品策略问题,inkast 无能为力

## 关联

- [llm-fallover](../shared/llm-fallover.md) — postValidate hook 的实现
- [rewrite-chain](../domains/rewrite-chain.md) — 出问题的链路
- [llm-json-quote-escaping](llm-json-quote-escaping.md) — 完全 invalid_json 是另一类(不是半残)
- [error-code-translation-layer](error-code-translation-layer.md) — 半残 error_msg 在 callback 里的最终形态
