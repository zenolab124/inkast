# 主页采用三栏 + 手风琴布局

起草 Tab 永远是三栏(左 prose / 中 fields / 右 session workspace),左+中宽度通过"手风琴"动态切换。**整页锁视口高度,只允许列内滚动。**

## 背景

V1(73db628 之前)是单列垂直长滚动:散文区 → 字段编辑器(5 张卡片) → Gallery,首屏 2000px+ 高。问题:

1. 主工作循环(改字段→生图→看结果→复用→改字段)需要在不同位置间反复滚动,**视觉断裂**
2. 三种生图入口("AI 预填" + "直接生图" + 字段编辑器底部"生图")堆在同一屏,**新用户分不清三个按钮谁是真生图**
3. 散文区占据黄金视觉位置 + "AI 预填"用 primary 大按钮——视觉强调和 CLAUDE.md 决策"字段编辑器是核心"**自相矛盾**

## 方案对比

设计阶段在 [prototype/](../../../prototype/) 里画过 5 个变体(A 渐进画布 / B 阶梯指示器 / C 模式 Tab / D 左右分裂 / E 双入口卡片),最终选 D 的演化版"三栏 + 手风琴"。

| | A 渐进画布 | C 模式 Tab | **D 三栏手风琴(选)** |
| --- | --- | --- | --- |
| 视觉断裂 | 改善(右栏 Gallery 常驻) | 切 Tab 时另一侧不可见 | **彻底解决**——三件事一屏 |
| 模式选择摩擦 | 中(写完文本才出现分叉) | 高(进门就要选 Tab) | **低**——按钮表达 M1/M3,M2 是底部链接 |
| 老用户走 M2 | ⌘E 快捷键 | 切 Tab 1 步 | **1 步**(底部链接或 ⌘E) |
| 整体复杂度 | 中(网格在状态间跳变) | 高(三个 Tab 视图独立维护) | **可控**——只有左+中两列宽度变 |

## 最终选择

三栏布局 + 左+中手风琴:

```
left-wide  (默认 / M1):  grid-template-columns: 1.4fr  0.42fr 0.6fr
center-wide (M2 / M3):   grid-template-columns: 0.42fr 1.4fr  0.6fr
                         transition: 0.3s ease-out
```

**关键约束**:

- 右栏(本次工作区)始终 `0.6fr`——不参与手风琴,始终可见
- M1 直接生图**不**触发手风琴——保留"轻盈起草"轮回(写文本→生图→改文本→再生图)
- M2 / M3 都触发——一旦字段编辑器成为主角,中栏必须够宽容纳 5 个分组
- 整页 `h-screen overflow-hidden`,只有三栏内部 `min-h-0 overflow-y-auto`——避免双重滚动

## 副作用 / 后续要注意

1. **手风琴下 min-h-0 是关键** —— grid 子项默认 min-content,会撑大父容器。每个 `<section>` 必须显式 `min-h-0` 才能让内部 `overflow-y-auto` 工作。同样的坑在 GalleryDetailDialog 里也踩过,见 [dialog-grid-min-h-0](../pitfalls/dialog-grid-min-h-0.md)
2. **响应式降级未做** —— 当前是桌面优先(1500px max-width),移动端会被三栏挤死。Phase 2 需要 `md:grid-cols-1` 降级或专门移动布局
3. **解锁 = 回到起草态** —— 用户在锁定态改了字段然后解锁,字段会"消失"(中栏折叠回 stub)。字段 state 保留但 UI 不渲染。这是有意设计——解锁的语义就是"我要重新起草",不是"我要藏起来"
4. **transition 与内容 reflow** —— grid 宽度变化时,中栏内部分组卡片会 reflow。0.3s 内可能看到内容跳变。当前可接受,如需更平滑可加 `will-change: grid-template-columns`

## 关联条目

- [architecture-overview](../domains/architecture-overview.md) — 主壳全景
- [three-modes-progressive-disclosure](./three-modes-progressive-disclosure.md) — M1/M2/M3 配合手风琴的语义
- [field-editor](../domains/field-editor.md) — 中栏的 collapsed/expanded 两态
- [session-workspace](../domains/session-workspace.md) — 始终在的右栏
- [dialog-grid-min-h-0](../pitfalls/dialog-grid-min-h-0.md) — 同源 grid 陷阱
- [llm-as-accelerator-not-requirement](./llm-as-accelerator-not-requirement.md) — 推动布局重做的核心决策
