# Reference image 走 OpenAI `images.edit`

让用户能"以这张图为参考生新图",保持主体形态 / 构图 / 画风一致。技术上从 `images.generate`(纯文本)切到 `images.edit`(图 + 文本)。

## 背景

字段编辑器 + sprite 大图链路里,Sheet 2/3/4 想跟 Sheet 1 主体严格一致。仅靠提示词约束(`the apple must be identical to ...`)效果不稳定——模型对"严格还原图像主体"的能力靠**视觉参考**比靠"文字描述"强得多。

需要让用户能传入参考图,通用 inkast 场景也用得上("我有一张满意的图,生类似的")。

## 方案对比

| | 仅文本提示 | 参考图 + 文本(选定) |
| --- | --- | --- |
| 主体一致性 | 中(靠文字精度) | 高(视觉传递) |
| API 支持 | 通用 | 需上游实现 `/v1/images/edits` |
| 实现复杂度 | 0 | 中(类型 + UI + Buffer 解析) |
| 用户控制 | 文字描述 | 直接给图最直观 |

## 最终选择

加 `ReferenceImage` 类型,driver 分支调 `client.images.edit`。

```ts
type ReferenceImage =
  | { kind: "generation"; generationId: string }    // 复用 Gallery 历史图,不传字节
  | { kind: "upload"; mimeType: string; dataBase64: string };  // 上传新图(≤8 MB)
```

后端 `resolveReferenceImage` 把 wire 格式转 Buffer + mimeType + filename;driver `buildEditBody` 用 OpenAI SDK `toFile` 包成 Uploadable 传 `client.images.edit`。

前端 ReferencePicker:Dialog 内两 tab "从作品库选" / "上传",已选状态显示缩略图 + 来源标签 + 移除按钮。

## 副作用

- **不是所有 OpenAI 兼容代理都实现 edits endpoint** —— 见 [pitfalls/reference-edit-endpoint-not-universal](../pitfalls/reference-edit-endpoint-not-universal.md)
- `images.edit` 不接 `quality` / `output_format` 参数(driver buildEditBody 只传 model/image/prompt/size/n)
- 上传走 base64 in JSON,8 MB 限制(前端检查),没用 multipart form-data —— 跟现有 JSON API 风格一致
- jobs 表暂未存 reference_image_id 关联,刷新页面后参考图选择会清空(submitJob 时重新选)

## 关联条目

- [reference-image](../domains/reference-image.md) — 实现
- [sprite-previews](../domains/sprite-previews.md) — 主要消费方:Sheet 2/3/4 参考 Sheet 1
- [reference-edit-endpoint-not-universal](../pitfalls/reference-edit-endpoint-not-universal.md)
- [openai-sdk-images](../integrations/openai-sdk-images.md)
