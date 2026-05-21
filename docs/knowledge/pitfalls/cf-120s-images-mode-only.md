# CF 反代 120s 兜底超时 only 影响 images mode,SSE 流式绕过

`ioll.pp.ua` 这类 Cloudflare 反代的渠道,**用 `/v1/images/generations`(images mode)请求会被 CF 120s "源站无响应"兜底切断**。但同上游用 `/v1/responses` + `stream: true` 完全绕过——流头 200 立即返,CF 永不切断。

## What

ciallo(`sin.ioll.pp.ua`)实测 images mode + 漫威 prompt(1065 字节):
```
status: 524 (125644ms)
{"type":"https://developers.cloudflare.com/.../error-524/",
 "title":"Error 524: A timeout occurred",
 "detail":"The origin web server did not return a complete response within
           the 120-second Proxy Read Timeout window..."}
```

同上游同 prompt 改 responses mode + stream:true:
```
← headers in 733ms       ← CF 看流头立即放行
firstEvent @734ms
✓ stream ended @54054ms  ← 54 秒整张图传完
events=3, totalBytes=6498711 (6.5MB)
```

**简单 prompt "a cat"(3 字节)走 images mode 也行**(59s 出图,小于 120s);**复杂 prompt 触发 GPU 长生成才撞 CF**。所以现象跟 prompt 复杂度耦合,不容易立刻定位是 CF 的事。

## Why

Cloudflare 反代默认有 **"源站无响应"超时**(免费/Pro 计划 100s,Business 120s,Enterprise 可调到 6000s)。计算口径是"源站发任何 bytes 前的等待时间":
- **images mode**(non-stream):上游必须完整画完才返 body,GPU 慢 → CF 切断
- **responses mode + stream:true**:上游瞬间返 SSE 头 + keepalive 事件 → CF 看到 bytes 就放行,后续慢慢传都不切断

OpenAI 协议层 `/v1/images/generations` **协议本身不支持 streaming**(没有 `stream: true` 参数),所以 images mode 跟 CF 这套限制硬撞;`/v1/responses` 设计上就是为长任务的 streaming。

## Action

**1. 任何走 CF 反代(或类似 nginx proxy_read_timeout)的渠道,优先用 responses mode + SSE**——`extras.mode = "responses"`,driver 自动走 [openai-responses.ts](../../../apps/api/src/drivers/image/openai-responses.ts) 永远开 stream
**2. images mode 适用场景**:渠道是直连 OpenAI(没 CF)、画图很快(< 60s)、或者上游有自己的"长任务挂起"机制(如 polling)
**3. 同一个上游加两个 capability 行**:一个 model=`gpt-image-2` + mode=`images`(老链路兼容),一个 model=`gpt-5.3-codex` + mode=`responses`(长任务用)
**4. 联调新代理时先 curl 测两种 mode**——别先信"它兼容 OpenAI",拿真实 prompt 长度跑

## 关联

- [[responses-mode-raw-fetch-sse]] — responses driver 永远开 stream:true 的根因
- [[image-mode-coexistence]] — images / responses 两 mode 共存设计
- [[anyrouter-via-cdn-queue]] — Akamai 排队也吃 CF/CDN 类延迟
- [[image-driver-timeout-chain]] — driver / proxy / SDK 三层超时
- [[cdn-edge-403-without-ua]] — CF 类反代另一种坑
