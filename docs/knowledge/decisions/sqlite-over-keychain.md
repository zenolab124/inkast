# 凭据存储:SQLite + AES-GCM,不用 macOS Keychain

## 背景

provider API key 要本地加密存储。两种方案:

- **A**:imagegen 套路 — 用 macOS Keychain,Python 脚本用 `security find-generic-password`
- **B**:跨平台自建 — SQLite BLOB + AES-256-GCM,master key 在文件

## 方案对比

|  | A: Keychain | B: SQLite + AES |
| --- | --- | --- |
| 跨平台 | ❌ 仅 macOS | ✅ 三平台 |
| 安全模型 | 操作系统级(Touch ID / 密码门槛) | 文件权限 + 一个 master.key |
| 多用户共用同机 | Keychain 自动按用户分 | master.key + DB 同一份,需手工隔离 |
| 备份 | iCloud Keychain 可同步 | 备份 `<data-dir>/` 即可 |
| 复杂度 | 平台 API 调用 | crypto 标准 API |
| 部署/打包 | 桌面 App 才方便 | 任何 Node 进程都行 |

## 最终选择

**B**:CLAUDE.md "关键设计决策"段明文 — "**不**用 macOS Keychain,要跨平台"。

inkast 之后可能走 Localhost Helper 模式部署(网页 + 本机 Agent),Agent 二进制要在 macOS/Windows/Linux 都能跑——Keychain 直接断了 Win/Linux 路线。

## 实现摘要

- master.key:`<DATA_DIR>/master.key`,32 字节随机,chmod 600
- 列布局:`key_ciphertext` / `key_iv` / `key_tag` 三个 BLOB
- 透明加密:`providers.ts` 仓储层在 INSERT/SELECT 处加解密,业务层只见 plaintext

## 为什么没复用 imagegen 的 generate.py

那个脚本是 Python + macOS only,inkast 是 Node + 跨平台 → 整套语义(provider 池/故障切换/moderation 不切)**重写一遍**,而不是 import。CLAUDE.md "不要做的事"段明文:`imagegen 的 generate.py 仅供参考,不直接复用`。

## 关联条目

- [crypto-utils](../shared/crypto-utils.md) — 实现细节
- [provider-pool](../domains/provider-pool.md) — 消费方
- [better-sqlite3](../integrations/better-sqlite3.md) — 存储引擎
