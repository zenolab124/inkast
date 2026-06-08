# passthrough-key-in-transit — 透明代理的 provider key 仍经 jdc 内存

公开版 passthrough 通道宣称"provider key 不入库"，但用户的 provider key 在请求链路中仍经过 jdc 进程内存，并非真正的"不出本机"。

## What

用户在 ProviderConfigDialog 填写自己的 provider `apiKey`，前端发 `POST /api/gen/passthrough` 时把 `provider.apiKey` 放进请求体，后端接收并传给 `passthroughGenerate()`，再由 jdc 进程构造 OpenAI 兼容 client 向上游转发。

对比主线（本地优先 BYOK）：主线 API 运行在用户本机，key 在本机进程内存中，网络链路是 `localhost → provider`，key 确实不出本机。

公开版的实际链路是：

```
用户浏览器内存 → HTTPS → jdc 进程内存 → provider
```

jdc 是共享服务器，不是用户自己的机器。

## Why

CORS 限制浏览器不能直接向第三方 provider 发跨域请求（大多数 provider 不设 CORS 白名单）。公开版需要服务端 proxy 来转发请求，物理上无法避免 key 经过 jdc。"不入库"是真实保证（`gen.ts` 里 `createGenTask` 不写 apiKey），但"不经服务器"在 Web 形态中不可能实现。

详见 `apps/api-public/src/drivers/passthrough-image.ts`：每次请求新建 OpenAI client，`apiKey` 作为局部变量存在于 `passthroughGenerate` 的栈帧，响应完成后 GC。不落磁盘、不进 log，但确实经过 jdc 进程内存。

## Action

正确描述保证的边界：

- **已保证**：零持久化——key 不落 SQLite、不写日志文件、不进任何持久存储，以局部变量形式存在于单次请求的生命周期，请求结束即 GC
- **未保证**：零传输——key 必然经过 jdc 进程内存，这是 CORS 代理的必要代价
- **与主线的差异**：主线的"key 不出本机"成立是因为 API 在用户本机，公开版无法提供这个保证

用户若对 key 安全有严格要求，应自部署主线版本（本地优先 BYOK）。公开版 passthrough 仅保证 jdc 不持久化，不保证 jdc 不经手。

**必读文件**：`apps/api-public/src/drivers/passthrough-image.ts` · `apps/api-public/src/server/routes/gen.ts`（passthrough 段 createGenTask 注释）

---

关联条目：[domains/public-image-gen](../domains/public-image-gen.md) · [decisions/sqlite-over-keychain](../decisions/sqlite-over-keychain.md)
