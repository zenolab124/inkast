# 散文输入与结构化 prompt 一起持久化

一句话:用户在 PromptComposer 写的原始散文(以及 AI 扩充时哪些字段是 AI 填的)和结构化 `promptSnapshot` 一起存进 `generations` 表,Gallery 详情可以同时展示"用户原话"和"展开后的字段"。

## 背景

旧版本 `generations` 表只存最终的结构化 `promptSnapshot`(就是喂给生图模型的 JSON)。但用户希望在作品详情页看到:

- "用户最初是怎么说的"(prose)
- "哪些字段是 AI 帮忙填的"(aiFilledFields)

这两条信息只在前端 composer 里短暂存在,提交后丢失。后续要做"原始想法 vs AI 扩充"对比就拿不到。

## 方案对比

| | A. 不存,UI 不展示 | B. 存,UI 展示(选中) |
| --- | --- | --- |
| 表 schema 改动 | 0 | `prose TEXT` + `ai_filled_fields TEXT`(JSON 数组) |
| 历史记录回看价值 | 低 | 高(用户能回忆"我当时想表达什么") |
| 提交 payload 体积 | 不变 | 加几百字符 |

## 最终选择

B。改动面:

1. **schema**:`jobs` 和 `generations` 表都加 `prose TEXT, ai_filled_fields TEXT`(后者存 JSON 数组的 stringify;DB 读出后 parse)。迁移用 `PRAGMA table_info` 检测缺失列后 `ALTER TABLE`,幂等。
2. **shared types**:`GenerateImageRequest` 加 `prose?: string` 和 `aiFilledFields?: string[]`;`GenerationRecord` 同步新增字段。
3. **前端**:`App.tsx` 的 `generate()` 把当前 `input.trim()` 作为 `prose`,把 `aiSuggested` Set 转 array 作为 `aiFilledFields` 传给 `submitJob`。
4. **后端**:`createJob`、`createGeneration` 都接 prose / ai_filled_fields,从 job 复制到 generation。
5. **Gallery detail**:`GalleryDetailDialog` 上方多一行"原始想法 prose"块(3 行 clamp,可展开);字段编辑器里 AI 填的字段标 "+ AI" 徽章。

## 边界

- 老历史行没有 prose / ai_filled_fields → 列值是 `NULL`,UI 写成"未记录"/不显示徽章
- M2 路径(skip text)`prose = null`(不强制写),字段编辑器手动填的不算 AI
- 直接生图 M1 路径:`prose = trimmed`(用户的散文就是 promptText),`aiFilledFields = null`(没有 AI 扩充)

## 关联条目

- [shared-contracts](../shared/shared-contracts.md) — `prose` / `aiFilledFields` 字段
- [gallery](../domains/gallery.md) — 详情弹窗展示
- [session-workspace](../domains/session-workspace.md) — composer prose 来源
- [generate-now-raw-prompt-path](./generate-now-raw-prompt-path.md) — M1 直接生图也带 prose
