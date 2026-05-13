# Raw fetch 被 CDN 边缘 403

**What**: 通过 raw `fetch()` 调第三方 OpenAI 兼容代理(如 elysiver.h-e.top),返回 HTTP 403 + HTML 页面(带 `robots: nofollow,noarchive,noindex` meta)。延迟极短(<1.5s),且根路径、`/v1/models`、`/v1/images/generations` 全部都被拦。

**Why**: Node 22+ 的 fetch(undici)**默认没设 User-Agent**(或者是 `node` 之类不显眼的值)。第三方代理用 Cloudflare 之类的 CDN,把无 UA / 可疑 UA 的 POST 当 bot 拦在边缘,**根本没到应用层**——所以错误形态是 HTML 页,不是 JSON。

**关键证据**:gpt-image-canvas 同样 endpoint 用 `openai` SDK 跑通。SDK 自带 `User-Agent: OpenAI/JS x.y.z` + 一组标准 fetch headers,过得了 CDN 检查。

**Action**:
- 不要 raw fetch 调任何"OpenAI 兼容"端点——用 `openai` SDK
- 见 [openai-sdk-over-fetch](../decisions/openai-sdk-over-fetch.md)
- 即使是简单的探测请求(`GET /v1/models` 等),也走 SDK

## 错误现场

```
HTTP undefined 之类不可能是这种 — 那是 SDK 客户端 timeout
HTTP 403 + body 含 `<title>403 | Forbidden</title>` + robots meta → 一定是 CDN 边缘拦
```

直接 curl 同样的 URL(带或不带 Browser UA)如果也 403,**和 inkast 代码无关**。如果带 Browser UA 能过、不带 UA 就 403,**就是 UA 问题**——切到 SDK。

## 关联条目

- [openai-sdk-over-fetch](../decisions/openai-sdk-over-fetch.md)
- [openai-sdk-images](../integrations/openai-sdk-images.md)
- [provider-pool](../domains/provider-pool.md) — 错误分类把这类归到 `auth`
