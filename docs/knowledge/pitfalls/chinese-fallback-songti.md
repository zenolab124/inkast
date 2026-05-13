# 衬线字体让中文 fallback 到宋体

**What**: 第一版用 Source Serif 4(衬线英文字体)作为标题字体。用户反馈"标题字体不对劲、像出版社"。

**Why**: 浏览器字体匹配是**按字符 fallback** 的:Source Serif 4 不含中文字形,中文字符跳过它,落到下一个有中文字形的字体——macOS 默认是 **Songti SC**(宋体),Windows 是宋体类似的衬线。

效果就是:英文字符是 Source Serif(干净),中文字符变成宋体(过时、出版社味)。视觉极不协调。

**Action**:
- ❌ **中文绝对禁止任何衬线字体**(Songti / SimSun / Source Serif / Lora / Newsreader 等)
- ❌ 禁止 import 任何 webfont(@fontsource / Google Fonts)——零网络字体硬规则
- ✅ 统一系统字栈:`-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI Variable", "Segoe UI", "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", system-ui, sans-serif`
- ✅ 这套栈下:英文落 SF Pro / Segoe UI,中文落 PingFang SC / Microsoft YaHei,**全部 sans-serif**,完全协调

**`--font-serif: var(--font-sans)`** 是故意的:即使写 `font-serif` 也落到 sans 栈,防止任何路径意外引入衬线。

## 历史教训

此 pitfall 之后,**视觉规范红线锁定到 CLAUDE.md + paper.css 顶部注释**,见 [paper-theme-locked](../decisions/paper-theme-locked.md)。两道防线。

## 验证方法

打开 `apps/web/src/styles/themes/paper.css`,搜索 `--font-`:

```
--font-sans: ...system stack...
--font-serif: var(--font-sans);  /* 故意指向 sans */
```

`globals.css` 不能有 `@import "@fontsource/..."`、`@import url("https://fonts.googleapis.com/...")`。

## 关联条目

- [paper-theme-tokens](../shared/paper-theme-tokens.md) — 字体栈定义
- [paper-theme-locked](../decisions/paper-theme-locked.md) — 红线起源
- [update-paper-theme](../workflows/update-paper-theme.md) — 改字体的红线提醒
