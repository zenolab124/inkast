# 客户特化走 JSON Overlay 而非 Git 分支

inkast 标品 + 客户特化的拆分方式:**JSON overlay**(主线代码 0 提及客户,客户配置在独立 git 仓的 JSON 文件)。

## 背景

snap-ub 第一个 production 接入后,我们在主仓积累了 snap-ub 专属代码(`plugins/snapub.ts` + 业务约束)。继续往里塞客户特化代码会导致主线代码客户污染、release 难协调。需要切干净。

## 方案对比

| 维度 | JSON overlay | Git 分支(main + branch) |
|---|---|---|
| 主线代码污染 | 0 提及客户 | 0(branch 里加文件) |
| 新客户加入成本 | 1 份 JSON + 部署脚本 | 新 branch + cherry-pick |
| 主线升级影响 | overlay 自动兼容(只要 InkastPlugin schema 不破坏) | **每个客户分支都要 merge / 解冲突** |
| 客户数量增加 | 线性维护 | **指数级**(fork hell) |
| 客户改主线代码 | 否(必须主线加 hook) | 是 |
| 版本独立性 | 主线 / overlay 各自 release | 不存在版本概念 |
| Code review | 客户特化都是 JSON,non-engineer 可读 | 必须工程师 review |
| 业界惯例 | SaaS / PaaS / 企业软件 | 开源分发 |

**核心区别**:JSON overlay 把"客户特化"当成**配置数据**;branch 把"客户特化"当成**代码 fork**。

## 最终选择

**JSON overlay**。理由:

1. **客户特化目前全是数据**(systemPromptPatch / enforceFields / size / outputDimensions / token)—— JSON 表达充分
2. **会有第 2 个客户**(用户明确未来要加),branch 模式 3 个客户后崩溃
3. **主线频繁迭代**(每周 ~3-5 个 commit),branch 模式每次升级都要 N 倍 merge 成本
4. **客户特化数据化 + 主线升级独立** 是 SaaS 标准做法,业界沉淀过的 pattern

## 实现要点

- 主仓 `apps/api/src/plugins/` 只有框架(types / registry / loader / errors),无任何客户 `*.ts`
- 客户 overlay = 独立 git 仓(`inkast-overlay-snapub`),含 `plugins/<id>.json` + `deploy/*`
- inkast 启动时扫 `INKAST_PLUGIN_DIR` env 指向的目录,逐个 `JSON.parse` + zod 校验后注册
- Token 仍用 env(`INKAST_PLUGIN_TOKEN_<UPPER_ID>=...`),**不进 JSON**(secret 不落盘到 git-tracked 文件)

## 副作用 / 边界

- **JSON 限制表达力**:客户暂时无法注入"代码"(custom transcode / custom error mapper)
- **未来扩展路径**:主线提供 hook 注册点(具名),overlay JSON 引用 hook 名 —— 仍保持 JSON 形态,**不要回到 ts 文件 import**
- **schema 演进**:主线加新可选字段 = 兼容;删字段 / 改语义 = 需要 overlay 同步升级

## 关联条目

- [plugin-channel](../domains/plugin-channel.md) — 这个机制承载的通道
- [plugin-overlay-loader](../shared/plugin-overlay-loader.md) — 加载机制实现细节
- [new-plugin-onboarding](../workflows/new-plugin-onboarding.md) — 加新客户的操作流程
