# anyrouter request body 大小 ~200KB 死亡线

## What

发往 anyrouter 的 `POST /v1/responses` 请求,**JSON body > ~200KB 时连响应头都拿不到**,5 分钟整(300s)被对端 RST,fetch 抛 `TypeError: fetch failed | cause: SocketError: other side closed (code=UND_ERR_SOCKET)`。

实测边界(均为 1 ref + 复杂 prompt 单跑):
- body 73KB(1 张 webp 原图) → ✅ 95s 接通响应头
- body 295KB(3 张 webp 原图) → ❌ 298s RST,接不通
- body 593KB(6 张 webp 原图) → ❌ 303s RST,接不通

## Why

anyrouter 是个跨大洲 CDN 代理(Akamai ESA,via 头 `l2hk12 → l2jp3 → l2us3 → us37`)。第一跳 Caddy 接到大 body 后转发到上游 OpenAI,但**接收 + 转发 + 等响应**这条链路上某一段对单连接 body 大小或转发耗时有 5 分钟硬上限。超出后第一跳就 RST socket。

跟模型、prompt 内容、并发都无关——纯粹是**进入 anyrouter 内部前的 body 受理瓶颈**。

## Action

driver 在送 reference image 之前必须自动压缩,把 6 张图的总 body 控制在 200KB 以内:

- 实现位置:[apps/api/src/domain/generate/index.ts](../../../apps/api/src/domain/generate/index.ts) `normalizeReferenceImage` 函数
- 压缩参数:**短边 384px 上限 + WebP 质量 60** (`REF_MAX_DIMENSION = 384`, `REF_WEBP_QUALITY = 60`)
- 效果:典型 80KB WebP 源图 → 压成 10-20KB,6 张总 ~100KB raw → base64 inflated 后 body ~120-160KB,稳过死亡线

注意 `base64 inflates ~33%`——raw 必须留出余量,driver 日志会打印 `request: body=XB (json), refs=N totaling YB (raw bytes, base64 inflates ~33%)` 帮诊断。

## 关联条目

- [decisions/auto-compress-references](../decisions/auto-compress-references.md) — 为什么选 sharp 384/q60
- [pitfalls/anyrouter-via-cdn-queue](anyrouter-via-cdn-queue.md) — 跨大洲多跳排队的延迟特性
- [pitfalls/undici-default-timeout-short](undici-default-timeout-short.md) — undici 默认超时被代理 RST 杀的另一面
