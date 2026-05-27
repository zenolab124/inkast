# 故障排查 Playbook

> 用户报告 "失败了 / 出错了 / 效果不对" 这种模糊问题时按这份 SOP 走。
> 目标:把模糊报告 → 具体根因 → 决策修哪里,不要在错误的方向上挖。

## 通道速记(读懂用户问的是哪条线)

| 通道 | URL | 主表 | 同/异步 | 典型用户 |
| --- | --- | --- | --- | --- |
| **Web UI** | `/api/*`(本机) | `jobs` + `generations` | 同步 + 前端轮询 | 自己用 |
| **Plugin (SnapUB)** | `/plugins/*`(公网经 nginx) | `plugin_tasks` | 异步 + callback | SnapUB 调用 |

两个通道共享底层 image driver 池 + LLM driver 池,但请求路径 / 鉴权 / 持久化都隔离。用户说 "SnapUB 那边失败了" = plugin 通道;"我自己生图失败" = web UI 通道。

## 信息源三件套

1. **SQLite DB** (`/root/inkast/data/inkast.sqlite`,jdc 上)— 宏观结果 + attempts JSON 详情
2. **journalctl** (`journalctl -u inkast-api`)— 组件级别事件,按时间排序
3. **用户的描述 / 截图 / 给的 task_id**— 第一手输入

**不要瞎猜**,三件套都查过再给结论。

---

## Step 1: 把用户的模糊问题变成具体目标

| 用户说 | 你做 |
| --- | --- |
| "最近失败了几个" | 查最近 N 小时内 `status=failed` 的 task 列表 |
| "task ink-xxx 失败了" | 直查那个 task_id |
| "生成了但效果不对(不像角色)" | 看 `success_round` + 看实际出图 + 看 `post_review_edited` |
| "看上去没触发 LLM" | 看 attempts 里有没有 trigger code → 决定按设计是否该进 rewrite |
| "RPM 配置是多少" | env `INKAST_PROVIDER_MIN_INTERVAL_MS_DEFAULT` + 各 capability.extras.min_interval_ms |
| "为什么这么慢" | 看 attempts durationMs 分布 + `[throttle]` 行的 wait 时长 |

---

## Step 2: 数据收集 SOP

### A. 查一个或几个具体 task

⚠ jdc 默认 `node` 是 v20,跟 inkast 用的 v24.15.0 不兼容(better-sqlite3 NODE_MODULE_VERSION 不匹配),**必须**用绝对路径:

```bash
ssh jdc 'cd /root/inkast/apps/api && /root/.nvm/versions/node/v24.15.0/bin/node -' <<'EOSSH'
const db = require('better-sqlite3')('/root/inkast/data/inkast.sqlite', {readonly: true});
const r = db.prepare(`
  SELECT id, status, success_round, post_review_edited,
         error_code, error_msg, prompt, attempts, rewritten_prompt,
         datetime(created_at/1000,'unixepoch','+8 hours') as ts
  FROM plugin_tasks WHERE id = ?
`).get('ink-...');
console.log('error:', r.error_code, '|', r.error_msg);
console.log('rewrites:', r.rewritten_prompt ? JSON.parse(r.rewritten_prompt).length : 0);
const att = JSON.parse(r.attempts || '[]');
att.forEach((a, i) => console.log(`  ${i+1}/${att.length} ${a.providerName} ${a.ok ? 'OK' : a.errorCode} ${a.durationMs}ms`));
EOSSH
```

### B. 找最近失败的 task 列表

```bash
ssh jdc "journalctl -u inkast-api --since '2 hours ago' --no-pager | grep '\[plugin-async\].*✗ task' | tail -10"
```

每行格式:`[plugin-async] ✗ task=<id> <error_code>: <error_msg>`

### C. 找特定 task 的链路日志(注意并发污染)

并发 task 的日志会混在一起,用 task_id grep 不一定能拿到完整链路。两种策略:

1. **按 task_id grep**(拿到锚点行,可能不全):
   ```bash
   ssh jdc "journalctl -u inkast-api --since '24 hours ago' --no-pager | grep 'ink-xxx'"
   ```

2. **按时间窗 + 关键 marker grep**(更全,但需要先知道时间窗):
   ```bash
   ssh jdc "journalctl -u inkast-api --since '2026-05-25 01:30:00' --until '2026-05-25 02:00:00' --no-pager | grep -E '\[image\]|\[rewrite\]|\[llm\]|\[post-review\]'"
   ```

### D. 看 post-review 链路实际行为

```bash
ssh jdc "journalctl -u inkast-api --since '24 hours ago' --no-pager | grep '\[post-review\]'"
```

关键标记行:
- `key=Xxx reference URLs N/M` — 加载了 N 张参考图(从 marvelsnap.pro CDN HEAD 校验)
- `✓ LLM judged in Tms · looks_like_target=true/false · instructions=NB` — review LLM 判定结果
- `✗ edit failed ... exhausted all 3 providers` — edit 通道失败
- `task=ink-xxx looks_like_target=X editApplied=X` — 最终结论

---

## Step 3: 决策树(关键判定问题)

### Q1: `error_code` 是什么?

| error_code | 含义 | 下一步 |
| --- | --- | --- |
| `image_provider_unavailable` | round 0 / round 1-3 全失败,**含至少一个非 rate_limited 错** | 看 attempts 分布 |
| `image_provider_rate_limited` | round 0 / round 1-3 全失败,**至少一个 rate_limited** | 是不是某 provider rate_limit 设太宽 |
| `internal_error` | 含 "rewrote prompt with LLM up to round 3" → r1/r2/r3 都跑了仍失败 | 正常的"努力都做了"失败 |
| `internal_error` | 含 "rewrite r1 LLM failed" → r1 LLM 自己挂了 | 看 raw 输出 |
| `internal_error` | 含 "postValidate rejected: empty 'rewritten' field" | LLM 半残输出,**helper 自动 fallover 仍救不回**才报这个 |

⚠ **`error_code` 是 plugin 层转译**(见 [plugins/errors.ts](../apps/api/src/plugins/errors.ts)),跟 inkast 内部 `ImageGenError.code` 不一一对应。**信 `error_msg` 多过 `error_code`**——v2.24 起 error_msg 含真实失败原因 + 上一轮失败。

### Q2: `attempts` 里有 trigger code 吗?

```ts
const REWRITE_TRIGGER_CODES = ["provider_blocked_content", "upstream_safety_rejected", "moderation"];
```

- **有** → 设计上**应该进 rewrite**。看 `rewritten_prompt` 是不是非空。
- **无** → 设计上**不会进 rewrite**(rewrite 救不了网络/auth 错)。这种失败跟 prompt 内容无关,该看底层 provider 健康状况。

源:[domain/generate/with-rewrite.ts](../apps/api/src/domain/generate/with-rewrite.ts) `REWRITE_TRIGGER_CODES`。

### Q3: `rewritten_prompt` 是 null 但 `error_msg` 含 "rewrite r1 LLM failed"?

LLM **进了** 但输出半残(典型:返回合法 JSON 但 `rewritten` 字段是空字符串)。v2.25 起 fallover helper 会把这种当 invalid_json,自动跳下一个 LLM backend——看 journal:

```
[llm] rewrite r1 openai-compatible:abc123… failed (invalid_json: postValidate rejected: empty 'rewritten' field) — falling over to next backend (N left)
```

如果所有 candidate backend 都给同样半残 → DB 里写 `internal_error` + error_msg 含 `postValidate rejected`。这通常说明所有 LLM 都被同一段内容卡住了——考虑是 prompt 触发了普遍的 safety 而非单 backend 抽风。

### Q4: `success_round=2 或 3` 但 `post_review_edited=0`?

**两种正常路径**:
- LLM 判 `looks_like_target=true` → review 通过,不需要 edit。看 `[post-review] ... looks_like_target=true · instructions=0B` 确认。
- LLM 判 `looks_like_target=false` 但 edit 失败 → 看 `[post-review] ✗ edit failed ... exhausted all N providers`。通常是 mode=images pool 出问题(edit 强制走 images mode,见 [domain/post-review-edit/index.ts](../apps/api/src/domain/post-review-edit/index.ts) `requireMode: "images"`)。

注意:`post_review_edited` 是数据库字段名,只反映 "edit 是不是真改了图"。不等于 "review 是否跑过"。

### Q5: `post_review_edited=null` 但 `success_round in (2, 3)`?

review **没跑**。原因可能:
- prompt 不带 `XxxYyy. Style and theme:` 这种 PascalCase 前缀 → `extractCharacterKey` 返回 null → review skip(`[post-review] skipped — no character key`)
- 6 个候选 reference URL HEAD 校验全 404 → review skip(`[post-review] skipped — no reference URLs survived HEAD`)
- review LLM 调用挂了 → 走 catch 路径,fallback 到原图 + `looksLikeTarget=null`

挖 `[post-review]` 日志看到底走哪条。

### Q6: 是不是 throttle / rate_limit 配错了?

```bash
ssh jdc "journalctl -u inkast-api --since '2 hours ago' --no-pager | grep '\[throttle\]' | tail -20"
```

每行:`[throttle] <providerId> waiting <N>ms (min_interval=<M>ms)`

- N 接近 M(都 ~1000ms 或 ~6000ms 之类的)= throttle 在工作
- N 很小(几十 ms) = 并发不重,throttle 几乎没干活
- 某 provider 仍然返回 `rate_limit` errorCode = throttle 设太宽,需要往下压

调整方式(不重启服务,walker 每次重读 DB):
```bash
ssh jdc 'cd /root/inkast/apps/api && /root/.nvm/versions/node/v24.15.0/bin/node -' <<'EOSSH'
const db = require('better-sqlite3')('/root/inkast/data/inkast.sqlite');
const row = db.prepare("SELECT p.id, pc.extras FROM providers p JOIN provider_capabilities pc ON pc.provider_id = p.id WHERE p.name = ? AND pc.kind = 'image'").get('冰');
const extras = row.extras ? JSON.parse(row.extras) : {};
extras.min_interval_ms = 2000;
db.prepare("UPDATE provider_capabilities SET extras = ? WHERE provider_id = ? AND kind = 'image'").run(JSON.stringify(extras), row.id);
console.log('updated');
EOSSH
```

---

## 附录 A: image provider 池现状 (写于 2026-05-25)

| name | mode | priority | min_interval_ms | 常见错码 |
| --- | --- | --- | --- | --- |
| cpa | responses | 1 | env 默认 (1000) | server (gpt-5.3-codex 经常限流) |
| e | responses | 2 | 6000 (10 RPM) | unknown |
| ciallo | images | 3 | env 默认 (1000) | auth (key 失效?) |
| 冰 | images | 4 | 2000 (30 RPM) | server / unknown |
| duck | images | 5 | env 默认 (1000) | **provider_blocked_content (image-review 层)** ← 这是 rewrite 链路触发的关键来源 |

cpa / e 是 responses-mode(经 OpenAI Responses API + image_generation tool),其它是 images-mode(经 `/v1/images/generations` 或 `/v1/images/edits`)。

⚠ Edit 通道(post-review 的 edit 步骤)强制 `requireMode: "images"`,所以只能用 ciallo / 冰 / duck 这 3 个 — pool 比 round 0 小 60%。

## 附录 B: LLM 池 fallover 顺序

1. 所有 enabled LLM kind capability 按 **`capability.priority` 升序**(= Web UI 拖拽顺序,所见即所得)
2. `claude-code` 兜底——仅当 builtin claude-code 在 DB 里 disabled=0 时才追加(jdc 默认 disable 它,避免每次 fallover 末尾撞"Not logged in")

每个 candidate 内:对 `invalid_json` 做 same-backend retry-once(stochastic refusal),其它 `LlmDriverError` 立刻跳下一个,`aborted` 立刻 throw。

**v2.37 变更**:env `INKAST_DEFAULT_LLM_PROVIDER_ID` 不再把指定 provider 顶到 fallover 池首位。env 只剩 `resolveLlmBackend()` 一个用途(plugin overlay 没写 `llmBackend` 时的回落)。

源:[drivers/llm/with-fallover.ts](../apps/api/src/drivers/llm/with-fallover.ts)。

## 附录 C: rewrite chain 速记

| 轮 | 角色 | 输出含哪些锚定 |
| --- | --- | --- |
| r0 | caller 原 prompt | (无,直接喂图模) |
| r1 | LLM 视觉重写 | body_anchors + palette_anchors + character_archetype 三类(force-prepend) |
| r2 | LLM 措辞重组 | 三类锚定 100% 继承,措辞重组 |
| r3 | LLM 形态最宽 | 三类锚定继承(archetype 允许泛化),服装/姿态最宽 |

每轮 LLM rewritten 后 inkast 自动 force-prepend 三行锚定 + 自动 append 两段硬约束(`HARD_CONSTRAINT_NO_TEXT` 禁文字/UI + `HARD_CONSTRAINT_SAFE_ZONE` 主体不进画面下 1/4)。

源:[domain/rewrite-prompt/index.ts](../apps/api/src/domain/rewrite-prompt/index.ts)。

## 附录 D: 部署节奏

```bash
pnpm --filter=@inkast/api build && \
rsync -avz --delete /Users/xt/workspace/cc-apps/inkast/apps/api/dist/ jdc:/root/inkast/apps/api/dist/ && \
ssh jdc "systemctl restart inkast-api && sleep 3 && curl -s http://127.0.0.1:8787/api/health"
```

部署后写一行 changelog 到 `~/workspace/cc/servers/jd-cloud/changelog.md`,格式:
```
- [yyyy-mm-dd] inkast-api 部署 v<N>:<一句话改了什么 + 为什么 + 预期效果>。<更多细节>
```

## 附录 E: 红线 / 陷阱

**凭据**(来自 `~/.claude/CLAUDE.md`):
- 禁 echo / `tail` / `cat` env 文件(transcript 留痕)
- 盲追加用 `printf 'KEY=VAL\n' >> file`,检查存在用 `grep -c '^KEY=' file`
- 看行数用 `wc -l`,看 key 名不看 value 用 `awk -F= '{print $1}' file`

**数据库**:
- jdc 上没装 `sqlite3` CLI,只能 node + better-sqlite3
- 必须用 `/root/.nvm/versions/node/v24.15.0/bin/node`,默认 `node` (v20)会因 NODE_MODULE_VERSION 不匹配挂掉
- `created_at` 是 ms epoch UTC,要 +8 北京时间用 `datetime(created_at/1000, 'unixepoch', '+8 hours')`

**判定陷阱**:
1. `error_code` 是 plugin 层转译 → 信 `error_msg` 多过 `error_code`
2. `rewritten_prompt = null` ≠ LLM 没跑过 → 看 journal `[llm]` 行
3. `exhausted all N providers` 里的 N 是 filter 后的 pool 长度 → edit 通道 `requireMode='images'` 后只剩 3 个
4. 并发任务的 journal 日志会混淆 → grep task_id 不一定全,有时按时间窗 + 关键 marker 更可靠
5. `post_review_edited = 0` 是合法状态(review 跑了但 LLM 判 OK 或 edit 失败回退),不一定是 bug

**重启行为**:
- `systemctl restart inkast-api` 会**中断所有 in-flight task**
- 中断的 task 状态保留 `running`,下次启动 `[plugin-async] recovered N interrupted task(s) — firing callbacks` 自动给 SnapUB 那边 callback 失败状态 — **不算丢数据**
- 但 in-flight 阶段已经花掉的 LLM / image 调用钱拿不回来

## 附录 F: 常用 grep 关键字速查

| 关键字 | 用途 |
| --- | --- |
| `[plugin-async] ▶ submit` | task 提交时间 + plugin 策略 |
| `[plugin-async] ▶ running` | worker 开始干 |
| `[plugin-async] ✓ task` | 成功完成 |
| `[plugin-async] ✗ task` | 失败 |
| `[plugin-async] ✓ callback` | callback 给 SnapUB |
| `[plugin-async] recovered` | 重启时扫到 in-flight task |
| `[image] ▶ attempt` | 单个 provider 尝试开始 |
| `[image] ✗ <name> failed` | provider 失败 |
| `[image] ⤵ exhausted` | 单 provider 重试用完,准备 fallover |
| `[rewrite][r1]` `[rewrite][r2]` `[rewrite][r3]` | 各轮 rewrite 阶段 |
| `[llm] rewrite r1` | LLM fallover 走过的 backend |
| `[throttle]` | rate limit 排队 |
| `[post-review]` | review + edit 步骤 |
| `[r2]` | R2 直传步骤 |
| `[plugin-async] backfilled` | 启动时把现存 r2 succeeded task 补进 `plugin_gallery_items`(只首次部署或重启后才有量) |

## 附录 G: plugin gallery 数据缺失怎么查(v2 长期表)

`plugin-gallery` Tab 自 v2 起读 `plugin_gallery_items`(独立长期表),**不再受 24h GC 影响**。

排查清单:

1. **"某张 succeeded 的图没在 gallery 里"**
   - 看 `plugin_tasks` 该行 `status` 是不是 `succeeded` / `callback_lost` 且 `image_url IS NOT NULL`(b64 模式不入 gallery,设计如此)。
   - 再看 `plugin_gallery_items` 同 id 行存不存在;不在就检查 `markTaskSucceeded` 同事务双写是否抛错。
   - 应急:启动一次 inkast-api,`initPluginAsync` 会 `backfillPluginGalleryFromTasks()` 把活着的 succeeded r2 task 补进去(幂等)。

2. **"24h 之前的图找不到"**
   - 看 `plugin_gallery_items` 创建时间 = 长期表最早一行的 `created_at`。GC 已删的 `plugin_tasks` 历史(v2 部署之前的)永远找不回来——backfill 只能补当时存活的。

3. **"分页加载不到下一页"**
   - 前端 console 看 `/admin/plugin-gallery.json?cursor=...` 的响应 `nextCursor` 是不是 null。
   - 服务端 `listPluginGallery` cursor 解析失败时按"无 cursor"处理(返回第一页),前端会陷入循环——看 sentinel 是否一直 intersect 但 `nextCursor` 没推进。
   - 验证 SQL 索引:`idx_plugin_gallery_created_at` 必须存在,`EXPLAIN QUERY PLAN` 应当用上。
