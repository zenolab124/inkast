# ClaudeCode 作为内置 provider 行

一句话:本机 ClaudeCode driver 不再是"特殊路径",而是注册为 providers 表里**一条**预置行(id 固定为 `__builtin_claude_code__`),走和其他 LLM provider **完全一样**的 priority / disabled / reorder 机制;driver 工厂在路由时识别这个保留 id 走 ClaudeCodeDriver。

## 背景

旧设计 ClaudeCode 是 "fallback default"——前端写死"如果用户没配 LLM provider 就走 claude-code"。问题:

- 用户能配 LLM provider 后,**怎么让 ClaudeCode 不再被用**?需要专门写一个 toggle
- 用户想优先用 LLM provider,失败了再 fallback 到 ClaudeCode——优先级语义跟普通 provider 不一致

## 方案对比

| | A. 保留 fallback 概念 | B. 内置 provider 行(选中) |
| --- | --- | --- |
| 心智模型 | "默认 + provider 池" 两套 | 一套(都在 providers 表里) |
| 排序 | 特殊优先级 | 跟所有 LLM provider 一起拖拽 |
| 禁用 | 单独 toggle | 普通 Switch |
| 删除 | 不能(系统强制保留) | 拒绝(`DELETE 400`) |

## 最终选择

B,保留 id `__builtin_claude_code__`(全局常量 `BUILTIN_CLAUDE_CODE_ID`)。

### 启动时种入

```ts
// storage/providers.ts seedBuiltinClaudeCode()
INSERT OR IGNORE INTO providers (id, name, base_url, key_*)
  VALUES ('__builtin_claude_code__', 'ClaudeCode (local)', '', <zero-bytes>);
INSERT OR IGNORE INTO provider_capabilities (provider_id, kind, model, priority, disabled, extras)
  VALUES ('__builtin_claude_code__', 'llm', 'auto', max(priority)+1, 0, NULL);
```

- `base_url` 空,`key_*` 零字节——这条记录在解密时显式跳过,driver 不读
- `priority = max(LLM)+1`,默认排最后(用户配的 LLM provider 优先)

### 路由 / 调用层

```ts
// drivers/llm/index.ts
function getLlmDriver(providerId: string): LlmDriver {
  if (providerId === BUILTIN_CLAUDE_CODE_ID) return new ClaudeCodeDriver(...);
  // 其他走 OpenAI 兼容
}
```

### API 守卫

- `DELETE /api/providers/__builtin_claude_code__` → HTTP 400 `cannot delete builtin provider`
- `PATCH /api/providers/__builtin_claude_code__/capabilities/llm` 只允许改 `disabled`,`model` / `extras` 拒绝(model 是 ClaudeCode SDK 内部决定)
- `POST /api/providers` 接受 `id`(让前端不能覆盖这个保留 id)

### UI 表现

provider 配置弹窗 LLM tab 里这条行:
- 灰色标签 "内置"
- 不显示 base_url / key
- 编辑按钮变成"启用/禁用"切换(只能改 `disabled`)
- 删除按钮隐藏

## 副作用

- 概念上 "fallback" 消失了——`useEffectiveLlmBackend`(前端 hook)纯粹按 priority 选第一个 enabled 的 LLM capability,不再需要 "若无则 fallback to claude-code" 的特殊逻辑
- 前端用户能像普通 provider 一样拖拽 ClaudeCode 到最前面(让它优先)或最后(只在其他都失败时兜底)

## 关联条目

- [provider-capability-table-split](./provider-capability-table-split.md) — schema 基础
- [drag-to-top-default](./drag-to-top-default.md) — 拖拽决定优先级
- [no-main-ui-backend-selector](./no-main-ui-backend-selector.md) — 不再需要主 UI 选 driver
- [claude-code-sdk-over-cli](./claude-code-sdk-over-cli.md) — ClaudeCode 驱动的实现细节
- [claude-agent-sdk](../integrations/claude-agent-sdk.md) — SDK 用法
