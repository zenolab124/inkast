# shadcn `DialogContent` base 含 `sm:max-w-lg`,外部传 base 级 `max-w-X` 不能覆盖

**What**: 给 shadcn `DialogContent` 传 `className="max-w-3xl"` / `max-w-[1400px]` 之类自定义宽度,sm 屏幕及以上**仍然只显示 ~512px 宽**——看起来 className 被忽略了。

**Why**: shadcn own 的 `DialogContent`(`apps/web/src/components/ui/dialog.tsx`)base class 里写死了 `sm:max-w-lg`(@ sm breakpoint 起 max-width = `var(--container-lg)` ≈ 32rem):

```ts
"... w-full max-w-[calc(100%-2rem)] ... sm:max-w-lg"
```

外部用 `cn()` 传的 `max-w-3xl` 是 **base 级 utility**,跟 base class 里的 **`sm:` 级** `sm:max-w-lg` 在 `tailwind-merge` 看来**属于不同的 conflict group**——base utility 不能覆盖 responsive variant 默认值。结果 sm 及以上屏幕 `sm:max-w-lg` 仍然生效,base 的 `max-w-3xl` 沉默。

调试时容易**误以为是 className 没传进去 / cn 没合并对**,反复查 props/cn,真正的根因是 `sm:` variant 隔离。

**Action**:
- 想覆盖 `sm:max-w-lg`,**必须用同样的 `sm:` 前缀**:`sm:max-w-6xl` / `sm:max-w-[1400px]`。tailwind-merge 在同一 responsive group 内才会去重。
- 或者把 base class 里的 `sm:max-w-lg` 从 `DialogContent` 里删掉(影响所有调用方,谨慎)。
- 不要用 `w-[95vw]` 之类硬绕过——能 work 但语义不对、容易在更小屏出布局问题。
- 已踩过的 callsite:`apps/web/src/features/plugin-gallery/PluginGalleryPage.tsx` 的 `PluginGalleryDetailDialog`,最终用 `sm:max-w-6xl` 把详情面板拉到 1152px。

**经验泛化**:任何 shadcn own 的组件 base 里只要有 `sm:`/`md:`/`lg:` variant 默认值,外部覆盖必须用同样 prefix——不只是 dialog 的 max-w,button 的 size/variant、card 的 padding 等同理。

## 关联条目

- [shadcn-primitives](../shared/shadcn-primitives.md) — shadcn own 模式 + base class 注入点
- [cn-util](../shared/cn-util.md) — tailwind-merge 的边界(responsive variant 隔离 conflict group)
- [shadcn-first-rule](../decisions/shadcn-first-rule.md) — own 模式带来的可改性 + 维护责任
- [plugin-gallery](../domains/plugin-gallery.md) — 第一个踩到的 callsite
