# dnd-kit 行拖拽 + 嵌套交互的标准模式

provider 配置弹窗每行带"开关 / 编辑 / 删除"按钮 + 整行可拖拽——一套经过踩坑修正的 dnd-kit 模式,后续要做类似列表(任意可排序卡片 + 行内动作)直接复用。

## 步骤

### 1. 容器层

```tsx
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";

const sensors = useSensors(
  useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
);

<DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
  <SortableContext items={list.map(x => x.id)} strategy={verticalListSortingStrategy}>
    <ul>{list.map(x => <SortableRow ... />)}</ul>
  </SortableContext>
</DndContext>
```

**关键**:`activationConstraint: { distance: 4 }` 让用户在拖 ≥4px 后才算"开始拖拽",否则普通 click / text-select 会被误判成 drag。

### 2. 行(整行可拖)

```tsx
function SortableRow({ id, ...props }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <li
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        "flex items-start gap-2 cursor-grab touch-none active:cursor-grabbing",
        isDragging && "z-10 shadow-(--shadow-paper-lifted)",
      )}
    >
      <GripVertical aria-hidden /> {/* 视觉抓手,非交互 */}
      <div>{...content...}</div>
      {/* 行内交互区 */}
      <div
        className="cursor-auto"
        onPointerDown={e => e.stopPropagation()}
      >
        <Switch ... />
        <Button onClick={onEdit}>...</Button>
        <Button onClick={onDelete}>...</Button>
      </div>
    </li>
  );
}
```

**关键**:行内交互区(Switch / Edit / Delete)用 `onPointerDown={e => e.stopPropagation()} className="cursor-auto"` 包裹——阻止这些按钮的点击被 dnd-kit 当成"开始拖拽"。`cursor-auto` 还原指针样式,跟外层 `cursor-grab` 区分。

### 3. handleDragEnd 乐观更新

```ts
async function handleDragEnd(event) {
  const { active, over } = event;
  if (!over || active.id === over.id) return;
  const oldIdx = list.findIndex(x => x.id === active.id);
  const newIdx = list.findIndex(x => x.id === over.id);
  const reordered = arrayMove(list, oldIdx, newIdx);

  // 单一 setState:乐观更新到最终状态,本地预测 priority = index+1
  setList(reordered.map((x, i) => ({ ...x, priority: i + 1 })));

  try {
    await reorderRemote(reordered.map(x => x.id));
    // 成功 no-op
  } catch {
    refresh();  // 失败滚回
  }
}
```

**关键**:**不要**在 await 之后再 setState 一次——会中断 drop 动画(详见 [dnd-kit-drop-animation-jitter](../pitfalls/dnd-kit-drop-animation-jitter.md))。

## 易漏点

- 没加 `cursor: pointer` 在 GripVertical → 用户不知道这行可拖
- 忘了 `touch-none` → 移动端触屏拖拽和页面滚动冲突
- 忘了 `stopPropagation` → 点 Switch 会触发拖拽,UX 崩溃
- `activationConstraint` 用 `delay` 而不是 `distance` → 桌面端拖一下要等 200ms,迟钝感强;`distance: 4` 更跟手

## 关联条目

- [dnd-kit-drop-animation-jitter](../pitfalls/dnd-kit-drop-animation-jitter.md) — 双 setState 教训
- [drag-to-top-default](../decisions/drag-to-top-default.md) — 拖拽语义来源
- [provider-pool](../domains/provider-pool.md) — 主要使用场景
