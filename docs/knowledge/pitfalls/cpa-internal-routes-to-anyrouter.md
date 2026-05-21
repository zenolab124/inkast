# cpa 内部转发 image 到 anyrouter("套一层"不解决问题)

**What**: anyrouter 上 `gpt-5.3-codex` 模型频繁 `get_channel_failed`,以为换成 cpa(`cliproxyapi.124213.xyz`)做中转能绕过去。结果 plugin 调用还是失败,error body 显示:

```
HTTP 500: {"error":{"message":
  "Post \"https://anyrouter.top/v1/responses\":
   read tcp 198.19.0.1:50641->198.0.2.30:443: read: connection reset by peer"}}
```

**Why**: cpa 名字像 LLM proxy(cli**proxy**api),实际它内部把 image 请求**继续转给 anyrouter**。"套 cpa" = 多一层中转,最终上游仍是 anyrouter。问题没绕过去,只多了一跳。

误判线索: error 里 `198.19.0.1` 是 macOS Network Extension 私有 IP(Surge/Loon 等代理软件占用),这是 cpa 部署的 mini 端代理拦截 DNS 后的"虚拟目标 IP",不是 anyrouter 真实 IP。我初判这是"jdc → cpa 链路问题",其实是 mini 代理 → anyrouter 那一跳断的。

**Action**:

1. **看清上游真身**:provider 配置写 `cpa` ≠ 它内部就用自己的图模。如果 cpa 内部仍走 anyrouter,问题没解决,要么:
   - 换真正用不同图模的 provider(如 duckcoding 用 `gpt-image-2`)
   - 直接配 OpenAI / Replicate 原生
2. **看清 error IP**:`198.19.x.x` / `198.18.x.x` 是 RFC2544 + macOS NetEx 私有段,**不是真实公网 IP**。不要凭这个 IP 推链路位置

## 关联条目

- [anyrouter-channel-failed-not-network](anyrouter-channel-failed-not-network.md) — 同一组故障的另一面
- [provider-pool](../domains/provider-pool.md)
