# Plugin gallery 拆独立成品表 plugin_gallery_items,跟 24h GC 解耦

v2.34 把 plugin-gallery Tab 从"24h 滚动窗口"升级为"永久作品库"。**新建独立表 `plugin_gallery_items`,在 `markTaskSucceeded(r2)` 同事务双写,完全不参与 `plugin_tasks` 的 24h GC**。否决了"延长 GC 保留期"和"只加分页"两个备选方案。

## 背景

`plugin_tasks` 表受 GC 强约束(`gcOldPluginTasks` 每小时扫一次,删终态 24h 前的行),plugin-gallery Tab 只能看最近 24h 的图——**操作员想回顾历史作品时数据已经被删了**。前端"分页"做了也救不回,DB 里根本就没数据。

## 方案对比

| | A: 拆独立成品表 | B: 延长 GC 保留期(7d/30d/永久) | C: 只加分页,不动 GC |
| --- | --- | --- | --- |
| "看所有"实现 | 永久归档 | 取决于保留期 | 24h 内分页 |
| `plugin_tasks` 影响 | 不变(仍 24h GC) | 表持续膨胀,b64-mode 任务 b64_json 字段几百 KB ~ 几 MB 长期占空间 | 不变 |
| 实现复杂度 | 中:加新表 + storage 模块 + 双写事务 + startup backfill | 低:改一个常量 | 最低:加 cursor 参数 |
| 数据可控性 | 只归档 r2 模式(有公网 URL),b64 模式不入,污染面小 | 全收(包括巨大 b64) | n/a |
| 升级路径 | 启动 backfill 把活着的 r2 task 补进新表,幂等 | 历史已删的回不来 | 历史已删的回不来 |

## 最终选择

**A**。理由:
1. **解耦保留**——`plugin_tasks` 仍 24h GC(保留运维语义、不让大字段 b64_json 长期占空间),gallery 永久(产品语义"作品库");两表语义不冲突。
2. **数据干净**——只归档 r2 模式(`image_url IS NOT NULL`),b64 模式天然过滤(字节流没公网 URL、Web 端无法重新加载,本来就不该展示)。
3. **事务原子**——`markTaskSucceeded(r2)` 用 `db.transaction()` 同事务 UPDATE task + INSERT gallery,要么都进、要么都不进。
4. **启动 backfill 兜底**——`initPluginAsync` 调 `backfillPluginGalleryFromTasks()` 把仍存活的 succeeded r2 task 一次性补进新表(`INSERT OR IGNORE`,幂等),首次部署 + 任何重启都安全。

否决 B 的关键:b64-mode task 的 `b64_json` 几百 KB ~ 几 MB,延长保留期 SQLite 单文件会撑大,且 b64 字节流本就**不能从 Web 端展示**——延长它的保留没产品价值。

否决 C 的关键:**前端分页不解决数据问题**——DB 里就没数据,加多少分页都看不到。

## 副作用

- **历史 GC 已删的回不来**——backfill 只能补当时存活的 r2 task。v2.34 部署时 jdc 上恰好有 32 条活着的 succeeded r2 task,全部成功 backfill 入库(`backfilled 32/32 task(s)`)。再早的已经永久丢失。
- **新表无 GC 上限**——长期看会无限增长。jdc 当前磁盘充裕,**刻意不加 LRU/上限,先观察**。需要时补。
- **双写引入一个潜在故障窗口**(plugin_tasks 写成功但 gallery_items 写失败)——靠 `db.transaction()` 在 SQLite 层关闭,理论上不会半成功。

## 关联条目

- [plugin-gallery](../domains/plugin-gallery.md) — gallery 域(数据源切换 + cursor 分页)
- [plugin-channel](../domains/plugin-channel.md) — `markTaskSucceeded` 调用方
- [r2-direct-upload-v2.1](r2-direct-upload-v2.1.md) — 只有 r2 路径有 image_url
