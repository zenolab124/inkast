# 添加一个新 OpenAI 兼容 Provider

不需要改任何代码——纯 UI 操作。这个流程也适用于初始化第一个 provider。

## 步骤

1. **打开配置弹窗**
   - 右上角点 "配置"
2. **添加 provider**
   - 弹窗底部"添加 provider"按钮
3. **填表**
   - **名称**:任意,但要唯一(数据库 UNIQUE 约束),如 `OpenAI` / `aini8`
   - **优先级**:整数,**越小越先用**。常用 `1`(首选)/ `10`(备用)/ `99`(兜底)
   - **Base URL**:`/v1` endpoint(不带 `/images/generations`),如 `https://api.openai.com/v1`
   - **模型**:默认 `gpt-image-2`,各家支持的模型不一样(可能要换成 `dall-e-3` / `gpt-image-1`)
   - **API key**:`sk-...`,会被 AES-256-GCM 加密入库
4. **保存** → 弹窗自动 refresh,看到新条目

## 测试

5. **起草任意 prompt**(右栏会有 hints,不重要)
6. **点"生图"** → 等 30s-5min
7. 成功 → flash banner 绿色 + Gallery 出现新作品
8. 失败 → flash 显示具体哪家 provider 错(provider name + errorCode + 上游 body 摘要)

## 易漏点

- **base URL 不要拼错**——例:打 `elysia.h-e.top` 而真实域名是 `elysiver.h-e.top`,会被 CDN 边缘 403。
- **不要同时跑多个高优 provider**——他们都被尝试时,失败的那家会浪费时间且可能触发 429。
- **moderation 拒绝不切下家**——如果第一个 provider 拒绝了"过于不安全"的 prompt,池子不会尝试其他;改 prompt 或者带 `bypassModeration`(UI 未暴露)。
- **第三方代理可能不支持某些字段**——例 `quality: high` 不接,改 `medium`。

## 删除/编辑

弹窗列表每个 provider 行有 ✏️ Edit / 🗑️ Delete 图标:

- Edit:可改任何字段。**API key 字段留空保持原值**,填新值则覆盖
- Delete:有 `confirm()`,删了之后历史的 `generations.provider_id` 自动 SET NULL

## 关联条目

- [provider-pool](../domains/provider-pool.md) — 池语义
- [crypto-utils](../shared/crypto-utils.md) — key 加密
- [cdn-edge-403-without-ua](../pitfalls/cdn-edge-403-without-ua.md) — base URL 不通的诊断
- [openai-sdk-images](../integrations/openai-sdk-images.md)
