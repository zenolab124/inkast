# `aspect-square + object-cover` 让所有作品看起来都是正方形

## 现象

Gallery 卡片图片层用 `<Button className="aspect-square ..."><img className="size-full object-cover" /></Button>`,**所有图片无论原始比例都被强制裁成 1:1 正方形**。用户出 9:16 / 16:9 的图,在 Gallery 里全部看起来一模一样——以为是瀑布流 bug,实际是裁剪 bug。

## 根因

- `aspect-square` 强制容器宽高比 1:1
- `object-cover` 让 `<img>` 填满容器,**裁掉**超出部分(以中心为锚)

两者一起,9:16 的竖图被裁掉上下,16:9 的横图被裁掉左右,只剩一个方块。原图比例信息在 UI 上完全丢失。

## 规避

如果要"按原图比例展示"——典型的瀑布流场景——必须:

1. 容器去掉 `aspect-square`
2. 图片用 `block w-full`(让高度按原图比例自动)
3. 容器配合 `flex` / `column-count` / masonry 库布局,**接受卡片高度不一**

`apps/web/src/features/gallery/GalleryPage.tsx` 已经按这个改了。

如果**仍想要规整网格**(比如想看"作品索引"而不是"作品本身"),保留 `aspect-square + object-cover`——但要清楚:用户看到的不是作品的真实样子,只是缩略。

## 关联条目

- [css-columns-column-major](./css-columns-column-major.md) — 同次整改一起处理的另一个 bug
- [masonry-row-major-library](../decisions/masonry-row-major-library.md) — 整改的最终方案
- [gallery](../domains/gallery.md) — Gallery 当前实现
