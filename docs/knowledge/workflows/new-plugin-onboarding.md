# 新客户接入 Plugin 通道

把新客户(snap-ub 之类)接入 inkast plugin 通道,**不动主线代码**。

## 完整流程(详尽 step-by-step 见 [docs/onboarding-new-plugin.md](../../onboarding-new-plugin.md))

```
0. 前提确认
   - 主线 inkast 已在目标机器跑
   - systemd EnvironmentFile 含 INKAST_PLUGIN_DIR
   - nginx /inkast/ 反代已配(对方要走公网)
   - inkast SQLite 已配 LLM / image provider

1. 决定 plugin 身份
   - plugin id: 小写 + 数字 + _-
   - token: openssl rand -hex 32

2. 创建 overlay 仓
   - mkdir inkast-overlay-<id>
   - git init
   - plugins/<id>.json + deploy/* + README.md

3. 写 plugin JSON
   - 决策:LLM 拆解 vs skip-LLM
   - imageDefaults: size / quality / format
   - outputDimensions: 是否 sharp resize
   - 业务约束: skipLlmConstraintsText 或 systemPromptPatch
   - enforceFields: LLM 模式兜底覆盖字段

4. 部署
   - rsync plugins/<id>.json → server:/etc/inkast/plugins/<id>.json
   - chown root:root + chmod 644
   - 在部署机生成 token 写 inkast-api.env
   - systemctl restart inkast-api

5. 给对方接入信息
   - Base URL + Endpoints + Token

6. 验证
   - 启动日志: loaded <id>.json + loaded token
   - dashboard 看新 plugin
   - curl 401 / 200 / callback
```

## 关键文件位置

| 路径 | 作用 |
|---|---|
| `docs/onboarding-new-plugin.md` | 详尽 step-by-step 文档(9 节,带 troubleshooting 速查) |
| `docs/plugin-overlay.md` | JSON schema 规范 + 机制说明 |
| `apps/api/src/plugins/types.ts` | `InkastPlugin` 接口源码 |
| `apps/api/src/plugins/loader.ts` | zod schema 校验源码 |

## 主线升级时

只要 `InkastPlugin` JSON schema 不破坏,**overlay JSON 不需要改**。

- 小版本(加可选字段、修 bug)→ 所有 overlay 自动兼容
- 主版本(schema 破坏性)→ 各 overlay 按公告自查升级

接入完成后稳态 = 主线和 overlay **几乎完全解耦**。

## 关联条目

- [plugin-overlay-loader](../shared/plugin-overlay-loader.md) — JSON loader 实现
- [json-overlay-vs-branch](../decisions/json-overlay-vs-branch.md) — 为何走 overlay 不走 branch
- [plugin-channel](../domains/plugin-channel.md) — 通道整体架构
