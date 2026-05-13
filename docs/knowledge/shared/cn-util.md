# cn() 工具

`apps/web/src/lib/utils.ts` 导出一个 `cn(...inputs)` 工具,内部 `twMerge(clsx(inputs))`。这是 shadcn/ui 项目的标配套路:

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

## 为什么需要它

`clsx` 做条件类名拼接:

```ts
cn("base", isActive && "ring-2", { "opacity-50": disabled })
// → "base ring-2 opacity-50"  (按条件展开)
```

`twMerge` 解决 Tailwind 类名**后写覆盖前写**:

```ts
cn("p-4 px-2")        // → "p-4 px-2",twMerge 知道 px 覆盖 p 的水平方向
cn("text-red-500", "text-blue-500")  // → "text-blue-500"
```

不用 twMerge 会出现两个 `p-` 同时存在 → CSS specificity 不确定 → 视觉不稳。

## 使用方

```bash
grep -r 'cn(' apps/web/src/ | wc -l
```

几乎所有组件都用。**作为新组件的 import 起手式**——任何条件类名 / 可覆盖类名都走 cn。

## 关联条目

- [tailwind-v4](../integrations/tailwind-v4.md) — Tailwind v4 在 inkast 里的用法
- [paper-theme-tokens](./paper-theme-tokens.md) — 类名最终消费的 token
