# 三锚定设计:body + palette + character_archetype

Rewrite chain 中"哪些字段必须跨轮 100% 继承"的演变,**经历过两次反转**:从 v2.20 之前的"五字段(color/form/posture/...)"→ v2.21 的"两字段(body+palette)" → v2.22 的"三字段(body+palette+archetype)"。

## 背景

Marvel SNAP 变体本质是同一角色在不同情境下的呈现(战斗 / 咖啡厅 / 古代 / 赛博城)。哪些是 identity、哪些是变体维度,在多次实测里逐步标定。

## v2.20 之前(五字段、含 common_form / common_posture)

`color_anchors / common_form / common_posture` 全部跨轮继承,r3 阶段才做 style adaptation。

**实测病根**(MajorVictory 钢铁侠 task):
- LLM 把"圆形手持配件"(form 元素 = IP fingerprint)塞进 `color_anchors` 字段
- force-prepend 机制原样灌进每一轮 → r3 永远带 IP 标志,被审查拒
- "主题类 style"(史前 / 赛博朋克 / 中国水墨)下:r1 提原样 common_form → r3 才 adapt,中间轮割裂(现代战斗服 + 古代背景)

## v2.21(两字段、砍 form / posture)

只锚 `body_anchors`(肤色/发色/瞳色/体型/性别/年龄段,**不含头罩面具**)+ `palette_anchors`(纯颜色家族,**不绑衣物**)。服装/姿态/场景全部交给用户 prompt 自由发挥。

**新病根**(中国风 IronMan 实测):出图变成纯古风武侠武者,**完全没有机甲战士的角色 type**。red+gold 配色对了,但 "角色"没保留。

根因:body+palette 缺一个"angle"——LLM 只看到"红+金的健硕男性 + 中国风",自然画武侠武者。

## v2.22 现状(三字段、加 archetype)

加 `character_archetype`(15-40 字角色原型类别,**允许轻微 form 提示**但禁专有名 / 具体配件名):

| 字段 | 跨轮处理 |
|---|---|
| body_anchors | 100% 继承 |
| palette_anchors | 100% 继承(描述为调色板) |
| character_archetype | r2 继承但可弱化措辞(机甲战士保留,form 提示降一档);r3 允许泛化(机甲战士 → 重装战士) |

**举例**:
- ✅ "未来主义全身金属机甲战士,科幻能量外壳"
- ✅ "蒙面贴身敏捷格斗英雄,身手矫健"
- ❌ "钢铁侠"(专有名词)
- ❌ "持圆形红白蓝盾牌的队长"(具体配件 + 配色绑定 = IP fingerprint)

**用户判断标准**(2026-05-24):"稍微有一些 form 也无所谓,会在 R2 被去掉"——R2 任务本身要求"措辞重组 + 降一档具体度",自然会衰减 archetype 里的 form 提示。

## 副作用

- archetype 字段定义"允许 form 提示"+ force-prepend → 偶尔会把"机甲外壳"原样灌进 r3,但比 v2.20 那种"圆形手持配件"已经抽象很多
- 风险:LLM 把过于具体的配件名塞进 archetype 字段(类似 v2.20 老问题再现)。当前靠 r1 system prompt 红线 + 实测观察

## 关联条目

- [rewrite-chain](../domains/rewrite-chain.md) — 三锚定的使用方
- [pipeline-policy](pipeline-policy.md) — 调用方控制 chain 行为
- [llm-half-refusal-empty-rewritten](../pitfalls/llm-half-refusal-empty-rewritten.md) — 三锚定独立于 LLM 半残的另一类 bug
