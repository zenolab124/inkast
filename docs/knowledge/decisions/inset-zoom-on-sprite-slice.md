# Sprite 切片 4% inset 缩放

PreviewIcon sprite 渲染时,**只取 cell 中心 ~92% 内容**(`SPRITE_INSET_SCALE = 1.08`),边缘 4% 当作余量。

## 背景

即使提示词严格要求"无外框无 gridline 边对边"(见 [edge-to-edge-no-border-prompts](edge-to-edge-no-border-prompts.md)),模型在 cell 边界仍可能:
- 一两像素跨界(画面从 cell 内延伸过分割线 1-2 px)
- cell 边缘有轻微颜色融合(adjacent cells 的色调相互渗透)

按严格 1/3 切割时,picker 卡片每个 cell 边角能看到来自邻 cell 的脏边。

## 方案对比

| | 不 inset | 内缩 4%(选定) | 内缩 8% |
| --- | --- | --- | --- |
| 边缘瑕疵 | 可见 | 看不见 | 看不见 |
| 内容完整性 | 100% | ~92% | ~85% |
| 客户端复杂度 | 简单 | 一行公式 | 同左 |
| 用户感知裁切 | 0 | 极小 | 可能"边缘内容被切" |

## 最终选择

`SPRITE_INSET_SCALE = 1.08`(4% 缩进,每边各 4%)。

公式(在 `PreviewIcon.tsx` SpritePreview):

```ts
const N = SPRITE_INSET_SCALE;     // 1.08
const col = sprite.index % sprite.cols;
const row = Math.floor(sprite.index / sprite.cols);
// 等价于:image 放大 N 倍后,让 cell 中心居中容器中心
const bgX = sprite.cols > 1 ? (100 * ((col + 0.5) * N - 0.5)) / (sprite.cols * N - 1) : 0;
const bgY = sprite.rows > 1 ? (100 * ((row + 0.5) * N - 0.5)) / (sprite.rows * N - 1) : 0;

backgroundSize: `${sprite.cols * 100 * N}% ${sprite.rows * 100 * N}%`;
backgroundPosition: `${bgX}% ${bgY}%`;
```

N=1 时公式退化为标准 `idx/(count-1) * 100%`,N>1 时 sprite 整体放大,容器只显示 cell 中心 1/N。

## 副作用

- 模型如果**整体行/列高不均**(见 [asymmetric-cell-descriptions](../pitfalls/asymmetric-cell-descriptions.md)),inset 救不了——那是位置算错,不是边缘瑕疵
- 调大 N 可能让选项预览显示不全(比如 minimalism 的"留白构图"主体在 cell 边缘,inset 把它裁掉)。4% 是实测出来的安全值

## 关联条目

- [sprite-previews](../domains/sprite-previews.md)
- [edge-to-edge-no-border-prompts](edge-to-edge-no-border-prompts.md)
- [sprite-cell-edge-artifacts](../pitfalls/sprite-cell-edge-artifacts.md)
