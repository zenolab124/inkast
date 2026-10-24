# Plugin Overlay 机制

inkast 主线产品提供 **plugin 通道**(把生图能力以 token 鉴权 + 异步 callback 协议暴露给外部接入方)。

具体的客户 plugin **不在主线代码里**——主线启动时通过 `INKAST_PLUGIN_DIR` env 指向的目录加载 JSON 配置。

## 设计原则

> **客户特化 = 配置数据,不是代码 fork**

| | JSON overlay(本机制) | Git 分支 fork |
|---|---|---|
| 主线代码污染 | 0 | 0(branch 里加文件) |
| 主线发版 | overlay 自动兼容 | 每个 branch 都要 merge |
| 客户数量增加 | 线性 | 指数级(fork hell) |
| 客户改主线代码 | 不允许(必须主线加 hook) | 允许 |
| 业界惯例 | SaaS / PaaS / 企业软件 | 开源分发 |

## 加载流程

```
inkast-api 启动
  ↓
读 env INKAST_PLUGIN_DIR (= /etc/inkast/plugins 推荐)
  ↓
扫目录下 *.json
  ↓
逐个 JSON.parse + zod 校验
  ↓
注册到 in-memory registry
  ↓
扫 env INKAST_PLUGIN_TOKEN_<UPPER_ID>
  ↓
token → plugin id 映射就绪
```

## JSON Schema

```ts
{
  // 必填
  id: string;                        // 小写 + 数字 + - _,如 "snapub"
  name: string;                      // 人类可读名
  galleryLabel?: string;             // 结果页短标签,最长 24 字符
  scenePlugins?: Record<string, string>; // 同一 token 下按 scene 委派到另一 overlay 输出配置
  imageDefaults: {
    size?: string;                   // "auto" | "1024x1024" | "1024x1536" | ...
    quality?: string;                // "high" | "medium" | "low" | "standard" | "hd"
    format?: "png" | "jpeg" | "webp";
    background?: "transparent" | "opaque" | "auto";
  };

  imageProviderIds?: string[];       // provider 白名单；[] 为关闭
  imageProviderOrder?: "allowlist"; // 可选：按上面数组顺序 fallback；省略走全局 priority

  // 可选
  systemPromptPatch?: string;        // LLM 模式: 追加到 system prompt 末尾
  enforceFields?: Record<string, unknown>;  // LLM 输出后强制覆盖
  lang?: "zh" | "en";

  skipLlmExpansion?: boolean;        // true = 跳过 LLM 拆解,直接散文 prompt
  skipLlmConstraintsText?: string;   // skipLlmExpansion=true 时拼到 user prompt 后面

  outputDimensions?: {
    width: number;
    height: number;
    fit?: "cover" | "contain-alpha"; // 省略时沿用 top-cover；透明 PNG/WebP 可选 alpha-aware contain
    paddingPercent?: number;           // contain-alpha 每边安全边距，默认 4
    maxCornerAlphaRatio?: number;      // 任一 10% 角区最大污染率，默认 0.02
  };

  upstreamImageUrlPassthrough?: {     // 显式允许 provider 持久 URL 直通 callback
    allowedOrigins: string[];         // exact HTTPS origins，如 https://img.example.com
  };                                  // c2i 按请求选 R2；命中直回，fallback 仍可走 outputDimensions

  llmBackend?:                       // 单 plugin 想指定专属 LLM provider 时用
    | "claude-code"
    | { kind: "openai-compatible"; providerId: string };

  llmExpansionConcurrency?: number; // 该 plugin 的散文→JSON 并发上限(1..25);
                                    // 等待不占 25 路生图 worker

  visionTasks?: Record<string, {     // 可选：独立结构化视觉任务；不配置即关闭
    systemPrompt: string;           // 服务端固定规则，不接受客户端覆盖
    outputSchema: Record<string, unknown>; // JSON 对象 Schema，加载时编译校验
    providerIds: string[];           // 1..4 个准入 API provider，最多调用 2 次
    maxImages?: number;             // 1..6，默认 4
  }>;
}
```

字段含义详见 [apps/api/src/plugins/types.ts](../apps/api/src/plugins/types.ts)。

zod 校验定义在 [apps/api/src/plugins/loader.ts](../apps/api/src/plugins/loader.ts)。

## 结构化视觉接口（2026-10-24，JDC 已部署）

`POST /plugins/v1/vision/{任务名}` 复用调用方 Bearer Token，只能调用本 plugin 的 `visionTasks`，不接受原始 plugin ID、自定义提示词、Schema、模型或思考强度。使用现有专用域名时，Nginx 的既有 rewrite 对应 `/vision/{任务名}`。它是供后台 Worker 使用的同步原语，不创建生图任务、不调用图片 Provider，也不替代业务端的持久化队列。

- 请求：`{images:[{url:"..."}], context:{...}}`。图片按任务规则约定顺序；context 仅作数据。body 上限 16 MiB，context 序列化不超过 96,000 字符。支持校验 MIME/格式的 PNG、JPEG、WebP data URL（单图解码上限 4 MiB、1600 万像素、拒绝多帧），或 plugin 的存储 origin、`sourceImageHosts`、上游持久直链白名单内的 HTTPS URL。服务本身不抓取这些远程 URL，由视觉上游接收。
- 成功：`{data, duration_ms, attempts}`。data 由配置 Schema 再次校验；attempts 包含 providerId、model、实际请求的 reasoningEffort、上游 requestId／completionId／HTTP 状态、耗时、结果与 Token 用量。outputTokens 已含推理 Token，不重复相加；上游缺失的用量保持 null，不推断零费用。失败响应也返回已取得的回执；网络中断时仍可能不知道上游是否已计费。
- 思考强度固定 `high`，覆盖 provider extras；仅尝试 allowlist 内启用的 API provider，排除明确标记 `supportsVision:false` 的渠道，绝不回退本机 ClaudeCode。allowlist 是操作员对视觉能力的显式准入声明；未知模型能否看图仍需接入验收。每个请求最多两次上游调用，SDK 隐式重试关闭，合计 480 秒期限。格式不合法可重试，调用方不得无限重放。
- 全局最多 4 个、每 plugin 最多 2 个进行中请求；满载返回 `429 + Retry-After:5`。技术失败为 503，超时为 504。这里不排队、不落盘，不承诺中断恢复或业务幂等，外层 Worker 应持久化阶段并控制重试。

LLM 通用驱动仍尊重 provider 的 `extras.reasoning_effort`；可信服务端调用可用 `reasoningEffort` 显式覆盖。配置页没有该选择器，但编辑 provider 时保留未展示的 extras。不能给不支持推理参数的模型统一强加 high；当前生产渠道配置见基础设施文档，不以源码或历史文档推断线上模型。

部署核对：shared/API 构建与 67 项 API 测试通过；生产切换前 Plugin/Web 均零在途，重启后健康正常，61 个 API 构建文件与 SNAP-UB overlay 哈希回读一致，4 份插件配置全部加载。无凭据请求 401，带合法插件凭据但空图片的请求 400，未调用模型。回滚包 `/root/inkast/releases/20261024-v2-vision-high` 保存旧 dist、API package、lockfile 与 snapub overlay。Web UI 未修改、未重建。

同轮真实请求暴露了缓冲式上游长请求问题：两次调用方约 129 秒先报错，而网关后台分别在约 133／162 秒完成并计费。视觉专用调用已改用上游 SSE（含 usage），拼接完整 JSON、要求正常 stop 后再校验；旧非视觉调用保持原方式。流式修订再次通过 67 项测试与构建、部署哈希回读，修订前驱动另存 `/root/inkast/releases/20261024-v2-vision-stream`。后台 Worker 应同机或经私有连接调用本同步接口；上游流式并不改变 Inkast 对调用方仍一次性返回 JSON 的契约，不能据此宣称公网长同步请求已解决所有代理超时。

固定六图联调完成：模型调用均由 Inkast API 承担，取得回执／网关审计的请求均为 `gpt-6.1-sol + high`；Mac CPU 继续执行原分割与合成。原始批次 4 张通过、1 张待修复、1 张检查连接失败，976.264 秒墙钟、平均 290.050 秒／张。失败张的同图补验另耗 56.091 秒，确认分割与截断缺陷，仍不通过。正式批次网关已知计账 $0.837718；另有一次连接失败费用未知。补验 $0.0525636，首轮排障 $0.272240，独立计数。证据在 SNAP-UB 的 Git 忽略目录 `temp/ai-variant-v2-inkast-20261024/`；该结果不代表图片 Worker 已部署、小程序已接入或六图全部通过。

## 加新客户接入

1. 新建一个 git repo `inkast-overlay-<客户>`(私有 OK)
2. `plugins/<客户>.json`:按上面 schema 写一份配置
3. `deploy/`:systemd unit / nginx location 模板 / .env.example(参考 inkast-overlay-snapub)
4. 部署:
   - 主线 inkast 已在 jdc/部署机 → rsync 主线代码到 `/opt/inkast`(或类似)
   - overlay 仓 → rsync `plugins/<客户>.json` 到 `${INKAST_PLUGIN_DIR}/`
   - systemd env 文件加 `INKAST_PLUGIN_TOKEN_<UPPER_ID>=<64-char hex>`
   - `systemctl restart inkast-api`
5. 验证启动日志:`[plugins] loaded <客户>.json → plugin '<id>'` + `[plugins] loaded token for plugin '<id>'`

**主线代码 0 改动**。

## Token 管理

Token **不进 JSON**,**不进 git**。生命周期:

- 生成:`openssl rand -hex 32`(部署期一次性,在部署机直接生成或线下安全渠道传递)
- 持久化:**envfile only**(`/root/inkast/inkast-api.env`,chmod 600,owner root)
- 轮换:改 env file → `systemctl restart inkast-api`
- 撤销:删 env 那一行 → `systemctl restart inkast-api`

同一产品需要多种输出规格时，不必为每个规格发 token。基础 plugin 可配置
`scenePlugins`，例如 `{ "diy_logo": "snapub_logo" }`；调用方继续使用基础 plugin
的 Bearer Token，只在 submit body 传受控的 `scene`。服务端只接受 overlay 明确列出的
映射，不接受调用方直接传 plugin id；任务轮询也沿用同一 token。

## 限制

JSON 不能表达**代码**。如果未来某客户需要:

- 自定义 image post-processing(除了 sharp resize 之外的滤镜 / 水印 / 拼贴)
- 自定义错误码 mapper
- 自定义 callback body 结构
- 自定义 prompt 拼装逻辑

那时**主线提供 hook 扩展点**:

```ts
// 假设的未来扩展
{
  ...
  hooks: {
    postProcessImage: "snapub.add-watermark",   // 主线代码里有具名实现
    callbackBody: "snapub.legacy-format"        // 同上
  }
}
```

主线维护 hook registry。**绝不允许 overlay 直接注入 TS 代码**(那样就回到 fork 模式了)。

## 主线接口 versioning

`InkastPlugin` schema 升级原则:**只加字段、不删 / 不改语义**。

- minor 升级(加可选字段):所有 overlay 自动兼容
- major 升级(破坏性):同步在 overlay README 标注,各 overlay 自查升级

2026-10-24 后续恢复联调：公网先出现 Tunnel 530，随后上游 524；网关审计显示调用方失败后仍有约 306／325 秒完成的记录，因此将视觉期限从 180 调至 480 秒（Worker 510 秒），67 项 API 测试、构建与 61 文件哈希回读通过。试验临时将仅有 LLM capability 的 `sub` 传输改为 JDC loopback18318 → Mini loopback8318 的受限 SSH 连接，服务端两机直连不经过操作者 Mac；同一网关、凭据、模型与 high 保持。试验结束已条件恢复原 provider 地址，移除临时 launchd 任务、监听及授权键；480 秒期限保留。六图原批 3 张模型放行／3 张运行失败，其中第 1 张复看仍漏检；第 6 张独立恢复已实际补矛尖并完成两轮重合成，最终因矛杆回框硬截面保留 needs_review。临时 peer 曾有 No route to host／断链，不能称网络稳定性已解决。外层仍同步返回，不作为小程序接入方案。

同轮确认 Worker 的 Node 内置 fetch 还有独立 300 秒响应头期限，单改 AbortSignal 不足以覆盖。Worker 已改用原生 HTTP、显式 510 秒连接／总期限，错误回执仅保留安全的传输错误代码；本地延迟响应头测试与实跑回执分开记录，不以单元测试替代长等待验证。

### 静态 V2 试用队列（2026-10-24）

`/plugins/v1/v2` 仅供 snapub 的服务端调用：config、jobs 提交／状态、worker claim／renew／defer／finish／image。SQLite 事务保证提交幂等、滚动 24 小时三次、同原图两次及全局 16 个在途上限；同用户可连续提交，按入队顺序串行处理（同毫秒按SQLite入库顺序），前一张终结后才领取下一张；180 秒租约、最多三次失联重投。Worker 的代码／权重／边框／API 身份改变时不重放旧在途任务，防止清零视觉调用预算。

检查连接暂错可经 Worker 专属 `POST /worker/:id/defer` 退回 `queued / check_retry_wait`，沿用原任务ID、来源、已累计投递次数和处理版本；用已有 `lease_until` 保存60–300秒的冷却期限，无新增数据库字段。队头冷却期间，该用户后续任务等待，其他用户可以继续。重复确认不延长冷却；旧租约、非检查阶段或超界冷却请求被拒绝，三次投递用完后明确失败。客户端不能调用该入口，Worker仍需插件凭据、独立证明和有效租约。Worker按哈希复用分割／构图／合成检查点，每轮最多两个检查请求，每个检查阶段累计最多六个、整个任务最多十二个视觉请求，未知回执也占预算；永久错误不进入延迟恢复。候选或检查点缺失／变化时停止，不自动重建阶段。

只有检查通过的 1280 RGBA PNG 才上传 R2；接口仅裁透明留白并回传原画布及裁边几何。框内备用和 needs_review 不交付为成功。用户所有权由调用云对象校验并散列；插件 token、Worker 证明和租约均不下发小程序。免费试用不读写能量。

队列开关／发布版本为 `INKAST_V2_ENABLED`、`INKAST_V2_REVISION`；Worker 需携带同一发布版本。可用固定 loopback `INKAST_V2_PEER_BASE_URL=http://127.0.0.1:18318/v1` 与精确 provider ID，为 v2_plan／v2_review 单独覆盖传输路径；保留同一 API key、模型和 high，不改变普通 LLM 调用或数据库 provider 地址。Worker 是 Mini launchd 服务，通过受限 SSH 接入 JDC；非本机 Codex Agent。

V2 独立任务历史由 `GET /plugins/v1/v2/jobs` 提供，必须携带 owner 哈希头，按插件与所有者双重过滤。每页默认12、最多24，使用时间与任务ID复合游标；成品按完成时间，其余状态按提交时间排序，保留所有失败／重试记录。返回公开任务字段，排除 owner_key、lease_hash 和租约令牌。调用云对象还需按当前用户核对原作品及根作品未删除，剔除失效来源；不把 V2 插入原生图任务或公开作品池。
