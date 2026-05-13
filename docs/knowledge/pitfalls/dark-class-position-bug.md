# 暗色模式 `dark` class 加错位置(已知未修)

**What**: 右上角"Paper · Dark" 切换按钮按了,**只有内部卡片翻黑了,body 大背景没翻**。文字也没变成反色——卡片黑底 + 深色文字 = 看不见。

**Why**: 当前 React App 把 `dark` class 加在**内部 div**:

```tsx
<div className={cn("theme-paper relative min-h-screen", dark && "dark")}>
  ...children...
</div>
```

但 paper.css 暗色覆盖选择器是:

```css
.dark,
.theme-paper.dark {
  --background: oklch(0.175 ...);
  ...
}
```

`@layer base body { @apply bg-background; }` 的 body 是 React root 的**祖先**,CSS 变量 cascade 从 `:root` 取(亮色),**取不到内部 div 上的 `.dark`**——所以 body 仍是亮色,只有 div 内部的 `bg-card` `text-foreground` 等被翻成了暗色版。

视觉结果:
- 大背景:亮米色(没翻)
- 卡片:深棕(翻了)
- 卡片内文字:暖白(翻了,在深棕上能看到)
- 但大背景上的 header / footer:亮米色背景 + 暖白文字 → 看不清

**Action**(修复方案,**Phase 1 计划内未做**):

```tsx
useEffect(() => {
  document.documentElement.classList.toggle("dark", dark);
}, [dark]);
```

把 dark class toggle 到 `<html>`,body 就在它内部,cascade 生效。

用户主动选择"暗色先放着,做完段 1/3 再修"。所以**这是已知 bug,不是设计漏洞**。

## 副作用(修了之后)

修了大背景翻黑后,还会暴露第二个问题:**当前暗色 token 调色生硬**(对比度/色调/vignette 都需要重调)。所以"修暗色"是个真正的视觉打磨项,不是 1 行代码。

## 关联条目

- [paper-theme-tokens](../shared/paper-theme-tokens.md) — 暗色 token 详表
- [paper-theme-locked](../decisions/paper-theme-locked.md)
- [update-paper-theme](../workflows/update-paper-theme.md)
