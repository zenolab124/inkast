# R2 直传(Plugin v2.1 协议)

inkast 出图后**直接 PUT R2** + callback 只发 `image_url`,而不是把 b64 推给 uniCloud 让对方上传。Plugin 通道的 v2.1 增量协议(2026-05-22 上线)。

## 背景

v2 callback 用 `b64_json` 字段把整张图(~1.5MB PNG 编 base64 后 ~2MB)推给 uniCloud,uniCloud 解码后再上传到自己的 R2。两个真实成本:

- **jdc 上行带宽 5Mbps**(理论 ~600KB/s),单次 callback 占满 3-4 秒,影响共享出口的卡牌识别 / umami / 青龙等服务
- **uniCloud 公网出站流量计费**(snap-ub 估算 22.5GB/月,~18 元起步)

callback 长度从 ~2MB → ~80 字节 URL 后,JDC 上行省 ~95%,uniCloud 那条"b64→R2 上传"代码路径整层消失。

## 方案对比

| | A · b64 callback(v2) | **B · R2 直传 + URL(v2.1)** |
|---|---|---|
| inkast 端职责 | 出图 → b64 → POST callback | 出图 → PUT R2 → POST callback URL |
| 客户端职责 | 解 b64 → 上传 R2 → 写 DB | 直接写 DB |
| JDC 上行 | 2MB/张 | ~80B/张 |
| 跨网络 | 双向(下游再上传) | 单向 |
| inkast 凭据 | 无 R2 凭据 | 需 R2 token |
| 资产归属 | 客户管 | inkast 写客户 bucket(路径前缀隔离) |

## 最终选择

**B**。bucket / publicBase / keyPrefix / contentType 走 plugin overlay JSON(per-plugin 配),token 三件(account_id / access_key_id / secret_access_key)走 env。callback body 加 `image_url` 字段,**保留 `b64_json` 兼容老客户**(/status/:id 接口同步,二选一)。

`imageStorage.kind = "b64" | "r2"`,默认 `b64`——主线零行为破坏,客户按需 opt-in。

## 副作用

- inkast 需要 R2 凭据(增加凭据管理面),但用 keychain → env stdin pipe 注入,**secret 不经 shell 变量也不进 transcript**
- snapub plugin 切 r2 后,uniCloud 端 callback handler **同步改一行**(双协议兼容,有 image_url 优先)
- snap-ub `aiVariants/` 前缀下的图归属变成"inkast 写、snap-ub 读",**bucket 仍是 snap-ub 自己的**(`snap-ub-ai-variants`),归属清晰
- 实测一张图 R2 PUT ~4 秒,1.4MB PNG;callback ~1 秒;**比之前快得多**

## 关联

- [[plugin-channel]] — 通道整体,生命周期加了 R2 分支
- [[cloudflare-r2]] — R2 driver 用法 + bucket 约定
- [[v2-async-callback-protocol]] — v2 协议本身的设计
- [[json-overlay-vs-branch]] — 为什么 imageStorage 配置走 overlay 不走环境变量
