# 新增 image driver 模式(images / responses 之后再加 X 模式)

把第三种图像调用形态接入 inkast 的步骤——比如未来要支持 Replicate API、Recraft、Stability SDXL 等非 OpenAI 兼容的端点。

## 步骤

1. **`packages/shared/src/api.ts`** —— 扩 `ImageGenerationMode` 类型:
   ```ts
   export type ImageGenerationMode = "images" | "responses" | "replicate";
   ```
   涉及类型`ProviderCapability.extras.mode`(已是 unknown JSON),前端 ToggleGroup option list 也加新选项。

2. **`apps/api/src/drivers/image/`** —— 新建 driver 文件(参考 `openai-responses.ts`):
   - `replicate.ts`(假名)
   - 暴露 `callReplicate(provider, capability, apiKey, input): Promise<string>`
   - 内部处理:HTTP 调用 + size/quality/n/referenceImage 翻译 + 错误分类

3. **`apps/api/src/drivers/image/openai-compatible.ts`** —— driver 池循环里 dispatch:
   ```ts
   const mode = resolveMode(capability);
   const b64 =
     mode === "responses" ? await callImageGenerationTool(...)
     : mode === "replicate" ? await callReplicate(...)
     : await callProvider(...);  // images 默认
   ```

4. **`apps/web/src/features/config/ProviderConfigDialog.tsx`** —— `ImageModeRow` 的 ToggleGroup 加新选项 + `DEFAULT_IMAGE_MODEL_FOR_MODE` 加默认模型 + i18n 文案。

5. **`apps/web/src/i18n/{zh,en,types}.ts`** —— `t.config.imageMode.<mode>` 加文案 + hint 描述。

6. **测试** —— 配一个新 provider,toggle 到新 mode,生图;确认日志路径走的是新 driver(`[image] ▶ attempt … mode=<新mode>`)。

## 易漏点

- **size/quality 翻译**:Responses 模式不接受 size 参数,翻成自然语言拼到 prompt 里(详见 [ratio-wire-encoding](../decisions/ratio-wire-encoding.md))。新 mode 类似——必须明确处理 `auto / WxH / ratio:*` 三种 wire 形态
- **错误分类**:让新 driver 抛标准化错误(`network / auth / rate_limit / server / moderation / unknown`),才能纳入 [provider-pool](../domains/provider-pool.md) 的故障切换语义
- **reference image**:`input.referenceImage` 是 Buffer + mimeType + filename,新 driver 要自己处理(base64 data URL 或 multipart upload,看新 API 而定)
- **abort signal**:`input.signal` 必须透传到底层 fetch,前端取消才能干净退出
- **moderation 不切下家**:抛 `ImageGenError("moderation_rejected", ...)`,池子识别后立即停下,不 fallback

## 关联条目

- [image-mode-coexistence](../decisions/image-mode-coexistence.md) — 上层架构
- [image-generation](../domains/image-generation.md) — 上层数据流
- [provider-pool](../domains/provider-pool.md) — 错误切换语义
- [add-llm-driver](./add-llm-driver.md) — LLM driver 的对偶 workflow
