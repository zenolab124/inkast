# 公开版生图双通道:透明代理(passthrough) + 平台兜底(builtin)并存

公开版提供两条生图通道,前端按是否携带 provider 凭据自动分流:passthrough 走用户自带 key,builtin 走平台 env 凭据并扣余额。

## 背景

浏览器直连 image provider 在 Web 形态物理不可行:CORS 策略让 `fetch` 跨域到第三方 provider 直接 403。解决思路有两个方向——要么彻底服务端化(平台出钱),要么做透明代理(用户出 key,服务端仅转发)。

## 方案对比

| 维度 | passthrough(用户带 key) | builtin(平台 env 凭据) |
| --- | --- | --- |
| 平台 cost | 0 | 按 `costPerImage` 扣用户余额 |
| 凭据安全 | key 经浏览器 → jdc 内存转发,零持久化(不落 DB / log) | key 在 jdc env,用户不感知 |
| 适用场景 | 有自己 provider 账号的用户 | 无账号 / 懒得填配置的用户 |
| 余额逻辑 | 不触发(cost=0) | saga:debit → driver → credit 补偿 |

前端逻辑:`ProviderConfigDialog` 保存了 provider 就用 passthrough;否则调 `/api/gen/builtin`(builtin 未配置时返 503)。

## 最终选择

**两条通道并存**,后端分别是 `/api/gen/passthrough`（`apps/api-public/src/server/routes/gen.ts`）和 `/api/gen/builtin`。

## 关键洞见:BYOK"不出本机"在 Web 形态不成立

主线的"凭据不出本机"是指凭据仅存 jdc SQLite,不出服务器。Web 形态下浏览器必须把 key 发给服务端才能生图,无论如何 key 都会经过请求体。passthrough 的承诺是**零持久化**:

- provider 凭据不写 DB,不进日志
- 请求体在 jdc Node.js 进程内存中短暂存在,响应完成后 GC
- `gen_tasks` 表只记 `channel='passthrough'`、`model`、`prompt_json`,**不记 provider 字段**

这与主线 BYOK 的本质差异在于:主线凭据留在本机硬盘,公开版 passthrough 只做到"不持久化到磁盘"。

## 副作用

- passthrough 通道服务端仍看到明文 key(进出请求),无法像主线那样真正"key 不出本机"——这是 Web 形态的结构性限制,应在产品文档里说清楚
- 参见 [pitfalls/passthrough-key-in-transit](../pitfalls/passthrough-key-in-transit.md)（如已创建）

## 关联条目

- [public-image-gen](../domains/public-image-gen.md) — 生图通道端到端实现
- [balance-saga](balance-saga.md) — builtin 通道余额扣减逻辑
- [sqlite-over-keychain](sqlite-over-keychain.md) — 主线凭据存储对比
