# "Cream paper background + gridlines"提示词创造外层 paper 边框

**What**: 早期 sprite 提示词写:

> "A reference sheet of 9 art style swatches arranged in a strict 3×3 grid on a cream paper background, 1024×1024 pixels. Thin warm-gray gridlines between cells."

生出来的图整张外圈有 **~10-30 px 的米色 paper margin**,9 cells 在 paper "纸张" 中央。客户端 sprite 切片按 1/3 均分时,**抓到的不是 cell 内容,而是 paper 边框**。每个 cell 显示出来的位置全部偏移。

**Why**: 模型理解 "reference sheet on a cream paper background" 为"印刷书页",自动加 paper backing(外圈留白)。"Thin warm-gray gridlines between cells" 又让 cells 之间有 5-15 px 间距。模型守住"9 等分网格"概念,但把整体放在 paper 上 + 加 gridline,网格不再占满 1024×1024 画布。

**Action**: 提示词**禁止外框 / gridline / 任何 paper backing 暗示**:

```
ABSOLUTE REQUIREMENTS — non-negotiable:
- NO outer border, NO margin, NO padding around the canvas
- NO gridlines, NO separators, NO gaps, NO frames between cells
- NO labels, NO numbers, NO captions, NO text anywhere
- The 9 cells abut one another directly, completely filling the canvas
```

实测:换约束后模型严格 edge-to-edge,没有 paper margin / gridline。

**症状识别**: 整张图明显比 1024×1024 小一圈 / cells 之间能看到细线 / 客户端 sprite 切片显示的内容都偏左上 → cream paper + gridline 提示词在作怪。

## 关联条目

- [sprite-previews](../domains/sprite-previews.md)
- [edge-to-edge-no-border-prompts](../decisions/edge-to-edge-no-border-prompts.md)
- [inset-zoom-on-sprite-slice](../decisions/inset-zoom-on-sprite-slice.md) — 边对边后还需 4% inset 兜底
