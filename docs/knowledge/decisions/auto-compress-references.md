# 参考图 driver 层自动压缩(sharp 384px / WebP q60)

一句话:任何输入参考图在 driver 内部统一压成 ≤ 384px 短边 + WebP q60,**让请求 body 永远低于 anyrouter ~200KB 死亡线**。

## 背景

anyrouter 对单连接 body 大小有 ~200KB 硬上限(见 [pitfalls/anyrouter-body-size-cap](../pitfalls/anyrouter-body-size-cap.md))。用户上传的参考图 + base64 inflate 后远超这个值:

| refs 数 | 原图(WebP) | base64 body | 接通响应头? |
| --- | --- | --- | --- |
| 1 张 80KB | 80KB | ~110KB | ✅ |
| 3 张原图 | 220KB | ~295KB | ❌ 死 |
| 6 张原图 | 444KB | ~593KB | ❌ 死 |

不在 driver 层压缩 = 用户传 ≥ 2 张图就基本必死。

## 方案对比

| 方案 | 优势 | 劣势 |
| --- | --- | --- |
| **A. 不压缩,用户自己控制图大小** | 画质最高 | 99% 用户不会主动压;3+ 张图必死;反工程默认 |
| B. 让上游解码:用 `image_url` URL 而非 base64 | body 极小(只是 URL) | inkast 是本地优先,无公网图床;接入对象存储违反 Phase 1 不做云的约定 |
| **C. driver 内置 sharp 自动压缩**(选中) | 透明,用户无感;接通率 100%(< 200KB);新增依赖单一(sharp) | 不可逆压缩,画质损失(模型对参考图理解可能下降——但实测 50-75% 简单 prompt 还能成,质量影响有限) |
| D. 让前端压缩 | 跟 C 等效但分散在多处(web、API、CLI 入口) | 多入口要重复实现 |

选 C。

## 最终选择

实现在 [apps/api/src/domain/generate/index.ts](../../../apps/api/src/domain/generate/index.ts) 的 `normalizeReferenceImage`:

```ts
const REF_MAX_DIMENSION = 384;
const REF_WEBP_QUALITY = 60;

await sharp(rawBuffer)
  .resize({ width: REF_MAX_DIMENSION, height: REF_MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
  .webp({ quality: REF_WEBP_QUALITY })
  .toBuffer();
```

实测参数选择依据:
- **384px / q70 → 总 raw 154KB / body ~210KB** 临界值,偶尔仍被 RST
- **256px / q50 → 总 raw 54KB / body ~72KB** 安全但 256² 损失角色细节,模型识别度差
- **384px / q60 → 总 raw ~90KB / body ~120-160KB**(选中)兼顾接通率 + 画质

每个 ref 都会过这条流水线,无论上游格式(PNG/JPG/WebP/GIF)和大小。日志会打印 `[generate]   ref compressed: ${startBytes}B → ${compressed.length}B (${ratio}%)`。

## 副作用

- **画质降级**:某些细节(微小文字、复杂纹理)在 384px 后可能丢失。但实测对 image_generation 工具的"风格参考"用途,384px 够用。
- **CPU 成本**:每张 ref 一次 sharp 编解码,平均 < 100ms。不显著。
- **新依赖**:`sharp ^0.34.5`。已加进 `apps/api/package.json` dependencies。

## 关联条目

- [pitfalls/anyrouter-body-size-cap](../pitfalls/anyrouter-body-size-cap.md) — 为什么必须压缩
- [domains/image-generation](../domains/image-generation.md) — 落地位置
- [domains/reference-image](../domains/reference-image.md) — 参考图整体流程
