# Provider schema 拆分:`providers` + `provider_capabilities`

一句话:把 "一个 provider 只能是图像或 LLM" 的旧模型升级为 "一个 provider 共享凭据,挂多个 capability(`image` / `llm`)";新增 `provider_capabilities` 表,每行携带 `kind / model / priority / disabled / extras`,复合索引 `(kind, priority)` 支持池级排序。

## 背景

旧模型一个 OpenAI 兼容代理(比如 anyrouter)同时支持图像和 LLM,得在 `providers` 表里建**两行**——同样的 base_url、同样的 key、不同的 `kind`。两行各自有 priority,改起来要操作两次,key rotation 也要双写。语义上明显是"一个 provider 两种能力"。

## 方案对比

| | A. 不动(两行) | B. JSON 字段(`providers.capabilities` blob) | C. 拆表(选中) |
| --- | --- | --- | --- |
| 凭据共享 | 重复存 | 单条 | 单条 |
| 单 kind 查询 | `WHERE kind=?` | JSON 函数(SQLite 弱) | `JOIN provider_capabilities` |
| 池级排序 `ORDER BY priority` | 同表直接 | JSON 解析后排序(慢) | 复合索引 `(kind, priority)` |
| 迁移成本 | 0 | 中(写迁移) | 中(写迁移) |

## 最终选择

C 拆表。

```sql
CREATE TABLE providers (
  id TEXT PRIMARY KEY, name TEXT, base_url TEXT,
  key_ciphertext BLOB, key_iv BLOB, key_tag BLOB,
  created_at INTEGER, updated_at INTEGER
);
CREATE TABLE provider_capabilities (
  provider_id TEXT REFERENCES providers(id) ON DELETE CASCADE,
  kind TEXT,  -- 'image' | 'llm'
  model TEXT, priority INTEGER, disabled INTEGER, extras TEXT,
  PRIMARY KEY (provider_id, kind)
);
CREATE INDEX idx_caps_kind_priority ON provider_capabilities(kind, priority);
```

`extras` 是 JSON 字符串,装 driver-specific 配置(`mode: "responses"`、`effort: "low"`、`thinking: {...}` 等)。详见 [image-mode-coexistence](./image-mode-coexistence.md) 和 [llm-driver-knobs](./llm-driver-knobs.md)。

## 迁移策略

启动时跑 `backfillCapabilities`:

1. `PRAGMA table_info(provider_capabilities)` 检测表是否存在
2. 不存在 → `CREATE TABLE` + 从旧 `providers.kind` 列(如还在)生成对应 capability 行
3. 老 `providers` 表里 `kind` / `model` / `priority` 列**保留**(SQLite 不好删列)但停止读写

整套迁移**幂等**——每次启动都跑一遍,已迁移好的项目直接 no-op。

## 配套改动

- `storage/providers.ts` API 全部围绕 capability:`listEnabledCapabilities(kind)`、`getProviderCapability(id, kind)`、`reorderCapabilities(kind, orderedIds)`、`updateCapability(providerId, kind, patch)`
- `/api/providers` POST/PATCH 接受 `capabilities: CapabilityInput[]` 数组,可单创建多 kind 的 provider
- 新增 `/api/providers/reorder` 接受 `{kind, orderedProviderIds}` 批量排序
- `extras.mode` 字段语义见 [image-mode-coexistence](./image-mode-coexistence.md)

## 关联条目

- [provider-pool](../domains/provider-pool.md) — 池消费 capability 表
- [claude-code-builtin-provider](./claude-code-builtin-provider.md) — 内置 provider 也走 capability 行
- [llm-driver-knobs](./llm-driver-knobs.md) — extras 字段的 LLM 侧含义
- [image-mode-coexistence](./image-mode-coexistence.md) — extras.mode 字段的图像侧含义
- [shared-contracts](../shared/shared-contracts.md) — `ProviderCapability` 类型
