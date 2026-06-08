# 公开版做独立 app,不做 plugin overlay 也不做模式开关

公开版是一套与主线**架构差异**明确的产品,单独建 `apps/api-public` + `apps/web-public`,共享 `@inkast/shared` 类型契约,而不是在主线加 runtimeMode 或走 plugin overlay。

## 背景

inkast 主线是 BYOK"凭据不出本机"的单用户自部署工具。要上一个面向公众的版本时,必须决定把公开版的 OAuth 登录 + 用户余额 + 平台兜底 provider 塞进哪里。

## 方案对比

| 维度 | A 独立 app(选) | B 模式开关 | C 完全独立项目 |
| --- | --- | --- | --- |
| 代码量 | 共享 `@inkast/shared` 类型;App.tsx 等差异文件各维护一份 | 一份代码 | 完全两套 |
| 主线纯净性 | 高:主线零感知公开版逻辑 | 低:驱动层 / 持久化层全是 `if byok ... else public` | 高 |
| 维护债 | App.tsx 手维护两份,差异可视 | if-else 散落各处,迁移成本指数增长 | 类型契约不同步 |
| 架构差异可见 | 显式:两个 entry + 两个后端 | 隐式:隐藏在 runtimeMode 条件里 | 两个仓库的接口漂移 |
| 适合场景 | 架构差异 | 数据/品牌驱动的客户特化 | 无共享的独立产品 |

plugin overlay(方案 B 的变体)本质是"**数据驱动**的客户特化"(换 token / 品牌 / 存储后端),而公开版需要的是**完整 OAuth + 用户余额 + stateless 多用户**——这属于**架构差异**,性质不同,overlay 无法表达。方案 C 的问题是共享 `@inkast/shared` 类型的同步成本极高;A 通过 monorepo 的 `packages/shared` 解决了这个问题。

## 最终选择

**方案 A:monorepo 独立 app。**

- `apps/api-public` + `apps/web-public`:公开版后端 + 前端
- `apps/api` + `apps/web`:主线 BYOK 版本,零感知公开版逻辑
- `packages/shared`:公共类型契约(`ImagePrompt` / `ProviderSummary` / `ProviderCapability` 等)
- `pnpm-workspace.yaml` 统一管理:`packages: ["apps/*", "packages/*"]`

主线宪法"凭据不出本机"不妥协:主线驱动层和持久化层不引入任何 `runtimeMode` 检查。

## 副作用

- `apps/web/src/App.tsx` 与 `apps/web-public/src/App.tsx` 差异需手动维护。关键差异:
  - 主线有 plugin-gallery Tab + Stats 按钮 + 暗色模式切换;公开版砍掉这三项(公开版用户不该看到 plugin 管理概念)
  - 公开版 Header 多一个 `<AuthHeader />` 组件(登录/登出状态)
- 两份后端的 `server/app.ts` 注册不同路由:主线有 `/plugins/v1/*` + `/admin/*`;公开版有 `/api/gen/*` + OAuth 路由

## 关联条目

- [public-edition-overview](../domains/public-edition-overview.md) — 公开版全景
- [json-overlay-vs-branch](json-overlay-vs-branch.md) — plugin overlay 的适用场景(与本决策形成对比)
- [public-idb-over-backend](public-idb-over-backend.md) — 公开版前端存储选择
