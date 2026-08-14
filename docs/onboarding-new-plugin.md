# 新客户接入 inkast(plugin overlay 工作流)

> **目标**: 把一个新客户接入 inkast plugin 通道,**不修改主线代码**
> **受众**: inkast 团队 / 接入侧运维
> **前置阅读**: [plugin-overlay.md](./plugin-overlay.md)(机制 + JSON schema)

---

## 0. 前提确认

接入新客户前,先确认目标机器已经有主线 inkast 在跑:

- [ ] inkast 主线代码已部署(`/root/inkast/` 或 `/opt/inkast/`)
- [ ] `systemd` unit 已配,启动 env 包含 `INKAST_PLUGIN_DIR=/etc/inkast/plugins`(或你的目录)
- [ ] inkast SQLite 里已配 LLM provider + image provider(用 Web UI 配)
- [ ] `INKAST_DEFAULT_LLM_PROVIDER_ID` 已指向某个 OpenAI 兼容 LLM provider
- [ ] 如果新客户要走公网调用,nginx 已配 `/inkast/` 反代(参考 [inkast-overlay-snapub/deploy/nginx-inkast-location.conf](../../inkast-overlay-snapub/deploy/nginx-inkast-location.conf))

主线还没就位 → 先做主线部署,本文不覆盖那一步。

---

## 1. 决定 plugin 身份

- **plugin id**:小写 + 数字 + `-_`,合规 `^[a-z][a-z0-9_-]*$`。建议用客户简称,如 `acme` / `client-x` / `snapub`
- **plugin token**:64 字符 hex 随机串

```bash
# 生成 token(本机就生成,不要在 jdc 上 echo 出来留 shell history)
openssl rand -hex 32
# 输出例: 3a7b... 64 字符 hex
```

token **不进任何 git 仓**——只在线下安全渠道(IM 端到端 / 1Password Secret Sharing)传递,接入完成后在部署机 env 落地一次。

---

## 2. 创建 overlay 仓

每个客户一个独立 overlay 仓(私有 OK):

```bash
mkdir ~/workspace/inkast-overlay-<客户简称>
cd ~/workspace/inkast-overlay-<客户简称>
git init
```

目录结构(参考已有 [inkast-overlay-snapub](../../inkast-overlay-snapub)):

```
plugins/<id>.json           ← 业务约束(JSON,核心)
deploy/.env.example         ← env 模板(包括 token 字段)
deploy/inkast-api.service   ← systemd 模板(如果是新机器)
deploy/nginx-*.conf         ← nginx 反代(如果要公网入口)
README.md                   ← 该 overlay 的部署 + 配置说明
.gitignore                  ← 至少 ignore .env(真实 env 文件)
```

最低要求只有两个文件:`plugins/<id>.json` + `README.md`。其它部署文件复用既有客户的也行。

---

## 3. 设计 plugin JSON

参考 [plugin-overlay.md "JSON Schema" 段](./plugin-overlay.md#json-schema)。

### 关键决策点

#### 3a. LLM 拆解 vs skip-LLM(`skipLlmExpansion`)

| | LLM 拆解(`false` 或不写) | skip-LLM(`true`) |
|---|---|---|
| 用户输入形态 | 散文 / 中文自然语言 | 已经是图模可读的 prompt(英文 + 关键词) |
| inkast 处理 | LLM 拆成结构化 JSON,enforceFields 覆盖,JSON.stringify 喂图模 | 把 user prompt 拼上 skipLlmConstraintsText,散文喂图模 |
| 总耗时 | image 生成 + 14s LLM | image 生成 |
| Token 成本 | 每张图消耗 LLM token | 0 |
| 出图一致性 | ⭐⭐⭐⭐ 字段化 | ⭐⭐⭐ 取决于输入 |
| 适用 | 调用方传的是用户原文 | 调用方已经在自己侧做了 prompt 工程 |

**snap-ub 选了 skip-LLM** 因为他们 worker 已经拼好 prompt 形式(`{character}. Style and theme: {用户输入}`)。

#### 3b. `imageDefaults`

| 字段 | 取值 |
|---|---|
| `size` | `"auto"` 让图模自己定 / provider 支持的标准或精确 `"宽x高"` |
| `quality` | `"high"` / `"medium"` / `"low"` / `"standard"` / `"hd"`(看 image provider 支持哪些) |
| `format` | `"png"` / `"jpeg"` / `"webp"` |

**snap-ub 用 `size: "622x866"`**，由固定 GPT 渠道在上传自身 R2 前生成最终尺寸 WebP。

#### 3c. `outputDimensions`(可选)

- **不设** → inkast 不 resize,把图模输出原样返
- **设** `{ width, height }` → inkast 用 sharp `cover-fit` 裁切到精确像素(主体居中)

如果上游已经按精确尺寸生成最终成品链接，就不要再设置该字段。

#### 3d. `upstreamImageUrlPassthrough`(可选)

- **不设** → 上游 URL 仍按 `imageStorage` 下载并持久化，避免临时链接进入 callback
- **设置** `allowedOrigins` → 仅 exact HTTPS origin 命中的持久 URL 可直接回调
- 与 `outputDimensions` 互斥；需要本地 resize 时不能走直链

snap-ub 只允许 `https://img.124213.xyz`，同时将 provider allowlist 固定到能返回该持久链接的 GPT 渠道。备用渠道的临时 URL 不会被误直通。

#### 3e. 业务约束语言(`systemPromptPatch` / `skipLlmConstraintsText`)

写法建议(基于 snapub 经验):

- **IP / 著名角色处理**:如果用户场景涉及 Marvel / DC / 任天堂 IP 这种,需要显式覆盖默认"通用化"指引。措辞:`"调用方是 <品牌> 官方合作生态,不要通用化角色"`
- **画面上的文字 / UI 元素禁止**:`"No text, letters, numbers, signatures, watermarks, logos"`——图模常会在没明说时塞 logo / 装饰文字
- **画幅取向**:横版 / 竖版 / 方形要明说,图模默认偏 1:1
- **SFW 红线**:务必加,即使场景看似无风险——图模在 borderline 描述下可能越界
- **场景上下文**:告诉图模"图会被 Canvas overlay 叠 X/Y/Z",图模可以合理配置主体位置

#### 3f. `enforceFields`(LLM 模式时兜底)

LLM 拆完 JSON 后浅合并覆盖。最常用:`text_elements: []` 兜底"图里不能有文字"——LLM 可能 hallucinate 出 text 字段,enforceFields 强制覆盖为空。

skip-LLM 模式下这个字段不生效。

---

## 4. 部署到服务器

```bash
# 0. 在 overlay 仓本地确认 JSON 格式合法(打个 . 试试)
cd ~/workspace/inkast-overlay-<客户简称>
cat plugins/<id>.json | python3 -m json.tool > /dev/null && echo "✓ JSON 合法"

# 1. rsync overlay JSON 到部署机
rsync -az plugins/<id>.json <server>:/etc/inkast/plugins/<id>.json

# 2. 修正 owner + 权限(rsync 默认带本机 user,要改成 root)
ssh <server> 'chown root:root /etc/inkast/plugins/<id>.json && chmod 644 /etc/inkast/plugins/<id>.json'

# 3. 把 token 写进 env file
# 注意:token 不出本机 transcript,直接在 jdc 端 echo
ssh <server> 'umask 077; read -p "token: " -s T && echo "INKAST_PLUGIN_TOKEN_<UPPER_ID>=$T" >> /root/inkast/inkast-api.env && unset T'

# 4. 重启
ssh <server> 'systemctl restart inkast-api'

# 5. 看启动日志
ssh <server> 'journalctl -u inkast-api -n 20 --no-pager | grep -E "plugins|listening"'
```

期望看到:

```
[plugins] loaded <id>.json → plugin '<id>'
[plugins] N plugin(s) loaded from overlay dir
[plugins] loaded token for plugin '<id>' (token-len=64)
[inkast api] listening http://127.0.0.1:8787
```

---

## 5. 给对方接入信息

| 项 | 值 |
|---|---|
| **Base URL**(公网入口) | `https://<your-domain>/inkast`(走 nginx /inkast/ 反代) |
| **Base URL**(loopback) | `http://127.0.0.1:8787/plugins/v1`(同机 + ssh tunnel) |
| **Endpoints** | `POST {BASE}/images/submit`,`GET {BASE}/images/status/{task_id}`；同步文本审核可选 `POST {BASE}/moderation/text` |
| **Token** | 通过线下安全渠道交付(IM 端到端 / 1Password) |
| **协议契约** | 参见 inkast 主线 [v2 协议规范](./plugin-overlay.md)(暂未拆出,sn-ap-ub 的 [inkast-integration.md](https://github.com/<your-org>/snap-ub) 是一份完整 worked example) |

---

## 6. 验证 checklist

按顺序跑:

- [ ] **启动日志**:`journalctl -u inkast-api -n 20 | grep plugins`,确认 `loaded <id>.json` + `loaded token` 两行都出现
- [ ] **Admin dashboard**(loopback):`ssh -L 8787:127.0.0.1:8787 <server>` + 浏览器 `http://localhost:8787/admin/plugin-stats`,在"按 Plugin 拆分"卡里看到新 plugin id 行(任务数为 0 也算就绪)
- [ ] **curl 401**:`curl -i {BASE}/images/submit -X POST -d '{}' -H "Content-Type: application/json"` → HTTP 401 + `{"error":{"code":"unauthorized",...}}`
- [ ] **curl 200**:带 token + 合法 prompt 调用 → 200 + `{"task_id":"ink-...","status":"queued"}`
- [ ] **callback 回调**:等 30-240s,对方 callback URL 收到 POST + 200 ack
- [ ] **Dashboard 更新**:任务在"最近任务"出现 + 状态正确

---

## 7. 故障排查速查表

| 症状 | 看哪里 / 改什么 |
|---|---|
| 启动日志:`INKAST_PLUGIN_DIR ... cannot be read` | 目录不存在 / 权限不对。mkdir + chown |
| 启动日志:`schema validation failed for ...` | JSON 格式错。日志会指出具体字段路径 + 错误描述 |
| 启动日志:`duplicate plugin id` | 同 id 在多个 JSON 文件出现。删掉冗余的 |
| 启动日志:`env INKAST_PLUGIN_TOKEN_X matches no registered plugin` | token env 后缀拼写错(UPPER_ID),或者 plugin JSON 没加载 |
| curl 401 `missing or malformed Authorization header` | 没传 Bearer token |
| curl 401 `unknown plugin token` | token 错 / env 没加 / 没重启 |
| curl 422 `content_moderation_blocked` | 用户 prompt 触发上游审核。不重试 |
| curl 503 `llm_unavailable` | LLM provider 配置错 / capability disabled。Web UI 查 |
| curl 503 `image_provider_unavailable` | image provider 配置错 / quota 满 / 上游不通 |
| curl 504 `timeout` | inkast 内部 driver 600s 超时(基本不可能) |
| callback 重试 3 次失败 → `callback_lost` | 对方 callback URL 不可达 / handler 一直返非 2xx。对方走 `/status/:id` 兜底 |
| 任务卡 `running` 不动 | 看 image driver log:`journalctl -u inkast-api | grep "[image]"`。可能是某 provider 整批 hang |

---

## 8. 接入完成后

- overlay 仓推到对应客户的私有 git 平台
- token 不随仓提交,只在客户运维 / inkast 运维之间口头 / 1Password 留底
- 把 [inkast-integration.md](https://github.com/<your-org>/snap-ub/blob/main/docs/inkast-integration.md) 那种"对接协议文档"作为模板,给对方一份属于他们的简化版,记录:
  - 你给他的 Base URL + Token(脱敏存档)
  - 错误码处理建议
  - 联调约定
  - 异常告警渠道

## 9. 主线 inkast 升级时

只要 `InkastPlugin` JSON schema 不破坏,**overlay JSON 不需要改**。

- **小版本升级**(加新可选字段、修 bug):rsync 主线新 dist 到部署机 + restart 即可。所有 overlay 自动兼容
- **主版本升级**(schema 破坏性):主线发版前应提前公告。各 overlay 按公告自查,改 JSON,然后再升主线

接入完成后的稳态 = 主线和 overlay **几乎完全解耦**。

---

## 附录:已有 overlay 参考

| 客户 | overlay 仓 | 备注 |
|---|---|---|
| snap-ub | `inkast-overlay-snapub` | skip-LLM + GPT 精确 622×866 WebP + `img.124213.xyz` origin 白名单直链 |

新客户接入完后,在这里加一行。
