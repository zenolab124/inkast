# Sprite cells 一律 1:1 正方形

Type 字段(海报 / banner / cover / character 等)曾配过 `aspect: "2:3" | "3:2"` 让 picker 卡片按真实比例显示,后来**移除所有 aspect 元数据,统一 1:1**。

## 背景

Type 字段每个 option 代表一种"图类型":
- poster 2:3 竖
- banner 3:2 横
- cover 2:3 竖
- character 2:3 竖
- avatar / logo / icon / illustration / photo 1:1
- ...

PreviewIcon 早期支持 `aspect?: AspectRatio`,picker grid 里不同 option 卡片高度不一(竖图比横图高)。视觉上**网格散乱**,grid 行高跳跃。

## 方案对比

| | aspect 分类 | 统一 1:1(选定) |
| --- | --- | --- |
| 网格视觉一致 | 差(高度跳跃) | 好 |
| 反映 type 形状 | 是 | 否(方形海报也是海报) |
| 实现复杂度 | 高(每 option 配 aspect + sprite 容器适配) | 低 |
| 生图复杂度 | 不同 aspect 用不同 sprite 网格(6×4 / 4×6) | 一律 3×3 |

## 最终选择

统一 1:1。FieldOption.aspect 字段保留(默认 1:1)但 sprite 路径忽略它,容器 aspectRatio 由 `${sprite.rows} / ${sprite.cols}` 推算(3/3 = 1:1)。

提示词中明确"each cell shows a SQUARE composition — even types that are traditionally non-square should be shown as a SQUARE version of that type"。用户的原话:"正方形海报也是海报"。

## 副作用

- Type 字段失去了"一眼区分 banner / poster 形状"的视觉线索 —— 但卡片底部有 label("Banner / 横幅"),不影响理解
- PreviewIcon SpritePreview 不需要按 option 配 aspect,代码简洁
- 未来如果想恢复 aspect 差异(比如 banner 单独画 16:9 sprite),需要把 SpritePreview 容器 `aspectRatio` 从 sprite 反推改成接受 option-level 覆盖

## 关联条目

- [sprite-previews](../domains/sprite-previews.md)
- [sprite-sheets-over-per-option-images](sprite-sheets-over-per-option-images.md)
