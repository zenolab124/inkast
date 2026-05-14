# 参考图生图(reference-guided generation)

把用户指定的图片作为视觉风格/主体参考,引导生成新图,保持构图、主体形态、画风一致。技术上从 `images.generate`(纯文本)切到 `images.edit`(图 + 文本)。

## 架构

```
浏览器:ReferencePicker(散文区下方 inline)
  ├── 未选 → [+ 添加参考图] 按钮
  └── 已选 → 小缩略图 + 来源标签("作品库" / "已上传") + × 移除
       │
       ▼ 点开 Dialog,两个 pane:
       ├── Gallery   → fetch /api/generations,网格选 → {kind:"generation", generationId}
       └── Upload    → file input + drag-drop,base64 → {kind:"upload", mimeType, dataBase64}
       │
       │
       ▼ submitJob({prompt, referenceImage}) → POST /api/jobs/generate
  
后端:
  routes/jobs validate referenceImage → runGenerationJob
       │
       ▼
  domain/generate `resolveReferenceImage(ref)`:
       ├── kind="generation" → getGeneration(id) → readImageBytes(imagePath) → Buffer
       └── kind="upload"     → Buffer.from(dataBase64, "base64")
       │
       ▼ driver `ImageGenInput.referenceImage = {buffer, mimeType, filename}`
       │
       ▼ openai-compatible.ts:
       │   useEdit = !!input.referenceImage
       │   if useEdit:
       │     toFile(buffer, filename, {type:mimeType}) → client.images.edit({image:file, prompt, model, size})
       │   else:
       │     client.images.generate({prompt, model, size, quality, output_format:"png"})
```

## 关键文件

| 文件 | 职责 |
| --- | --- |
| [packages/shared/src/api.ts](../../../packages/shared/src/api.ts) | `ReferenceImage` 类型(`generation` / `upload` 两 kind) |
| [apps/web/src/features/prompt/ReferencePicker.tsx](../../../apps/web/src/features/prompt/ReferencePicker.tsx) | 触发 Button + ReferenceThumbnail + Dialog (GalleryGrid / UploadPane) |
| [apps/api/src/domain/generate/index.ts](../../../apps/api/src/domain/generate/index.ts) | `resolveReferenceImage(ref)` 解到 Buffer + 元数据 |
| [apps/api/src/drivers/image/openai-compatible.ts](../../../apps/api/src/drivers/image/openai-compatible.ts) | `buildEditBody` + `client.images.edit` 分支 |
| [apps/api/src/drivers/image/types.ts](../../../apps/api/src/drivers/image/types.ts) | `ImageGenInput.referenceImage = {buffer, mimeType, filename}` |
| [apps/api/src/server/routes/jobs.ts](../../../apps/api/src/server/routes/jobs.ts) | `validateReferenceImage` 校验 + 透传 |

## 数据流要点

- **Gallery kind 不上传图**:前端只传 `generationId`,后端从磁盘读 → 省带宽 + 验证图存在
- **Upload kind 走 base64 in JSON body**:最大 8 MB(前端检查),没用 multipart form-data —— 跟现有 JSON API 风格一致
- **图片格式自动识别 mimeType**:png/jpeg/webp 都行,driver toFile 用扩展名 hint(`reference.png` / `.jpg` / `.webp`)

## 限制

- 上游 OpenAI 兼容 API **必须实现 `/v1/images/edits`** —— 不是所有第三方代理都支持,见 [pitfalls/reference-edit-endpoint-not-universal](../pitfalls/reference-edit-endpoint-not-universal.md)
- `images.edit` 不接 `quality` / `output_format` 参数(driver `buildEditBody` 只传 `model / image / prompt / size / n`)

## 主要用途

- **Sprite Sheet 2/3/4 用 Sheet 1 作参考** —— 保证主体跨 sheet 严格一致,见 [sprite-previews](sprite-previews.md)
- 用户在 Gallery 找到一张满意的图,作为新生成的视觉风格基线

## 关联条目

- [reference-image-via-edit](../decisions/reference-image-via-edit.md) — 为什么用 images.edit
- [sprite-previews](sprite-previews.md) — 主要消费方
- [image-generation](image-generation.md) — driver 的端到端
- [openai-sdk-images](../integrations/openai-sdk-images.md) — SDK `client.images.edit` 用法
