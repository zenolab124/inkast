# Sprite cells 描述长度不均导致行高不等

**What**: 生 Type Sheet 1 时,提示词描述 9 cells:每 cell 一段描述(poster / illustration / photo / icon / avatar / logo / banner / infographic / cover)。生出来发现**第一行明显比其他行短**——row 1 实际只占 ~150-180 px(预期 341),row 2/3 占了更多空间。客户端 sprite 切片按 1/3 均分时,row 1 的内容被切到 row 2,显示错位。

**Why**: 模型对**严格 1024÷3=341 像素**约束守不住。当各 cell 描述长度悬殊(infographic 详细 / icon 简短),模型潜意识把"复杂内容"塞更大空间,"简单内容"压缩。其他字段(Style / Mood / Lighting / Camera / Layout)所有 9 cells 都是**同一主体**只换风格/光照/视角,描述对等,模型自然均分;Type 字段每 cell 主体不同,描述长度不一,问题暴露。

**Action**:
1. **每 cell 描述压到 1 行,字数对等**(不要某 cell 详细某 cell 一笔带过)
2. 提示词加 "CRITICAL SIZE RULE" 段反复强调:
   ```
   - ALL 9 CELLS MUST BE PIXEL-IDENTICAL IN SIZE (341 × 341 each)
   - DO NOT vary cell heights or widths based on cell content
   - Row heights are EQUAL; column widths are EQUAL
   ```
3. 末尾再次重申 "ALL 9 CELLS ARE EXACTLY 341 × 341 PIXELS. Rows are equal height; columns are equal width."

实测:加这套约束 + 描述对等后,Type Sheet 1 严格 9 等分。

**症状识别**: 客户端 sprite picker 显示的 cell 内容像是"上一格的下半部分混入下一格的上半部分" → 几乎一定是行高不等。

## 关联条目

- [sprite-previews](../domains/sprite-previews.md)
- [edge-to-edge-no-border-prompts](../decisions/edge-to-edge-no-border-prompts.md)
- [numbers-leak-into-sprite-cells](numbers-leak-into-sprite-cells.md) — 提示词另一个隐藏陷阱
