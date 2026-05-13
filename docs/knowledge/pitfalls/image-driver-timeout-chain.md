# 生图超时:三层 timeout 必须协调

**What**: 用户在 UI 看到 502 "Request timed out",**但 provider 后台日志显示请求成功生图**。

**Why**: 生图链路有**三层独立超时**,任意一层先超,客户端就 502 了——即使 provider 那边还在工作:

```
┌─ openai SDK ─────────┐  driver new OpenAI({ timeout: 600_000 })
│  Vite proxy ─────────┐  vite.config.ts proxy { timeout, proxyTimeout }
│   fetch (浏览器)─────┐  浏览器内部默认无限,但反向代理可能切
└───────────────────────┘
```

第一版 driver 用 180_000(3 分钟),gpt-image-2 高质量 + 复杂 prompt 单次跑 4-5 分钟很常见 → SDK 在 180s 处主动断开,但 provider 还在生图。最终图实际生成成功,只是 inkast 这边没收到响应。

**Action**:
- driver `timeout`: **600_000 ms (10 分钟)** — 对齐 gpt-image-canvas 风格(它 20 分钟)
- vite proxy `timeout: 600_000` + `proxyTimeout: 600_000` — 见 [vite-dev-proxy](../integrations/vite-dev-proxy.md)
- 浏览器 fetch:默认无限,不动

## 后台日志验证方法

```bash
# 看 driver 走过哪些 provider,各用了多久
tail -f <dev-log> | grep "^\[api\] \[image\]"

# 期待:
# [image] attempt 1/2: duck2 (priority=1) → ...
# [image] ✓ duck2 succeeded in 242000ms
```

如果"succeeded"出现但前端报 timeout,**一定是三层超时其中一层先断**——查证三个数字。

## 关联条目

- [vite-dev-proxy](../integrations/vite-dev-proxy.md)
- [openai-sdk-images](../integrations/openai-sdk-images.md)
- [provider-pool](../domains/provider-pool.md)
