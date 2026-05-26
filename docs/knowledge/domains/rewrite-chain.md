# Rewrite Chain(3 轮 LLM 改写降级)

Plugin 通道 round 0 出图失败后的兜底链。Round 0 的某个 attempt 返**内容审查类**错码(`provider_blocked_content` / `upstream_safety_rejected` / `moderation`)时,启动 1-3 轮 LLM 视觉重写,把含 IP 名称的 prompt 转成"纯视觉特征 + 锚定信息"再喂图模。

非 plugin 通道**不走**这条链(Web UI 失败直接报错,本地用户自己调 prompt)。

## 架构

```
round 0 (原 prompt + 全 image pool)
    ├─ 成功 → return
    ├─ 失败但全是 network/auth 错 → throw(rewrite 救不了)
    └─ 失败且有 trigger code → ▼

round 1  LLM 视觉重写(看 6 张参考图)
    ├─ 主体观察 → body_anchors / palette_anchors / character_archetype
    ├─ 改写 prompt(用户 style 意图为主,融入三锚定)
    ├─ inkast force-prepend 三锚定 block + HARD_CONSTRAINTS suffix
    └─ retry image pool → 成功 return successRound=1

round 2 / round 3(失败时)
    ├─ 不再传图给 LLM(纯文本变换,省 ~9k tokens × 2 轮)
    ├─ 输入:用户原 prompt + r1.analysis 三锚定 + 上一轮 rewritten 文本
    ├─ r2: 措辞重组 / 降一档具体度;archetype 可弱化措辞
    ├─ r3: 服装/姿态最宽化 + archetype 允许泛化
    ├─ inkast force-prepend + HARD_CONSTRAINTS
    └─ retry image pool
```

## 关键文件

| 文件 | 职责 |
|---|---|
| `apps/api/src/domain/generate/with-rewrite.ts` | 整体编排:round 0 → trigger gate → r1-r3 循环,统一错误信息 |
| `apps/api/src/domain/rewrite-prompt/index.ts` | 单轮 LLM 改写:system prompt + schema + userPrompt 拼接 + force-prepend + HARD_CONSTRAINTS append |

## 四锚定(`IdentityAnchors` + style,v2.30 起)

| 字段 | 含义 | R2/R3 处理 |
|---|---|---|
| `body_anchors` | 身体特征(肤色/发色/瞳色/体型/性别/年龄段)。**不含**头罩/面具 — 变体常摘下 | 100% 继承 |
| `palette_anchors` | 招牌配色家族(2-4 个核心颜色组合,**不绑衣物**)。**style-aware**:user style 限色时(黑白/灰阶/单色/剪影/深褐/单色调)必须输出该范围内色值,不是角色原始彩色 | 100% 继承 |
| `character_archetype` | 抽象角色 type(15-40 字,允许轻微 form 提示,禁配件名) | 继承可弱化(r2)/ 允许泛化(r3) |
| **`style`(v2.30 新增锚定)** | **user style 文本**,在 `Style and theme: 「<style>」` CJK 括号内原文提取;**禁翻译/禁近义改写/禁省略**,4 个 R system prompt 都加红线 | 100% 继承 |

force-prepend 段格式(R2/R3 自动加在 LLM rewritten 输出前):
```
【画风(必须严格遵循)】「<style>」

【identity 锚定(必须严格遵循)】
身体特征: <body_anchors>
招牌配色: <palette_anchors>
角色原型: <character_archetype>
```

两段都是 idempotent guard 模式:LLM 听话已含字面 atom `「<style>」` / 三锚定段 → 不重复 prepend。

## 两段独立的 HARD_CONSTRAINTS

| 常量 | idempotent guard | 内容 |
|---|---|---|
| `HARD_CONSTRAINT_NO_TEXT` | `/无任?何?\s*文字\|不出现?\s*文字\|no\s*text/i` | 禁文字符号 + 禁 UI 界面元素 |
| `HARD_CONSTRAINT_SAFE_ZONE` | `/safe\s*zone\|下\s*1\s*\/\s*4\|底部.*留白/i` | 主体核心部位必须在画面上 3/4,留下 1/4 给 SnapUB UI 叠加 |

两段各自独立 idempotent — LLM 自己写禁文字句子不会顺带跳过 safe zone。

## Trigger gate

```ts
REWRITE_TRIGGER_CODES = { provider_blocked_content, upstream_safety_rejected, moderation };
```

round 0 失败后,如果 cumulativeAttempts 里**没有任何**错码属于 trigger codes(全是 network / auth / unknown),不进 rewrite — rewrite 救不了网络故障。

## Pipeline Policy 影响

调用方可在 submit 时配 `pipeline_policy.max_round`(0-3)截短 chain,或 `skip_original=true` 直接进 r1(适合明知拒图的 IP)。详见 [[pipeline-policy]]。

## 调用方 prompt 协议(v2.30 起 CJK「」原子格式)

```
「SpiderMan」. Style and theme: 「中国水墨画」
```

- `extractCharacterKey`: `^「([A-Za-z][A-Za-z0-9]*)」\.\s` — character key(PascalCase)
- `extractStyleText`: `Style and theme:\s*「([^」]+)」` — style 文本
- 旧格式(`SpiderMan. Style and theme: 中国水墨画`)直接弃用,不再 fallback,见 [cjk-bracket-atomic-protocol](../decisions/cjk-bracket-atomic-protocol.md)
- 切换 regex 必须同步 [post-review-edit](post-review-edit.md)(共用 `extractCharacterKey`)

## 关联条目

- [plugin-channel](plugin-channel.md) — 上层异步任务流程
- [post-review-edit](post-review-edit.md) — successRound∈{2,3} 后的二次审查 + 共用 `extractCharacterKey`
- [three-anchor-design](../decisions/three-anchor-design.md) — body/palette/archetype 三锚定的演进
- [style-as-fourth-anchor](../decisions/style-as-fourth-anchor.md) — v2.30 加 style 作为第四锚定
- [cjk-bracket-atomic-protocol](../decisions/cjk-bracket-atomic-protocol.md) — prompt 协议升级
- [palette-anchors-llm-not-keyword](../decisions/palette-anchors-llm-not-keyword.md) — palette 用 LLM 语义判断
- [pipeline-policy](../decisions/pipeline-policy.md) — 调用方控制重写行为
- [llm-fallover](../shared/llm-fallover.md) — LLM 调用本身的 multi-backend fallover
- [llm-half-refusal-empty-rewritten](../pitfalls/llm-half-refusal-empty-rewritten.md) — LLM 输出半残的处理
- [character-key-prefix-required](../pitfalls/character-key-prefix-required.md) — 触发 vision 分支需要 PascalCase 前缀
- [cjk-bracket-style-translation](../pitfalls/cjk-bracket-style-translation.md) — 协议升级前 style 漂移的 bug
- [grayscale-style-palette-conflict](../pitfalls/grayscale-style-palette-conflict.md) — palette 跟 grayscale style 冲突
