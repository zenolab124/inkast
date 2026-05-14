# shadcn/ui + Radix UI + cmdk

UI 组件基础设施。`shadcn/ui` 不是 npm 包,是**"own 进项目源码"**的组件库,底层是 `radix-ui`(可访问性 + 无样式 primitives) + `cmdk`(命令面板)。

## 选型原因

见 [shadcn-first-rule](../decisions/shadcn-first-rule.md)。核心理由:
- 通用交互组件(button/dialog/popover/combobox)手撸边角维护成本极高
- Radix 已验证可访问性 + 键盘 + portal + 焦点管理
- shadcn 提供"复制源码到项目"的模式,代码 own 在自己手里(可改可定制),不锁死版本
- cmdk 是 shadcn Combobox 的底层(命令搜索 + 模糊匹配)

## 安装与子依赖

`pnpm dlx shadcn@latest add <name> --yes` 一次性 own 进 `apps/web/src/components/ui/` + 装相应子依赖。

| 命令 | 装的子依赖 |
| --- | --- |
| `add button input textarea label badge card separator alert` | (基础 cva + Tailwind utilities) |
| `add popover dialog` | `radix-ui`(统一伞包,2024 末新版) |
| `add command` | `cmdk` + `radix-ui`(Dialog) |

实际 `package.json` 加进了:
```
radix-ui: ^1.4.3      // 伞包,内置 popover / dialog / slot 等 primitives
cmdk: ^1.1.1          // 命令面板
```

## 配置文件

`components.json`(已存在,Phase 1 baseline 留好):
```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "tsx": true,
  "tailwind": {
    "config": "",                   // Tailwind v4 CSS-first,空字符串
    "css": "src/styles/globals.css",
    "baseColor": "neutral",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "iconLibrary": "lucide"
}
```

`apps/web/src/styles/globals.css` 通过 `@theme inline` 把 shadcn token (`--background` / `--foreground` / `--primary` / ...) 映射到 paper.css 同名变量,**shadcn 默认样式自动走 paper 主题**,不需要手动改组件。唯一例外见 [shadcn-primitives](../shared/shadcn-primitives.md) — Dialog overlay 改成 `bg-foreground/30`。

## 关联条目

- [shadcn-first-rule](../decisions/shadcn-first-rule.md)
- [shadcn-primitives](../shared/shadcn-primitives.md)
- [tailwind-v4](tailwind-v4.md) — `@theme inline` 把 shadcn token 接到 paper
- [paper-theme-tokens](../shared/paper-theme-tokens.md)
