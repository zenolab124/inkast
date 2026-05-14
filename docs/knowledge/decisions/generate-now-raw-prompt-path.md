# "直接生图"绕过 prompt engine

散文输入区除了"AI 预填字段"按钮,还有"直接生图"——把散文文本**原样喂给图像模型**,完全跳过 prompt engine(LLM 起草)+ 字段编辑器。

## 背景

有些用户(或重生 sprite 大图等场景)不希望 prompt engine 把散文重新结构化——比如:
- "我自己写的提示词已经很精细,别 LLM 重组成 JSON"
- "我要的就是这段话原文,模型自己理解"
- sprite sheet 生图,提示词上千字带网格规则,绝对不能被 LLM 简化

## 方案对比

| | 必走 LLM 起草 | 两条路径(选定) |
| --- | --- | --- |
| 控制感 | 弱 | 强(可选) |
| 起草成本 | 多 30-60s LLM 调用 | 跳过 |
| Prompt 污染风险 | LLM 可能把"用户写好的精细提示"重组成 JSON | 无 |
| 主流路径 | 1 条(可能让用户绕弯) | 2 条并存 |

## 最终选择

两条路径并存。

实现:
- `GenerateImageRequest.rawPrompt?: string` —— 新字段
- 后端 `domain/generate`:`promptText = input.rawPrompt ?? JSON.stringify(input.prompt)`
- 前端"直接生图"构造 placeholder `prompt = { type: "raw", style: "", subject: trimmedProse }` + `rawPrompt: trimmedProse`(prompt 仍要传,因为 jobs.prompt_snapshot 列必填,用于 Gallery 历史展示)
- 任务记录上 `is_raw=true`,Gallery 卡片可识别"原文生成"

## 副作用

- promptSnapshot 里 type 是 "raw",历史卡片 Type 标签会显示 "raw" / "Raw" 不太美观;后续可改成"原文 / Raw prose"或加图标区分
- 用户写的散文是英文还是中文,直接影响图像模型理解;**不再走 lang 注入**(因为 prompt engine 被绕过)。模型自己理解中文 vs 英文有差别——通常英文提示更准

## 关联条目

- [field-editor](../domains/field-editor.md) — 三条入口之一
- [prompt-engine](../domains/prompt-engine.md) — 被绕开的对象
- [async-job-pipeline](../domains/async-job-pipeline.md) — rawPrompt 通过 jobs 提交
