# 字段编辑器(取代 hint 采纳循环)

把"散文 → AI 起草 → 只读 JSON 卡片"重写为"散文 → AI 预填 → 可编辑分组字段 → 生图"。**字段编辑器是核心交互,LLM 只是加速器** —— 不接 LLM 也能从零填字段直接生图,见 [llm-as-accelerator](../decisions/llm-as-accelerator-not-requirement.md)。

## 架构

字段编辑器是中栏,有两种渲染态(由 App.tsx 的 `lockMode` 决定):

```
lockMode === null  ⇒  collapsed 态:窄列 stub(5 个分组数字编号 + 提示展开)
lockMode !== null  ⇒  expanded 态:5 分组卡片完整展开(中栏占主区)
                       两种 lockMode 触发:
                         "ai-filled" — 点 "AI 扩充" 后(M3)
                         "m2"        — 点 "跳过文本" 或 ⌘E 后(M2)
```

```
PromptComposer (左栏)
    locked=false: textarea + [直接生图(M1)] [AI 扩充(M3)] + "跳过文本(M2)"小链接
    locked=true:  只读 prose 文本 + Lock bar + 解锁链接
        │
        │ M3: onExpand → /api/draft-prompt {input, lang} → PromptDraft
        │     setPrompt(resp.prompt) + setLockMode("ai-filled")
        │ M2: onSkipText → setPrompt(EMPTY) + setLockMode("m2")
        ▼
App.tsx state: { prompt, aiSuggestedFields, lockMode }
        │
        │ expanded = lockMode !== null
        │ collapsed prop = !expanded
        ▼
PromptFieldEditor (中栏 · 中央列)
   collapsed=true  → CollapsedStub:5 个 stub + 底部 tip("点 AI 扩充展开")
   collapsed=false → 完整 5 分组卡片:
     ├── 基本 + 氛围 (同行 grid lg:[2fr_3fr],宽屏并列)
     ├── 画面 (Subject/Background/Layout · grid md:cols-3)
     ├── 色彩 (ColorPaletteEditor)
     ├── 文字 (TextElementsEditor)
     └── 其他 (开放字段兜底,LLM 返回的非已知键)
     底部:JSON 折叠 + 生图按钮(canGenerate 要求 type/style/subject 非空)
```

## 关键文件

| 文件 | 职责 |
| --- | --- |
| [apps/web/src/App.tsx](../../../apps/web/src/App.tsx) | `prompt` / `aiSuggestedFields` / **`lockMode`** 状态;`aiFill` / `generate` / `generateRaw` / `skipText` / `unlock` 入口;⌘E 全局快捷键 |
| [apps/web/src/features/prompt/PromptFieldEditor.tsx](../../../apps/web/src/features/prompt/PromptFieldEditor.tsx) | 5 分组卡片渲染 + **`collapsed` prop**(窄态 stub)+ `normalizeStringField` 处理 object 主体 + JSON 折叠预览 |
| [apps/web/src/features/prompt/PromptComposer.tsx](../../../apps/web/src/features/prompt/PromptComposer.tsx) | 散文输入(unlocked / locked 两态) + AI 扩充 / 直接生图 / 跳过文本 + 解锁链接 + ReferencePicker |
| [apps/web/src/features/prompt/FieldCombobox.tsx](../../../apps/web/src/features/prompt/FieldCombobox.tsx) | `FieldCombobox`(下拉式)+ `FieldPicker`(弹窗式)+ `FieldTextarea` + `FieldLabel` |
| [apps/web/src/features/prompt/ColorPaletteEditor.tsx](../../../apps/web/src/features/prompt/ColorPaletteEditor.tsx) | 色块编辑(原生 color picker overlay)+ 8 组预设套用 |
| [apps/web/src/features/prompt/TextElementsEditor.tsx](../../../apps/web/src/features/prompt/TextElementsEditor.tsx) | text_elements 数组增删 + 每项 4 个 combobox |
| [apps/web/src/components/option-picker.tsx](../../../apps/web/src/components/option-picker.tsx) | OptionPicker 弹窗(Dialog + Gallery + Upload + 网格 + 搜索 + 自由输入兜底) |
| [apps/web/src/components/combobox.tsx](../../../apps/web/src/components/combobox.tsx) | shadcn Popover + Command 的自由输入 combobox |

## 核心流程

### 三模式入口(M1 / M2 / M3)

详见 [three-modes-progressive-disclosure](../decisions/three-modes-progressive-disclosure.md)。

1. **M3 散文 → AI 扩充 → 改字段 → 生图**(主流程) —— `aiFill()` 调 `/api/draft-prompt`,把返回的 `PromptDraft.prompt` 灌进 state,**setLockMode("ai-filled") 触发手风琴展开**,记录所有非空字段为 AI 推荐;用户改字段时该字段移出 aiSuggestedFields,UI 取消"AI 推荐" Badge
2. **M2 跳过文本 → 直接编辑字段 → 生图** —— 初始态点底部"跳过文本"或按 ⌘E,`skipText()` 清空 prompt + setLockMode("m2") 触发手风琴展开,字段全空等用户填(`canGenerate` 要求 type/style/subject 非空)
3. **M1 散文 → 直接生图** —— "直接生图"按钮绕过 prompt engine,构造 placeholder `{type:"raw", style:"", subject:trimmed}` + `rawPrompt: trimmed`。**不触发手风琴**——left-wide 布局保留,保留"轻盈起草"轮回。见 [generate-now-raw-prompt](../decisions/generate-now-raw-prompt-path.md)

### 解锁回到起草

`unlock()` 把 `lockMode` 设回 `null` → 手风琴翻回 left-wide → 中栏字段编辑器折叠回 stub。**注意:解锁=回到起草,字段不可见**(字段 state 保留但 UI 不渲染)。如果用户要保留对字段的编辑,应该保持锁定态。

### object 字段兜底

LLM 偶尔把 `subject` 字段返回成 object(`{description, pose, ...}` 等子结构),`normalizeStringField()` 优先取 `description / text / value / content / name` 子字段,否则 JSON.stringify 兜底,避免渲染出 `[object Object]`,见 [pitfalls/object-shaped-subject-stringify](../pitfalls/object-shaped-subject-stringify.md)。

## 关联条目

- [architecture-overview](./architecture-overview.md) — 主壳三栏 + Tab + 手风琴
- [llm-as-accelerator-not-requirement](../decisions/llm-as-accelerator-not-requirement.md) — 设计哲学的"为什么"
- [three-modes-progressive-disclosure](../decisions/three-modes-progressive-disclosure.md) — M1/M2/M3
- [three-column-accordion-layout](../decisions/three-column-accordion-layout.md) — 手风琴布局
- [m2-entry-textless-only](../decisions/m2-entry-textless-only.md) — M2 入口只在初始态
- [defer-conversational-redesign](../decisions/defer-conversational-redesign.md) — 字段编辑器覆盖了 70% LLM 价值,重对话化推迟优先级降低
- [sprite-previews](sprite-previews.md) — FieldPicker 弹窗里的真实预览图
- [field-dictionary](../shared/field-dictionary.md) — 选项词典 + 双语 + sprite 元数据
- [i18n](i18n.md) — 字段名 / 描述 / placeholder 都走 t.editor.*
