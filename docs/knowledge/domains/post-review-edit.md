# Post-Review-Edit(r2/r3 后的视觉审查 + edit 二次修正)

Plugin 通道在 `successRound ∈ {2, 3}` 且 plugin 配 `post_review_edit=true` 时,**对生成图跑一次 LLM 视觉审查**;判定不像参考图就用 image edit 通道修。Round 0 / round 1 直接成功的图**不走**这步(假设原 prompt 出的图最贴合原型)。

实测当前数据(v2.21-v2.25 期间 19 个 r2/r3 task):**0/19 真正触发 edit**——10/19 LLM 判 `looks_like_target=true` 直接放过,3/19 判 false 但 edit pool 全挂(详见 [[review-llm-too-lenient]] 和 [[edit-mode-images-pool-shrunk]])。结论:链路**逻辑正确**,但 review 标准 + edit pool 健康是产品级问题。

## 架构

```
plugin-async/index.ts:
    successRound ∈ {2,3} && plugin.imageEditOnLowSimilarity ?
       ↓ 是
    reviewAndMaybeEdit(originalPromptText, currentImageB64, ...)
       ↓
    ┌─────────────────────────────────────────────────────┐
    │ Step A: extractCharacterKey(promptText)             │
    │   无 PascalCase 前缀 → return skip("no key")        │
    │                                                      │
    │ Step B: buildCharacterImageUrls + HEAD 校验          │
    │   全部 404 → return skip("no reference URLs")       │
    │                                                      │
    │ Step C: review LLM (completeJsonWithFallover)       │
    │   输入: 参考图 URLs + 当前生成图 (data URL)          │
    │   输出: {looks_like_target: bool,                   │
    │          edit_instructions: string}                  │
    │   LLM 调用挂 → catch → fallback 原图,looksLikeTarget=null │
    │                                                      │
    │ Step D: if looks_like_target=true                   │
    │   editApplied=false,return 原图(post_review_edited=0) │
    │                                                      │
    │ Step E: looks_like_target=false                     │
    │   edit_instructions 空 → 跳过 edit,return 原图       │
    │   非空 → generateImage(promptText=instructions,     │
    │                       requireMode='images',          │
    │                       referenceImages=[currentImage]) │
    │     成功 → editApplied=true,return 新图              │
    │     失败 → fallback 原图,editApplied=false         │
    └─────────────────────────────────────────────────────┘
```

## 关键文件

| 文件 | 职责 |
|---|---|
| `apps/api/src/domain/post-review-edit/index.ts` | reviewAndMaybeEdit 完整实现 + REVIEW_SYSTEM_PROMPT |
| `apps/api/src/domain/rewrite-prompt/index.ts` | 共用 `extractCharacterKey` + `buildCharacterImageUrls`(reference URL 构造) |

## 输出契约(`PostReviewEditOutcome`)

| 字段 | 含义 | 写入 `plugin_tasks.post_review_edited` |
|---|---|---|
| `editApplied=true` | LLM 判 false + edit 出图成功 | `1` |
| `editApplied=false` + `looksLikeTarget=true` | LLM 判 ok 不需要 edit | `0` |
| `editApplied=false` + `looksLikeTarget=false` + fallbackReason 非空 | edit 失败或指令空,回退原图 | `0` |
| review 整体 skip(无 character key / 无参考图) | 不调 LLM | `null` |

## 关联条目

- [plugin-channel](plugin-channel.md) — 上层 worker 流程
- [rewrite-chain](rewrite-chain.md) — successRound 来源
- [llm-fallover](../shared/llm-fallover.md) — review LLM 调用走 fallover
- [review-llm-too-lenient](../pitfalls/review-llm-too-lenient.md) — review 标准过宽
- [edit-mode-images-pool-shrunk](../pitfalls/edit-mode-images-pool-shrunk.md) — edit 强制 requireMode=images 让 pool 缩水
- [character-key-prefix-required](../pitfalls/character-key-prefix-required.md) — PascalCase 前缀决定能否触发 review
- [pipeline-policy](../decisions/pipeline-policy.md) — post_review_edit 字段
