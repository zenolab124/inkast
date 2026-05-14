# OpenAI 兼容 `/v1/images/edits` 端点不普遍实现

**What**: 参考图功能依赖 `client.images.edit()`(OpenAI 兼容 `/v1/images/edits`)。**第三方 OpenAI 兼容代理不一定实现这个端点**——很多代理只支持 `/v1/images/generations`,因为 edits 涉及文件上传(multipart 或 base64)更复杂。

如果代理没实现 edits,driver 调用直接报 404 或 405,job 标 failed。

**Why**: OpenAI 官方支持完整的 `images.generate` / `images.edit` / `images.variations`,但第三方"OpenAI 兼容"代理(尤其聚合多模型的网关)实现深度参差不齐。Edits 需要解析 multipart payload + 文件流转 + 上游模型适配(每个模型对参考图的支持程度也不一),不是所有代理都跟进。

**Action**:
1. **使用前确认 provider 支持**:从 provider dashboard / docs 查 endpoint 列表,或试调一次看响应
2. **用户视角**:如果 reference image 配上去但生图一直 failed,先看 `[tail -f /tmp/.../dev.log]` 里 `[image] → POST .../images/edits` 后面的响应:404/405 → endpoint 不支持;auth/quota → 跟普通 generate 一样问题;200 但返回错误 JSON → 模型不支持参考图
3. **退路**:暂时不用 reference image,仅依赖详细文字描述(主体一致性会降低,见 [reference-image-via-edit](../decisions/reference-image-via-edit.md))
4. **Phase 2 可加 health-check**:在 ProviderConfigDialog 加"测试 edits 支持"按钮,提前告知用户

## 关联条目

- [reference-image](../domains/reference-image.md)
- [reference-image-via-edit](../decisions/reference-image-via-edit.md)
- [openai-sdk-images](../integrations/openai-sdk-images.md)
- [pool-moderation-no-fallover](pool-moderation-no-fallover.md) — provider pool 故障切换语义
