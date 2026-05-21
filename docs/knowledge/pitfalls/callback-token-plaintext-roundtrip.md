# callback_token 必须 plaintext 存(哈希会破坏 round-trip)

**What**: 第一版 plugin_tasks 表设计了 `callback_token_hash` 列(SHA-256 存),想着"凭据哈希是好习惯"。后来要发 callback 时发现:`X-Callback-Token` header 要带**原值**,但表里只有哈希(不可逆),没法回填。

**Why**: callback_token 不是密码(用户输,服务端验),而是**对称 token**:调用方提交 submit 时生成 token,inkast 在 callback header 里**带回原值**,调用方比对自己存的副本(snap-ub 端也 plaintext 存)。这是 round-trip 模式,**两端都必须能拿到原 token**。哈希破坏 round-trip。

对方协议文档 §10.3 字面写"inkast 哈希存",这是文档作者的笔误——跟 §3 的"callback 时带回原值"逻辑矛盾。我方实现按语义来,plaintext 存,跟对方 snap-ub 端的明文存对称。

**Action**: 表设计为 `callback_token TEXT NOT NULL`(plaintext)。安全模型基于:

- Token 一次性(每次 submit 重新生成)
- 24h 后 GC 自动清(短暴露窗口)
- DB 文件 root-only(envfile + SQLite 都是 0600)
- 服务只 loopback,DB 不出机

如果未来想加强,在 inkast 端用 master.key AES 加密存 + callback 时解密(增加一层,但本质仍是 plaintext round-trip)。

## 关联条目

- [v2-async-callback-protocol](../decisions/v2-async-callback-protocol.md)
- [plugin-channel](../domains/plugin-channel.md)
- [crypto-utils](../shared/crypto-utils.md) — provider key 用 AES,可参考但 callback_token 没用
