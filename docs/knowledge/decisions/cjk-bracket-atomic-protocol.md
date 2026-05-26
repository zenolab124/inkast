# Plugin prompt 协议切到 CJK「」原子格式,不留兼容

v2.30 把 plugin 通道的 prompt 协议从英文末尾分隔切到 CJK 角括号包裹:`「char」. Style and theme: 「style」`。character key + style 各成原子单位,旧格式直接弃用。

## 背景

旧协议 `SpiderMan. Style and theme: 中国水墨画` 靠"末尾或下一个 `.` 判 style 边界",style 文本里只要混入句号 / 换行就破。更糟的是 R1/R2/R3 system prompt 把 style 当"用户意图自由发挥"传给 LLM,实测 LLM 会翻译(中→英)、近义改写(水墨→水彩)、甚至省略,**rewritten_prompt 文本看起来合理但出图画风跑偏**,问题不可见。

## 方案对比

| | A: CJK「」原子包裹 | B: 加 escape + 兼容旧格式 | C: 内联 JSON `{"char":"X","style":"Y"}` |
| --- | --- | --- | --- |
| 切分鲁棒 | 全角引号在中文/英文输入里冲撞概率极低 | 复杂、解析路径多 | 最强,但要改调用方 |
| 调用方改动 | SnapUB 一次切换 | 双协议并存,SnapUB 不动 | SnapUB 必须重写 |
| LLM 友好度 | 显式分界符 + system prompt 红线"「」内原文保留" | 旧格式 LLM 不知道哪段是 style | JSON 在散文模型里反而难处理 |
| 维护成本 | 一个 regex | 两套解析 | 高 |

## 最终选择

**A**。直接换 `extractCharacterKey` regex 为 `^「([A-Za-z][A-Za-z0-9]*)」\.\s`、新增 `extractStyleText` 为 `Style and theme:\s*「([^」]+)」`,旧格式 task 自然 fallback 到 text-only rewrite(没 vision 参考图,能力降级但仍工作),SnapUB 端切完立即恢复 vision 能力。

**关键考量**:**项目仍测试期,留兼容反而是没用的尾巴**——用户明确否决"双协议并存"。沿用同一套 idempotent 模式给 4 个 R 的 system prompt 加"「」内文本必须原文出现,不翻译/不近义改写/不省略"红线,再叠 [style-as-fourth-anchor](style-as-fourth-anchor.md) 的 force-prepend 兜底。

## 副作用

- 切换那一刻 SnapUB 端旧请求会全部走 text-only fallback,vision 重写能力短暂掉档,代价可控(SnapUB 提前调度 + plugin_tasks 24h GC 自然消化)。
- `extractCharacterKey` 是 [rewrite-chain](../domains/rewrite-chain.md) 和 [post-review-edit](../domains/post-review-edit.md) 共用——改 regex 必须 grep 两个域同步,见 workflow [改 extractCharacterKey 同步 post-review-edit](#)(在 [post-review-edit](../domains/post-review-edit.md) 条目里说明)。

## 关联条目

- [style-as-fourth-anchor](style-as-fourth-anchor.md) — 协议升级配套的 style 强化
- [rewrite-chain](../domains/rewrite-chain.md) — 协议使用方
- [post-review-edit](../domains/post-review-edit.md) — 共用 `extractCharacterKey`
- [cjk-bracket-style-translation](../pitfalls/cjk-bracket-style-translation.md) — 协议升级前的具体 bug
