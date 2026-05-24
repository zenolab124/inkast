# Character Key 必须以 `XxxYyy. Style and theme:` PascalCase 前缀开头

## What

`extractCharacterKey(promptText)` 用正则 `^([A-Za-z][A-Za-z0-9]*)\.\s` 从 prompt 开头提取角色 key。**没有这个前缀两件事都不工作**:

1. **Rewrite r1 vision branch 退化** — `buildCharacterImageUrls` 不会生成 6 张参考图,r1 走 text-only fallback(没有图给 LLM 看,效果差很多)
2. **Post-review-edit 直接 skip** — `[post-review] skipped — no character key extractable`,所有 r2/r3 task 都跳过 review

实测 Web UI 通道(走 JSON ImagePrompt 而不是字符串 prompt)从来不带这种前缀,所以 Web UI 出图永远不走 review——这是设计预期。但 plugin 通道的 SnapUB 必须保证这个格式。

## Why

参考图存在 `https://static.marvelsnap.pro/cards/{key}.webp` 这种 URL 上,key 是 marvelsnap.pro CDN 的角色键名(PascalCase 单词,如 `IronMan` / `CaptainMarvel` / `BlackWidow` / `Daredevil`)。inkast 用同一个键名构造 URL + 同时作为 character identifier。

正则 `^([A-Za-z][A-Za-z0-9]*)\.\s` 要求:
- 字母开头
- 后跟字母或数字(可以是 `Doom2099` 这种数字结尾)
- 一个英文 `.`
- 一个空格

例:`IronMan. Style and theme: 中国水墨...` → key = `IronMan` ✓
反例:`钢铁侠. Style...` → 中文不匹配,key = null
反例:`Iron Man. Style...` → 空格分隔不匹配,key = null

## Action

**SnapUB 调用方约定**:必须用 PascalCase 单词 + `. Style and theme: ` 拼接。新角色加入时确认 marvelsnap.pro CDN 上有 `{key}.webp` 路径(否则参考图 HEAD 全 404,review 也会 skip)。

**调试 review 没跑的 task**:
```
[post-review] skipped — no character key extractable    ← prompt 格式不对
[post-review] skipped — no reference URLs survived HEAD ← key 对但 CDN 404
[post-review] key=IronMan reference URLs N/M             ← key 对且 N>0,review 真正跑了
```

journal 里 grep `[post-review]` 即可看到上面三种状态之一。

## 关联

- [post-review-edit](../domains/post-review-edit.md) — Step A 用 extractCharacterKey
- [rewrite-chain](../domains/rewrite-chain.md) — r1 vision branch 同样依赖 key
