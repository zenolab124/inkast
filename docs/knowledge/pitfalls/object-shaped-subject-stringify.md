# LLM 返回 object 形态 subject 渲染成 `[object Object]`

**What**: 字段编辑器(PromptFieldEditor)显示 `subject` 字段时,有时显示字面量字符串 `"[object Object]"`,而不是描述文本。Gallery 详情弹窗里也一样。

**Why**: `packages/shared/src/api.ts` 里 `ImagePrompt.subject` 类型签名是 `string`,但实际 LLM 偶尔返回 object 子结构,比如:

```json
{
  "subject": {
    "description": "Asian woman in her mid-20s",
    "pose": "sitting by a cafe window",
    "expression": "contemplative",
    "clothing": "cream-colored knit sweater"
  }
}
```

前端代码 `String(value.subject ?? "")` 把 object 转字符串得到 `"[object Object]"`。

系统 prompt 在 `apps/api/src/domain/prompt-engine/system-prompt.ts` 明确说"复杂主体拆成子字段对象 `{ description, pose, expression, clothing, accessory, age_gender, ethnicity }`"—— 这是**故意的**,因为 prompt engineering 上 object-shaped subject 表达力更强。但 UI 显示时需要把 object 拍平。

**Action**: `PromptFieldEditor` 加 `normalizeStringField(val)` helper,优先取常见 textual 子字段:

```ts
function normalizeStringField(val: unknown): string {
  if (val == null) return "";
  if (typeof val === "string") return val;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  if (typeof val === "object") {
    const obj = val as Record<string, unknown>;
    for (const k of ["description", "text", "value", "content", "name"]) {
      if (typeof obj[k] === "string") return obj[k] as string;
    }
    try { return JSON.stringify(val); } catch { return ""; }
  }
  return "";
}
```

适用所有 string-typed 字段:type / style / subject / background / layout / lighting / mood / camera。

**副作用**: 编辑器里用户看到 `description` 子字段(主体描述),其他子字段(pose / clothing / accessory)被忽略。用户改字段写回 prompt 时,**整个 object 被替换为字符串**,丢失子字段结构。这是接受的代价——拍平后用户控制完整,JSON 描述退化为单字符串,模型仍能理解(只是表达力略降)。

## 关联条目

- [prompt-engine](../domains/prompt-engine.md) — 主体允许 object 结构的"为什么"
- [field-editor](../domains/field-editor.md) — `normalizeStringField` 实现位置
- [structured-output-json-schema](../decisions/structured-output-json-schema.md) — 强制 JSON 输出的决策
