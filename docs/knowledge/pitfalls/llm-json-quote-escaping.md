# LLM 输出 JSON 字符串内未转义双引号

**What**: 不开 `outputFormat: json_schema` 时,LLM 在 system prompt 严格要求"只输出 JSON、字符串内转义"的情况下,**仍有 ~20% 概率**输出形如:

```json
{"field":"layout","suggestion":"现在是 3×2 网格;如果想要更"图鉴"感可以改..."}
                                                  ^^^^^^^^^^^
                                                  字符串里嵌入了未转义的英文双引号
```

`JSON.parse` 报 `Expected ',' or '}' after property value`,error position 大约在双引号附近。

**Why**: 中文写作里"图鉴"这种**强调用语**容易被 LLM 自然地用英文双引号包起来——它学了大量中文语料,看到强调点习惯加 `"..."`。即使 system prompt 说"字符串内禁止未转义双引号",模型依然按写作直觉走。

**Action**:
- **首选**:用 SDK `outputFormat: { type: "json_schema", schema }`,强制 schema 校验。模型在 schema 不通过时会被 SDK 自动重试,最终成功率 100%。代价是延迟 13s → 27-45s(多轮校验)。见 [structured-output-json-schema](../decisions/structured-output-json-schema.md)
- **兜底**:`parseTolerantJson()`(`drivers/llm/claude-code.ts`)还在,处理:
  - 剥 markdown fence ` ```json ... ``` `
  - 找 outer-most `{ ... }`(LLM 偶尔在 JSON 前后加散文)
  - 但**没法**修复字符串内未转义引号

## 验证

`drivers/llm/claude-code.ts` 的 `parseTolerantJson` 在失败时往 stderr 打 `[llm] full raw:` 全文,可以看清模型输出了什么。

## 关联条目

- [structured-output-json-schema](../decisions/structured-output-json-schema.md) — 解决方案
- [prompt-engine](../domains/prompt-engine.md) — 调用方
- [claude-agent-sdk](../integrations/claude-agent-sdk.md)
