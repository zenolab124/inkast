# 响应式适配:做了三件套后整体 revert,改为以后单独做 mobile(演变记录)

响应式改动在 2 次提交后被整体撤回(commit `aabeec8`),决定以后单独做独立 mobile 版而非在桌面布局上叠响应式。

## 背景

inkast 的三栏布局(PromptComposer + PromptFieldEditor + SessionWorkspace)是典型的桌面优先设计。有一段时间尝试通过 Tailwind 响应式断点让它在窄屏也能用:

- `e873b32` feat(web): Header / Masonry 响应式 — Header icon-only 折叠 + Gallery 列数响应
- `876f671` feat(web): Draft 三栏布局响应式 — 三栏在窄屏堆叠为单栏
- `cea9516` chore(public-web): 同步主线响应式改动 — 公开版同步上述改动

## 问题

用户实测后反馈效果差。核心原因:

1. **既不像桌面也不像 mobile**:折叠后的布局把桌面三栏堆成竖列,没有为触摸操作重新设计交互——tab 太小、滚动区域割裂、操作路径和手机用户预期不符
2. **打补丁成本递增**:三栏 + 手风琴 + 字段编辑器 + Gallery 瀑布流每处都要加断点,改动散落在多个组件里,改一处另一处又出问题
3. **破坏桌面体验**:原来干净的桌面布局被 `sm:` / `md:` 条件样式污染,可读性下降

结论:与其打补丁让桌面版"勉强能用",不如直接为手机做一套交互重新设计的 mobile app(底部 tab / 全屏 sheet / 手势)。

## 最终选择

`aabeec8` 一次性 revert 上述 3 个提交,涉及 4 个文件(`apps/web/src/App.tsx`、`apps/web-public/src/App.tsx`、两个 `GalleryPage.tsx`),共撤回 33 行改动。

```
revert commits:
- cea9516 chore(public-web): 同步主线响应式改动
- 876f671 feat(web): Draft 三栏布局响应式
- e873b32 feat(web): Header / Masonry 响应式
```

**目前状态**:inkast 是纯桌面 app,没有响应式断点,在窄屏不做任何优化。未来 mobile 支持将作为独立项目规划,交互从零设计,不复用桌面组件树。

## git history 意义

revert commit 保留了历史:`e873b32` / `876f671` / `cea9516` 里的响应式实现可供以后参考,`aabeec8` 的 revert message 说明了撤回理由。重做 mobile 时跑 `git show e873b32` 可以看到上次的尝试,避免重踩同一个思路。

## 关联条目

- [public-edition-overview](../domains/public-edition-overview.md) — 公开版整体
- [three-column-accordion-layout](three-column-accordion-layout.md) — 当前的桌面布局决策
