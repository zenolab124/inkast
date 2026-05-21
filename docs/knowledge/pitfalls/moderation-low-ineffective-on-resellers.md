# `moderation: "low"` 对二道贩子代理基本无效

OpenAI `gpt-image-1`/`gpt-image-2` 的官方参数 `moderation: "low"`(对应 `"auto"`),想绕过 duck/cia2/ciallo 这类二道贩子代理的内容审查——**实测对全部三家都没明显帮助**,duck 反而出现新故障路径。

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

**1. 不要加 `moderation: "low"` 想绕过 duck 拒漫威**——已验证无效,且把 duck 从"概率拒图"推到"完全挂死",比不加更糟
**2. duck 的 false negative 是概率性的**(20% 漏审通过,见 [[duck-moderation-probabilistic]]),靠 retry 多次抽奖,不靠参数
**3. 只对直连 OpenAI 的渠道(如官方 endpoint)考虑加 moderation 参数**——直接 OpenAI 才会真正按这字段放宽
**4. ciallo / cia2 的真问题是上游慢 + CF 切断**,见 [[cf-120s-images-mode-only]],不是审查

## 关联

- [[duck-moderation-probabilistic]] — duck 拒图是概率性,靠 retry 不靠 moderation 参数
- [[cf-120s-images-mode-only]] — ciallo / cia2 真正的瓶颈
- [[pool-moderation-no-fallover]] — 确定性 moderation 拒图的策略(不切走,防绕审)
