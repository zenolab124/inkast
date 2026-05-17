# 第三方库准入策略(CLAUDE.md 硬条目)

一句话:CLAUDE.md "视觉规范 → UI 组件库" 红线段后追加 "第三方库准入" 段,明确**功能型库可以按需引入**,防止后续 agent 把通用准则"少加依赖"过度泛化成项目级硬约束。

## 背景

某次会话中(masonry 选型对话)我把通用准则 "Don't add features beyond what the task requires" 错误地引用为"CLAUDE.md 里有'不引入新依赖'红线",并据此把"引入 react-masonry-css"列为"违反偏好"。用户追问后核查:**CLAUDE.md 里压根没这条规则**——是我脑补出来的。

事实上代码里早就在用 `@dnd-kit/*`、`lucide-react`、`@anthropic-ai/claude-agent-sdk` 等功能型库。但只要规则没明确写,下次 session 我或别的 agent 又可能犯同样的错误。

## 方案对比

| | A. 不动 CLAUDE.md | B. 加正向条目(选中) |
| --- | --- | --- |
| 防止后续误推断 | ✗ | ✓ |
| 文档累赘 | 0 | 一段(~10 行) |
| 维护负担 | 0 | 极低 |

## 最终选择

B 加正向条目,位置在"视觉规范 → UI 组件库"红线段后:

```
### 第三方库准入(避免被过度泛化的"少加依赖"误导)

- UI 通用组件 → shadcn 优先(见上文"UI 组件库"红线)
- 功能型库(布局、拖拽、瀑布流、表单状态、日期、动画等)→ 按需引入,
  只要它成熟、维护活跃、bundle 体积合理。无需"先讨论再加"。
- 已用先例:@dnd-kit/*、react-masonry-css、lucide-react、@anthropic-ai/claude-agent-sdk
- 红线仍在:不引入会触发字体下载的库(@fontsource / 字体加载器),
  不引入和 shadcn 功能重叠的 UI 组件库(MUI / Ant Design / Chakra 等)
```

## 为什么用 "正向条目" 而不是 "纠正条目"

- 没有可纠正的规则——它从来不存在
- 正向条目可被 grep("准入"/"admission")锁定,后续 agent 推断"不准引依赖"前会先撞上这条
- 跟 [shadcn-first-rule](./shadcn-first-rule.md) 形成互补:UI 通用组件用 shadcn,其它功能用合适的库

## 关联条目

- [shadcn-first-rule](./shadcn-first-rule.md) — UI 组件库红线
- [masonry-row-major-library](./masonry-row-major-library.md) — 直接触发本决策的事件
