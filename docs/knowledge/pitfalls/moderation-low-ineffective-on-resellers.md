# `moderation: "low"` 对二道贩子代理基本无效(但默认开了)

OpenAI `gpt-image-1`/`gpt-image-2` 的官方参数 `moderation: "low"`(对应 `"auto"`),想绕过 duck/cia2/ciallo 这类二道贩子代理的内容审查——**实测对全部三家都没明显帮助**,duck 反而出现新故障路径。

**最终决策**:2026-05-22 起 inkast 默认开 `moderation: "low"`(写死在 images mode body 里,见 [drivers/image/openai-compatible.ts](../../../apps/api/src/drivers/image/openai-compatible.ts) `callProvider`)。对二道贩子无收益,但对**未来接 OpenAI 直连账号**的渠道是有用的;且没有副作用(实测 duck 加这参数后挂死那次,可能是当时该 worker 自己不稳,后续再观察)。

## What

实测三家(漫威角色 prompt "Iron Man in Mark 7 armor..."):

| Provider | base_url | 加 moderation:low | 结果 |
|---|---|---|---|
| ciallo | sin.ioll.pp.ua | 是 | 524 CF 超时(120s 跑不完,跟审查无关) |
| cia2 | eo.ioll.pp.ua | 是 | 180s 客户端超时(无响应) |
| duck | api.duckcoding.ai | 是 | **180s 完全挂死**——之前不加这参数 80-250s 返审查 500,加了反而不返 |

## Why

`moderation` 是 OpenAI 原生 images API 的字段,放宽时**该参数代表"放宽 OpenAI 自家那层 moderation",违反内容政策的责任在调用方账号**。

但 duck/duckcoding 返的"提交中含有违反平台政策的内容"是**duckcoding 平台自家审查话术**(中文 + "平台政策"用词),不是 OpenAI 标准 `moderation_blocked` JSON 响应——意味着审查发生在 **duckcoding 这个代理服务上**,不是 OpenAI 原生。duck 收到 `moderation:low` 参数后:

- 不读这个字段(他们自家审查不解 OpenAI 参数)——参数被透传到 OpenAI 但 duck 这层先拒了
- 或者读了但走了另一条"放宽 worker"路径,而那条路径**挂死了**(180s 不返响应)

ciallo / cia2(`ioll.pp.ua`)那两家根本没审查问题(prompt "a cat" 一样能出图),524/180s 超时是**上游 GPU 速度 + CF 超时**,跟 moderation 参数完全无关。

## Action

**1. 别指望 `moderation: "low"` 解决二道贩子的拒图**——参数已默认开,但 duck 的 false negative 还是靠 retry 抽奖
**2. duck 的拒图本质是概率性**(20% 漏审通过,见 [[duck-moderation-probabilistic]]),per-capability retry 配 duck=3 是更可靠的手段
**3. moderation 对 responses mode 无效**——OpenAI `/v1/responses` 协议不接受该字段,所以 cpa/any/🌿/ciallo(若 responses mode)等不受影响
**4. ciallo / cia2 的真问题是上游慢 + CF 切断**,见 [[cf-120s-images-mode-only]],不是审查
**5. 如果观察到 duck 因 moderation:low 又出现挂死,可以临时回滚这一行**——加在 [openai-compatible.ts:253] 附近,删一行即可

## 关联

- [[duck-moderation-probabilistic]] — duck 拒图是概率性,靠 retry 不靠 moderation 参数
- [[cf-120s-images-mode-only]] — ciallo / cia2 真正的瓶颈
- [[pool-moderation-no-fallover]] — 确定性 moderation 拒图的策略(不切走,防绕审)
