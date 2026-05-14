# 字段编辑器(取代 hint 采纳循环)

把"散文 → AI 起草 → 只读 JSON 卡片"重写为"散文 → AI 预填 → 可编辑分组字段 → 生图"。**字段编辑器是核心交互,LLM 只是加速器** —— 不接 LLM 也能从零填字段直接生图,见 [llm-as-accelerator](../decisions/llm-as-accelerator-not-requirement.md)。

## 架构

```
PromptComposer (散文输入 + AI 预填按钮 + 直接生图按钮 + ReferencePicker)
        │
        │ aiFill → /api/draft-prompt {input, lang} → PromptDraft
        ▼
prompt state (App.tsx) ←─── aiSuggestedFields: Set<string>
        │                  (跟踪哪些字段是 AI 填的,用户改任一字段就移除标签)
        ▼
PromptFieldEditor (5 分组卡片 + 开放字段兜底 + 底部 JSON 折叠 + 生图按钮)
   ├── basic     : Type / Style                       (FieldPicker)
   ├── scene     : Subject / Background / Layout      (Textarea + FieldPicker)
   ├── mood      : Mood / Lighting / Camera           (FieldPicker)
   ├── colors    : ColorPaletteEditor                 (swatch + presets + native color picker)
   ├── text      : TextElementsEditor                 (子卡片增删,内部 4 个 FieldCombobox)
   └── others    : 开放字段兜底(LLM 返回的非已知键)
```

## 关键文件

| 文件 | 职责 |
| --- | --- |
| [apps/web/src/App.tsx](../../../apps/web/src/App.tsx) | `prompt` / `aiSuggestedFields` 状态;`aiFill` / `generate` / `generateRaw` 三条入口 |
| [apps/web/src/features/prompt/PromptFieldEditor.tsx](../../../apps/web/src/features/prompt/PromptFieldEditor.tsx) | 5 分组卡片渲染 + `normalizeStringField` 处理 object 主体 + JSON 折叠预览 |
| [apps/web/src/features/prompt/PromptComposer.tsx](../../../apps/web/src/features/prompt/PromptComposer.tsx) | 散文输入区 + AI 预填 / 直接生图 / 示例按钮 + ReferencePicker |
| [apps/web/src/features/prompt/FieldCombobox.tsx](../../../apps/web/src/features/prompt/FieldCombobox.tsx) | `FieldCombobox`(下拉式)+ `FieldPicker`(弹窗式)+ `FieldTextarea` + `FieldLabel` |
| [apps/web/src/features/prompt/ColorPaletteEditor.tsx](../../../apps/web/src/features/prompt/ColorPaletteEditor.tsx) | 色块编辑(原生 color picker overlay)+ 8 组预设套用 |
| [apps/web/src/features/prompt/TextElementsEditor.tsx](../../../apps/web/src/features/prompt/TextElementsEditor.tsx) | text_elements 数组增删 + 每项 4 个 combobox |
| [apps/web/src/components/option-picker.tsx](../../../apps/web/src/components/option-picker.tsx) | OptionPicker 弹窗(Dialog + Gallery + Upload + 网格 + 搜索 + 自由输入兜底) |
| [apps/web/src/components/combobox.tsx](../../../apps/web/src/components/combobox.tsx) | shadcn Popover + Command 的自由输入 combobox |

## 核心流程

### 三条入口

1. **散文 → AI 预填 → 改字段 → 生图** —— `aiFill()` 调 `/api/draft-prompt`,把返回的 `PromptDraft.prompt` 灌进 state,记录所有非空字段为 AI 推荐;用户改字段时该字段移出 aiSuggestedFields,UI 取消"AI 推荐" Badge
2. **直接编辑字段 → 生图** —— 不点 AI 预填,直接在字段卡片填空,生图按钮在编辑器底部(`canGenerate` 要求 type / style / subject 三个 string 字段都非空)
3. **散文 → 直接生图** —— "直接生图"按钮绕过 prompt engine,构造 placeholder `{type:"raw", style:"", subject:trimmed}` + `rawPrompt: trimmed`,见 [generate-now-raw-prompt](../decisions/generate-now-raw-prompt-path.md)

### object 字段兜底

LLM 偶尔把 `subject` 字段返回成 object(`{description, pose, ...}` 等子结构),`normalizeStringField()` 优先取 `description / text / value / content / name` 子字段,否则 JSON.stringify 兜底,避免渲染出 `[object Object]`,见 [pitfalls/object-shaped-subject-stringify](../pitfalls/object-shaped-subject-stringify.md)。

## 关联条目

- [llm-as-accelerator-not-requirement](../decisions/llm-as-accelerator-not-requirement.md) — 设计哲学的"为什么"
- [defer-conversational-redesign](../decisions/defer-conversational-redesign.md) — 字段编辑器覆盖了 70% LLM 价值,重对话化推迟优先级降低
- [sprite-previews](sprite-previews.md) — FieldPicker 弹窗里的真实预览图
- [field-dictionary](../shared/field-dictionary.md) — 选项词典 + 双语 + sprite 元数据
- [i18n](i18n.md) — 字段名 / 描述 / placeholder 都走 t.editor.*
