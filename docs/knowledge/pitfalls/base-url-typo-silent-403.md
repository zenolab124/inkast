# Provider Base URL 错一个字 → 静默 403

**What**: provider 配置弹窗里 base URL 输错一个字符(如 `elysia.h-e.top` 而真实域名是 `elysiver.h-e.top`),保存成功后**生图永远 403**。错误信息只说"all_providers_failed",没具体提示是 URL 错了。

**Why**: 错误的 base URL 指向一个**不存在或不接服务**的子域,DNS 解析或 CDN 边缘**直接返 403 HTML 页**。inkast driver 把 HTML 403 归到 `auth` 错误类(401/403 的标准分类),分类信息没区分"URL 不通 vs key 无效"。

**Action**:
- **添加 provider 前**:在终端 `curl <base-url>/v1/models` 试一下,确认域名通(返 JSON 错或 401,而非 HTML 403)
- **错误响应里看 errorMessage**:`HTTP 403: <!doctype html>...<title>403 | Forbidden</title>...robots: nofollow,noarchive,noindex` 这种**带 HTML 的 403** 几乎一定是 CDN 边缘拦,**不是 key 问题**
- driver 的 errorMessage 现在会把上游响应前 240 字符拼出来(见 `drivers/image/openai-compatible.ts` 的 `upstreamSummary`),识别 HTML 403 vs JSON 401 不再靠猜

## 错误模式对照表

| errorMessage 形态 | 真因 |
| --- | --- |
| `HTTP 401: { "error": { "message": "Invalid API key" } }` | key 错 / 没权限 |
| `HTTP 403: <!doctype html>...403 \| Forbidden...` | URL 错 / CDN 拦 / 服务下线 |
| `HTTP 429: ...Too Many Requests...` | 上游限流(等几分钟自然恢复) |
| `HTTP 400: { "error": { "message": "Model gpt-image-2 not supported" } }` | 该 provider 不支持这个 model name |
| `HTTP undefined: Request timed out.` | SDK 客户端超时(见 image-driver-timeout-chain) |

## 关联条目

- [cdn-edge-403-without-ua](./cdn-edge-403-without-ua.md) — 另一种 403 来源(UA 问题)
- [add-new-provider](../workflows/add-new-provider.md)
- [provider-pool](../domains/provider-pool.md)
