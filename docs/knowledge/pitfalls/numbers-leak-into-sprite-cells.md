# 提示词用数字编号会被画进 sprite cells

**What**: Mood Sheet 2 第一次生时,提示词写:

> "Cells 1-6, left-to-right top-to-bottom: 1. Tense — heavy storm... 2. Romantic — sunset..."

模型把数字 **"1" / "2" / ... / "6"** **当成 cell 内要画的字渲染**进了图。每个 cell 角落或中央有醒目数字,严重破坏视觉。

**Why**: 模型把 "1. ... 2. ..." 这种结构理解成"图中要标号"。图像生成模型把"提示词里出现的文字"当成"画面上要写的字"是默认行为(除非明确禁止),数字也算文字。

**Action**:
1. 提示词**去掉数字编号**,改用位置描述:
   ```
   - Top-left: Tense — heavy storm gathering...
   - Top-center: Romantic — sunset with rose-gold glow...
   - Top-right: Nostalgic — sepia-toned vintage...
   - Middle-left: Solemn — twilight gravity...
   ```
2. 明确加 "NO numbers, NO captions, NO labels, NO text of any kind anywhere":
   ```
   - NO labels, NO numbers, NO captions, NO text anywhere on the canvas
   ```

实测:换位置描述 + NO numbers 约束后,模型完全不画数字。

**进一步**: "Cells (each exactly 341 × 341 pixels, left-to-right top-to-bottom): 1. Poster ..."这种顺序提示词里的 "1." 也可能泄漏。**绝对安全是直接用 "Top-left / Top-center / ..." 替代任何数字编号**。

## 关联条目

- [sprite-previews](../domains/sprite-previews.md)
- [edge-to-edge-no-border-prompts](../decisions/edge-to-edge-no-border-prompts.md)
- [asymmetric-cell-descriptions](asymmetric-cell-descriptions.md)
