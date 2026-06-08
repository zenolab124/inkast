# LDC 充值推迟,Phase 1 邀请码先行

Linux.do Credit(LDC)充值通道推迟到 Phase 2,Phase 1 只实现邀请码充值。

## 背景

公开版的目标用户群是 Linux.do 社区用户(通过 Linux.do OAuth 登录)。社区有自己的积分系统 Linux.do Credit(LDC),接入后可以让用户直接用 LDC 充值 inkast 余额,体验最自然。

但 LDC 集成有明确的技术前置:
- Ed25519 签名验证(支付事件需要验签)
- 异步回调(支付完成后 LDC 主动 POST 回调)
- 幂等性保证(相同 order_id 只处理一次)
- 用户需要先在 linux.do 申请 OAuth app 拿到 client_id / secret

全部做完估计 2-3 周。

## 方案对比

| 维度 | LDC 先做 | 邀请码先做(选) |
| --- | --- | --- |
| 上线时间 | 2-3 周 | ~1 小时 |
| 外部依赖 | LDC OAuth app 审批 + 回调地址配置 | 零外部依赖 |
| 产品验证 | 等 LDC 集成完才能验证产品形态 | 马上可以给内测用户发码验证 |
| 代码复杂度 | 签名 + 异步回调 + 幂等 | 一张 `invite_codes` 表 + redeem 路由 |
| Phase 2 接入成本 | — | 因 topup 插件化,核心余额不动 |

## 最终选择

**邀请码先行**。Phase 1 只实现 `topups/invite-code/`,满足内测所需的手动发码场景。由于充值通道已插件化(见 [topup-plugin-architecture](topup-plugin-architecture.md)),Phase 2 接入 LDC 只需新增 `topups/ldc/` 目录并在 `createApp` 追加一行 `registerLdcTopup(app)`——核心余额域、现有邀请码逻辑、gen 通道全部不用改。

## 注意事项

- LDC 集成前置:用户需自行去 linux.do 申请 OAuth app,拿到 `client_id` / `secret` 配到 jdc env。这步无法代劳,需提前排期
- Phase 2 LDC 集成预计需要在 jdc nginx 开放一个回调域名/路径,改动需在 cc 仓库留痕

## 关联条目

- [topup-plugin-architecture](topup-plugin-architecture.md) — 使 Phase 2 接入 LDC 零改核心的架构基础
- [public-balance](../domains/public-balance.md) — 余额域全景
