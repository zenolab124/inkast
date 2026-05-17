# `POST /api/probe-models`:探测 provider 的 `GET /v1/models`

一句话:provider 配置弹窗加一个 "Probe Models" 按钮,后端代理调用 `GET <baseUrl>/models` 拿到当前 provider 实际支持的模型列表,**前端把 model 输入框升级为 Combobox(可下拉 + 可自由输入)**;后端代理是为了避开浏览器 CORS。

## 背景

旧弹窗 model 字段是裸 Input,用户得**记得**或者**查文档**才知道这个 provider 支持什么模型(`gpt-image-2` 还是 `gpt-image-1`?`gpt-4o-mini` 还是 `claude-3-sonnet-20240229`?)。第三方代理常自创模型 ID(`gpt-5.3-codex`),官方文档查不到。

直接前端 fetch `<baseUrl>/models` 不行——第三方代理多数没开 CORS。

## 方案对比

| | A. 用户手填 | B. 后端代理 + Combobox(选中) |
| --- | --- | --- |
| 用户体验 | 必须查文档 | 一键拉列表 |
| CORS | 浏览器直 fetch 多数挂 | 后端无 CORS 限制 |
| 实现复杂度 | 0 | 一个新路由 + 前端 Combobox 替换 |
| 错误反馈 | 提交时才知道 | 拉模型时立即看到 |

## 最终选择

B。

### 后端

```
POST /api/probe-models
body: { providerId?: string, baseUrl?: string, apiKey?: string }

- providerId 给 → 用 DB 里的 base_url + 解密的 key
- baseUrl/apiKey 给 → 用前端表单里临时填的(用户没 commit 前先试)

→ fetch <baseUrl>/models with Authorization: Bearer <key>
→ 解析 data 数组,返 string[](model ids)
```

允许两种入参形态,因为有两种使用场景:**新建** provider 时还没 DB 行(用表单临时值);**编辑** 已存在 provider 时用 DB 凭据(避免明文 key 来回穿)。

### 前端

`model` 字段从 `<Input>` 改成 `<Combobox>`(Popover + Command 组合,详见 `apps/web/src/components/combobox`)。Combobox 的 options 来自上次 probe 调用结果:

- 空时只能手输入(裸 input 体验)
- 一次 probe 后下拉出现,用户能选已知模型,也可继续手输入自创模型 ID

`modelOptions` 是 **form-scoped 状态** —— 切换不同 provider 编辑会话或开新建表单时自动清空,避免 A provider 的列表展示在 B provider 表单下。

## 副作用

- `pnpm dlx shadcn add command` 需要 own(用于 Combobox 内部),已在 [shadcn-primitives](../shared/shadcn-primitives.md) 列表里
- 部分代理 `/models` 路径返回非标准结构(如把 `data` 改成 `models`)— 路由层做了 fallback 解析

## 关联条目

- [provider-pool](../domains/provider-pool.md) — provider 配置
- [shadcn-ui-radix-cmdk](../integrations/shadcn-ui-radix-cmdk.md) — Combobox 底层
- [llm-driver-knobs](./llm-driver-knobs.md) — 还有更多 driver 配置项也会进 Combobox
