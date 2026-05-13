# 凭据加密 — AES-256-GCM

OpenAI 兼容 provider 的 API key 在 SQLite 表里加密存储。算法 AES-256-GCM(authenticated encryption),master key 在本机文件,**永远不出本机**。

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `apps/api/src/storage/runtime.ts` | `masterKey()` 加载/生成 + `dataDir()` `imagesDir()` 解析 |
| `apps/api/src/storage/crypto.ts` | `encryptSecret` / `decryptSecret` / `maskKey` |
| `apps/api/src/storage/providers.ts` | 仓储层透明加密:写 INSERT 时加密,读时解密 |

## Master key

```
<DATA_DIR>/master.key
- 32 字节随机(crypto.randomBytes)
- chmod 600(仅 owner 可读)
- 首次启动自动生成
- 不存在时新建,存在时直接读
- 缓存到内存(_masterKeyCache)
```

**红线**:rotate master key 等于把所有已存凭据失效——目前 Phase 1 不支持 rotation。删除 master.key 后,所有 provider 要重新输入 key。

## 加密格式

```
EncryptedSecret = { ciphertext: Buffer, iv: Buffer(12), tag: Buffer(16) }
```

`iv` 每次随机,`tag` GCM auth tag。三个字段分别存进 `providers` 表的 `key_ciphertext` / `key_iv` / `key_tag` BLOB 列。

## maskKey 用于 API 响应

```ts
maskKey("sk-vxxxxxxxxxxxxwfqP")
// → "sk-v•••••••••••••wfqP"
```

前 4 后 4 明文,中间 bullet。**前端永远只看到 masked**——`listProviders()` 解密后立即 mask 再返回。

## 凭据生命周期

```
用户在 UI 输入 key
  → POST /api/providers { apiKey: "sk-..." }
  → encryptSecret("sk-...") → { ciphertext, iv, tag }
  → INSERT INTO providers (key_ciphertext, key_iv, key_tag, ...)
                                                                  
后续:
  GET /api/providers → listProviders() → decryptSecret() → maskKey() → 前端
  生图时:image driver → listProviderKeys() → decryptSecret() → 传给 OpenAI SDK
```

decrypt 失败抛 Node 内置错误(auth tag mismatch),意味着 master.key 被换过或数据被篡改——这种情况整个 provider 不可用。

## 关联条目

- [provider-pool](../domains/provider-pool.md) — 谁消费解密结果
- [sqlite-over-keychain](../decisions/sqlite-over-keychain.md) — 为什么不用 Keychain
- [better-sqlite3](../integrations/better-sqlite3.md) — BLOB 列存储
