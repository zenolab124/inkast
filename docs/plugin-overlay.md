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

## Codex 图片通道（2026-10-29，本地适配与隔离试验）

ChatGPT2API 的 Codex 图像能力沿用 `c2i-tasks`，使用独立 provider，模型可选 `pro-codex-gpt-image-2.5`；普通 `gpt-image-2.5` 仍是网页别名。新 provider 建议设 `extras.explicitAllowlistOnly=true`，只放入测试调用方的 `imageProviderIds`，名单中不混入网页渠道，避免测试失败后悄悄换回旧通道。模型别名仅证明请求选择，实际图片引擎仍以上游证据为准。

- Codex 不调用网页 `resume-poll`；超过五分钟继续查询原任务。普通网页保留原续轮询行为。
- Codex 默认 `optimize_output=false`，保留原图、不由上游追加精确裁切或有损压缩；原网页默认仍为 true。能力可用布尔 `extras.optimizeOutput` 显式覆盖。尺寸与 high 属于请求要求，必须解码实际结果核验，不能靠参数回显判定。
- 字节请求用 Base64，不写上游 R2；持久链接显式使用 R2。透明 PNG、参考图编辑、3D 图层和最终构图分别验收，不随普通生图一并放行。
- Web Job 与普通插件向驱动传内部持久任务身份，c2i ID绑定调用身份、provider和实际请求指纹；重试先查原ID，只有上游明确声明durable-v1且确认该ID不存在时才允许同ID提交。提交回执丢失继续查询原ID；结果未知保留ID到失败attempt/message并停止图片池重试与切换，不新建替代图片。普通任务的既有重启失败回调策略未改，不宣称新增自动恢复入口；3D沿用自身冻结图层检查点。

本地已新增独立`ChatGPT2API Codex Pro` provider，显式白名单准入，原渠道配置保持；145项API测试及源码／测试类型检查通过。真实隔离试验复用维纳斯正式任务创作描述：普通插画在301.941秒因上游`IncompleteRead(2883045 bytes read)`失败；透明前景在377.809秒生成成功、端到端391.235秒，原PNG为1122×1402、带Alpha、约1.82MB，R2回读及完整解码通过。日志核实Codex/Pro，主请求`gpt-6.1-sol`、工具请求`gpt-image-2.5-sunburst`；实际图片引擎版本仍未证实。新图比此前样本多了现有全局清洁度尾句，不能当作只换模型的严格A/B。顶部装饰触边、留白不足，未验收完整3D构图；背景编辑和业务回调待实测。两次任务未重发。证据在本地忽略目录`data/codex-upgrade-20261029/`；未构建、部署或提交，线上provider与默认选择未改。

2026-10-29同任务只读排查：普通插画的`IncompleteRead`已在ChatGPT2API原任务及日志中确认，Inkast未到600秒期限、未触发网页续轮询。上游Codex读流配置1200秒，但`_iter_codex_response_events`在完整`raw.read()`后才解析SSE；HTTP分块提前结束会阻断所有事件交付。提取线上同一函数离线复现：即使接收块已有完整`response.completed`，后续HTTP分块截断仍导致零事件交付。此为确定的抗断流缺陷，不证明该失败请求本身已有完整图片，也未确定最初断连来自远端还是中间代理。应优先增量解析、保留已验证终态及结构化断流证据，再考虑扩大渠道；未新增生图或修改／重启线上服务。证据`data/codex-upgrade-20261029/incomplete-read-investigation.json`。

2026-10-29稳定性修复已在本地实现，尚未上线：ChatGPT2API改为有界增量读取，在完成图片事件中严格校验Base64及图片解码后立即保存，避免完整成品随HTTP尾段截断丢失；不把partial预览或损坏图片当成功。`CODEX_OUTCOME_UNKNOWN`、`codex_invalid_image`、`codex_result_delivery_failed`由Inkast保留原任务ID并停止渠道切换；重写轮次也遇到原任务待恢复标记时立即停止，不能改提示词后另发一张。ChatGPT2API本地494项及24项子测试通过，16项真实探针跳过；Inkast 147项API测试及类型检查通过；响应ID与阶段持久保存用于定位，因`store:false`且无Codex续取协议，不承诺远端恢复。此次没有新增生图、重启、构建或部署。

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

### 静态 3D 卡牌队列与计费版本

`/plugins/v1/v2` 仅供 snapub 的服务端调用：config、jobs 提交／状态、worker heartbeat／claim／renew／defer／finish／image。SQLite事务保证提交幂等及全局16个在途上限；能量版取消每日三次／同原图两次的旧试用限制，新增任务必须携带`billing_version=1`，缺失时拒绝；已有任务同ID重试仍幂等；同用户可连续提交，按入队顺序串行处理（同毫秒按SQLite入库顺序），前一张终结后才领取下一张；180 秒租约、最多三次失联重投。Worker 的代码／权重／边框／API 身份改变时不重放旧在途任务，防止清零视觉调用预算。

构图或检查连接暂错可经 Worker 专属 `POST /worker/:id/defer` 退回 `queued / plan_retry_wait` 或 `queued / check_retry_wait`，沿用原任务ID、来源、已累计投递次数和处理版本；用已有 `lease_until` 保存60–300秒的冷却期限，无新增数据库字段。队头冷却期间，该用户后续任务等待，其他用户可以继续。重复确认不延长冷却；旧租约、恢复类型与当前阶段不符、非视觉阶段或超界冷却请求被拒绝，三次投递用完后明确失败。客户端不能调用该入口，Worker仍需插件凭据、独立证明和有效租约。Worker按哈希复用分割／构图／合成检查点，每轮最多两个当前阶段请求，每个构图或检查阶段累计最多六个、整个任务最多十二个视觉请求，未知回执也占预算；永久错误不进入延迟恢复。分割结果、候选或检查点缺失／变化时停止，不自动重建阶段。构图延迟恢复已于2026-10-24与SNAP-UB Worker共同发布（API身份 `790871d4457712d7fe96c5c16a4a99a0daea6cc168a15498d209bc6671b18722`）；前版e03f0de7仅覆盖检查阶段。

Worker内部与上传接口继续使用检查通过的1280 RGBA PNG；接口仅裁透明留白，最终以lossless WebP（effort=6）写入R2，扩展名.webp和MIME image/webp保持一致，并回传原画布及裁边几何。这项编码改造于2026-10-25零在途协调部署；历史成功PNG的幂等回执原样保留。框内备用和 needs_review 不交付为成功。用户所有权由调用云对象校验并散列；插件 token、Worker 证明和租约均不下发小程序。Inkast不读写小程序能量；云对象事务负责每用户首次成功免费、之后每次50能量的预扣与失败返还。config返回billing_version=1、基础energy_cost=50，daily_limit/max_attempts为null；本人免费资格和下一次报价由云对象补充。2026-10-25已与计费schema/索引、variantGenerator及Worker身份协调部署，API身份`5d73e37014866f2ce25b4934b4ab60040944a7a0863563cd648f152337382515`；63文件哈希一致、服务器11项内存SQLite测试通过。开关开启但部署时Mini内存44%低于55%保护阈值，Worker暂停领取，config暂时enabled=false；资源恢复后自动恢复。未调用模型或写用户余额，未发小程序；用户要求先不提交源码，部署按本次指纹追踪。

2026-10-25 后续部署 `71b03929846063e128c794d18bbbde0815e468faaf73390f98376a91240b810c`：Worker专用`POST /worker/heartbeat`独立更新在线记录，需同一插件证明和API发布身份，既不领取也不修改任务。claim不再兼任心跳；Worker每30秒发送，包括资源等待与长任务期间，重叠请求合并、暂错后继续。最近两分钟有心跳可排队，资源不足不占租约。Mini macOS领取门槛改为正常压力+至少25%指标（小内存设备比例提高），磁盘10GiB限制保留；现场43%、pressure=1时memoryReady=true，公网enabled=true，50能量规则不变。API81项、服务器隔离13项与Mini daemon7项通过，API63/Worker16文件哈希一致；未调用模型、不更新云函数或发小程序，未提交源码。

队列开关／发布版本为 `INKAST_V2_ENABLED`、`INKAST_V2_REVISION`；Worker 需携带同一发布版本。可用固定 loopback `INKAST_V2_PEER_BASE_URL=http://127.0.0.1:18318/v1` 与精确 provider ID，为 v2_plan／v2_review 单独覆盖传输路径；保留同一 API key、模型和 high，不改变普通 LLM 调用或数据库 provider 地址。Worker 是 Mini launchd 服务，通过受限 SSH 接入 JDC；非本机 Codex Agent。

V2 独立任务历史由 `GET /plugins/v1/v2/jobs` 提供，必须携带 owner 哈希头，按插件与所有者双重过滤。每页默认12、最多24，使用时间与任务ID复合游标；成品按完成时间，其余状态按提交时间排序，保留所有失败／重试记录。返回公开任务字段，排除 owner_key、lease_hash 和租约令牌。调用云对象还需按当前用户核对原作品及根作品未删除，剔除失效来源；不把 V2 插入原生图任务或公开作品池。

2026-10-25 最终成品改用透明无损WebP，发布身份 `ce8d75c97f399f1a1486b45b49031841d14898ca2478d31f1b739bdcab8f8f95`，只有routes/v2交付编码改变，PNG输入/中间处理及裁边几何保持。API构建和81项测试、JDC本批13项隔离测试通过，63文件哈希一致。真实R2回读727×1003、651,828字节、image/webp，Alpha及可见RGB差异均为0；隔离验证未写生产用户任务。Mini仅同步身份、16源码文件不变，359份work文件清单保留，7项daemon测试通过。现有任务自然排空后切换，临时Nginx提交门禁已恢复原配置，公网enabled=true；历史PNG回执不变，无云函数/小程序发布、未提交推送。回退材料 `/root/inkast/releases/20261025-webp-delivery/`，须协调Worker身份。


### 新图直接3D的原生图层任务（2026-10-25 已部署）

`POST /plugins/v1/v2/creations`只接受id、owner_key、prompt及billing_version=1，创建`input_kind=generated`的独立任务；不要求普通原图，不接受调用方注入模型、provider或图层URL。旧`POST /jobs`仍为已有图转换。新增`INKAST_V2_GENERATION_ENABLED=true`显式门禁，config的`direct_generation_enabled`仅在总开关与Worker在线时为true；兼容旧云对象与客户端，未启用时不改变已有图任务。

SQLite给任务增加input_kind／creation_json，新增static_v2_layers保存每层检查点。Worker凭插件证明与有效租约调用`POST /worker/:id/layers/foreground|background`，每次只做有界的提交或查询，API重启后无需恢复内存中的后台Promise。以下为2026-10-25上线行为，3D前景重写的本地修订见下文“3D前景持久化重写”。生成顺序为透明前景→以该前景为参考的匹配背景；固定同一配置指纹与明确允许的c2i-tasks通道，high、1024×1536、PNG，不执行提示词改写或通道降级。首次请求前落盘确定性client_task_id，丢失提交回执后只GET原ID；上游记录丢失／内容拒绝／配置改变／45分钟超时明确失败，不换ID重生。每层只在校验PNG后保存URL及SHA-256；背景参考与Worker下载必须匹配该哈希，客户端看不到提示词、通道密钥或上游ID。

B的图层准备保留模型原生Alpha，跳过BiRefNet/SAM；视觉规划与检查仍high，并增加服务端原生图层材质规则，旧分割任务提示保持原样。两层未成功不允许交付成品，最终仍经既有1280 RGBA PNG→透明无损WebP接口。计费由调用云对象负责，直接生成整单复用每用户首次成功免费、之后50能量及失败返还，不另收普通生成费用。

API86项测试通过，覆盖生成响应丢失／服务重启查询、幂等及租约、输入私有性、失效图层／超时和原生材质提示；SNAP Worker45项及小程序／云对象29项通过，两组旧B素材离线回放通过，未调用新模型。用户授权后已构建部署，API身份`61a26ae52e5cbceb44372cd5185e210806b1c9e3686bf13438bed684175327f1`，64文件匹配，JDC Node24隔离25项通过，SQLite quick_check正常。协调云对象／作品5字段回读、Mini19文件／45项测试及原359任务文件清单后开启门禁；公网enabled/direct_generation_enabled均true，50能量保持，原Nginx按哈希恢复。微信开发版编译及实际入口／报价验证通过，未发布正式小程序、未提交推送、未新建付费生成或重跑历史任务。线上真实新B生成与手机验收仍待执行。回退`/root/inkast/releases/20261025-direct-3d/`须同步Mini身份及源码。

2026-10-25 3D资源准入按路线拆分：私有`POST /v2/worker/claim`新增可选布尔`allow_existing`（省略时兼容旧Worker，默认true）。false仅领取`input_kind=generated`，不领取已有图转换，不更改被跳过任务的状态或投递次数；同用户队头和全局单租约约束仍保留。Mini资源探测不再阻止B的生图或合成，只决定A是否可领取，探测失败也不能拦截B。性能门槛取消不影响图层校验、有限检查恢复与50能量结算。

2026-10-26固定留白检查回退已部署（当前）：用户明确前景完整不等于全身，删除32像素／6像素边带拦截和四边8%、全身要求，允许半身／近景、底部腰腹取景；抬臂提示改为保留肩—肘—手动作链及肘尖外侧空间，稍放宽上半身或肘部内收，不要求补腿脚。保留格式与透明通道、构图后的硬切检查，不自动羽化，不改拒绝处理。API106、JDC46、Mini59项通过，API65／Worker14份文件匹配，448份素材和原任务保持；公网与心跳正常。发布`61ff47e6eb7f63869427701fb9360a45a929f10eb171b9964d659606195c4aec`，证据SNAP-UB的`temp/3d-portrait-foreground-20261026/verification.json`；无新模型调用，不重跑或改旧作品。下条完整性拦截为已回退版本的部署历史。

2026-10-26原生前景完整性与拒绝分类补丁（后端已部署）：前景提示词改为完整主体／动作部件、四边8%透明余量，删除允许下半身截断；前景成功下载后先检查32像素边带，实体Alpha>128且超过6像素就以`foreground_subject_clipped`终止，不生成背景、不自动重生。该检查不能证明语义完整，但可拦明显触边截断。构图原生图层指令禁止用柔化冒充完整素材；SNAP Worker撤回未部署的自动羽化，已有图提取仍可局部处理。通用`generation_failed`携带明确相似性防护拒绝时归为`generation_rejected`，不重交／换渠道；不批量回写历史失败。API106项及Worker实际素材59项通过，真实旧截断前景已被拒绝；已部署身份`6a532798d71bd4acf9e82aa126276cca9fd511223fb5d37b5f9abbd74b7faf6c`；API65文件与Worker14份JS一致、448份素材及旧任务／图层保持，服务器46项／Mini59项验证通过，公网开关与心跳正常。无新模型调用，不覆盖旧作品或重跑旧失败；SNAP本地`temp/3d-complete-foreground-20261026/verification.json`保存证明。

2026-10-26接单恢复修订（后端已部署）：上游`durable-v1`先登记owner／ID及固定请求指纹，再后台处理内容检查与参考图；重复异内容409；无指纹旧记录只读，不从新重试绑定指纹。准备与容量失败保留可查询记录。前景回执确认该协议后，背景用既有前景URL和`X-Reference-Image-Sha256`提交，上游核验原字节后才生图；未确认新协议的旧任务保留内联字节，提交窗口25秒。失联默认GET；只有成功GET带新协议、明确missing且从未确认接单，才允许同ID／同内容有限补交，POST总计最多3次、间隔至少10秒，不刷新45分钟图层预算。已经确认入队后丢记录不重生；JSON明确拒单及时失败，HTML 403／530仍当连接不明，不误报内容拒绝。Worker与客户端新增接单／准备／排队／连接阶段，旧客户端可按普通制作中兼容。下条“不再次POST”的上线记录描述旧协议，仍为无新协议保证时的行为。API104项、JDC本次构建44项、Mini隔离44项、Mini实际素材Worker57项及小程序12项通过；一次授权审查的旧指纹缺口已修正并回归。发布`a4bf04b15ace37d360f4f7fdfe5304749eecd42f0151e3c34cbb7d9cf34135ac`，65文件与本次构建一致，仅domain/v2-layers.js变化；Mini生图2源码／2测试及14份Worker JS匹配，412份处理文件、旧队列／图层指纹保持，协议及错误哈希422拒单线上已验。公网开关、50能量与心跳正常；不恢复已退款旧任务、不改既有计费、未真实生图、不发布正式小程序、不提交。回退JDC／Mini的`releases/20261026-durable-admission/`需协调身份；生图备份在Mini项目`.codex-backups/20261026-durable-admission/`。

2026-10-25上游接单延迟与3D可观测性修复（已构建部署）：背景edit的上游会先做内容检查与参考图处理，再建立异步记录，8秒POST回执超时后，GET短暂missing不证明图片丢失。保留原确定性ID继续GET，直到现有45分钟图层总期限；不再次POST、不换渠道。图层检查点新增可选upstreamStatus/lastPolledAt/completedAt，不改表结构；监控显示等待接单、上游ID、最近查询与素材链接。旧终态失败不会被此次读取自动复活或变更账务。

独立3D任务从static_v2_jobs/static_v2_layers接入loopback监控；作品接口合并长期普通作品、已成功3D成品及已保存的前景/背景素材，统一过滤/计数/复合游标分页。artifactKind区分image/3d_card/3d_foreground/3d_background，素材不能冒充已交付卡牌；不虚构逐层计费或模型耗时，不混写普通plugin_tasks。权限边界不变，创作要求与图层只在已有本机管理入口展示，不增加公网接口。历史PNG保留其mime。

本次用户授权构建部署、旧任务保留。API身份`01ebb4541425b01b7b5a6dfa0f4357fc56e8c9326d7250982452a71840adab8b`，shared/API/Web构建及93项本地API、33项JDC本次构建隔离测试通过；65份API与18份网页文件指纹一致。Mini仅同步身份，19份源码及361份旧work文件保持。线上监控与作品页已实际打开，前景明确显示中间素材，旧成功3D成品进入作品接口；旧失败任务及图层整行指纹保持，背景旧失败检查点不自动回填。enabled/direct_generation_enabled均true、数据库quick_check正常。未更新云对象、未发布小程序、未触发生图、未提交。证据`snap-ub/temp/3d-monitor-deploy-20261025/`。

2026-10-25按用户反馈将plugin-stats普通插件任务与3D任务合并到同一“最近任务”表，按创建时间/ID倒序取全局50条；类型、3D阶段、领取次数及可展开的上游图层/成品链接保留，去掉单独3D分区。总览/按Plugin/错误/24小时趋势统一计入3D；未采集的3D阶段耗时及不适用的回调显示—，普通任务耗时/渠道/回调样本明确标注，不虚构计量。最终身份`938ec091401da4d5a15601030f4852e2b95637238d7fd439128fd88659d03e54`，API构建、本地96项及排版后7项定向测试、JDC最终36项隔离测试通过，线上65文件一致。已实际验混排表50条（当时44普通/6张3D）及展开图层。Mini仅同步身份，19源码/361work文件保持；旧失败任务指纹保持，不改账务、未提交。证据`snap-ub/temp/3d-mixed-stats-20261025/`。


2026-10-25：SnapUB静态3D可选`card_stats`仅由云对象读取校验后的国服Catalog V3冻结（region/cardKey/sourceSha256/cost/power，缺值null、0有效）。SQLite `card_stats_json`参与幂等比较，旧任务缺省保持；Worker领取时得到快照，上传PNG须携带相同快照SHA-256，匹配才记录几何`stats_baked=true`并经公开任务回包交给云对象／客户端，避免重复角标。最终仍透明无损WebP。Mini服务器取消合成后模型终审，构图high与程序检查保留；已部署身份`4563626e0dd34afff80aaaf38f0896ab0fb998021235b96a00625c213a720643`，65文件匹配、API96／JDC36／Mini54项测试通过。没有新模型实单或正式小程序验收，源码未提交；回退与证据见基础设施Inkast记录和SNAP-UB `temp/3d-stats-deploy-20261025/`。


2026-10-26并发规则（后端已部署，开发版已编译）：`generated`全局5、`existing`全局1，独立有效租约计数，在SQLite事务内领取；直接生成允许同用户并发，已有图仍按同用户FIFO与资源准入。Worker claim新增`allow_generated`及最多6个`exclude_ids`，本机仍处理的任务既不重新领取，也不因本机继续领取其他任务而被过期清理。Mini单进程可同时推进5＋1张，云端等待重叠，本地合成串行。已有图新建权限由云对象管理员鉴权拒绝，Inkast插件密钥不下发客户端；普通用户直接生成及历史同步／结算保持。API98项、JDC本次构建38项、Mini实际素材56项、小程序／云对象41项测试通过。发布`f49ad391d706d55f2406edd25ed80834fe1b410116222b85493bd63df7093c30`，65文件哈希匹配，现场4张原有任务同时运行（1张背景查询、3张前景生成）；原背景等待单在确认无构图检查点及前景哈希后受控交接，原上游ID／预算与账务保持，接管保留原投递计数且领取后计为2。未运行Agent审查、未发布正式小程序或提交，不把并发状态视为成品验收；回退与证据见SNAP-UB `temp/3d-concurrency-deploy-20261026/`及基础设施记录。

该并发发布的收尾复查：4张原任务重叠后，2张前景收到上游第三方内容相似性防护拒绝（generation_rejected），另2张仍在处理；未返回并发超限，未自动重试／改写／换渠道，不能据此声称4张成品通过。

2026-10-26裁切端遮挡规则修订（本地验证，尚未构建部署）：服务端对`v2_plan`／`v2_review`统一追加层级规则，适用于已有图提取与原生双图层两条路线。真实截断端须完整留在框内或由边框实际覆盖，不能叠在框上，也不能仅用柔化代替遮挡；完整头、手、发丝、持物仍可出框。Worker同步以实际源边界触边和实框覆盖建立不可被许可补全重开的遮挡区，角标命中裁切端时整体保留在上；盖不到的截面仍由程序终检拒绝，提示构图调整。未恢复模型终审或固定留白检查，不修改计费与并发。API106项、Worker实际素材62项通过；黑寡妇原前景与原构图离线回放右肘截面外露为0、左侧及底部不变，0次新模型调用，不替换线上旧作品。证据见SNAP-UB `temp/3d-cut-behind-frame-20261026/`。

2026-10-26固定方形交付修订（本地验证、未构建部署）：3D上传仍接收1280×1280透明PNG，最终固定导出中央(128,128,1024,1024)无损透明WebP，不再按Alpha边界动态裁边；框与角标沿用原生V2坐标。上传前拒绝交付方形外的任何非零Alpha（含极淡能量），不写R2／不结算成功；旧成功链接及几何不回写。构图系统提示统一要求实际可见内容留在DESIGN [0,1]，Worker对仅少量越界可做一次≤16工作像素的原画平移并重验全部程序约束，框不动、不加模型调用。API106项、Worker63项及小程序几何／导出5项通过，黑寡妇样张与当前国服V2同尺寸对照确认，Alpha／可见RGB编码差异0；证据见SNAP-UB `temp/3d-fixed-square-20261026/`。

2026-10-26固定1:1与裁切端遮挡已部署：用户批准后构建Inkast API，发布`21710788ac0db6c4e5bfcbe9ceaa9aa16ef419908c92b21fa4c5b7de2873ece8`；65个API构建文件、14份Worker JS哈希回读匹配，API仅vision／v2路由变化，Mini仅同步geometry／inkast／compositor／agent／permissions／native-layers六份源码及发布身份。Worker runtime`130c8fb665c1c4a65c864dfc0b8654d0cf0f8ae7dfd28a01f27fc3c84fdcfba0`与线上心跳一致。JDC本次构建46项、Mini实际素材63项测试通过；旧任务／图层指纹、448份处理文件大小和mtime及上游任务记录保持，SQLite quick_check正常。两公网新接单门禁已按原哈希撤回，enabled/direct_generation_enabled=true，50能量、新图5／转图1并发保持；环境仅改发布身份、overlay和其他配置不变。1024固定透明无损WebP、原生框／角标锚点、真实截断端框后覆盖和一次有界原画平移在线生效；未恢复固定留白拦截、全身要求或模型终审。未新调用模型、重跑旧单、改账务／云函数、覆盖旧作品、发正式小程序或提交源码；新任务视觉效果待用户用其他卡牌验收。证据SNAP-UB `temp/3d-fixed-square-deploy-20261026/verification.json`，JDC／Mini回退目录均为`releases/20261026-fixed-square/`，须协调源码与身份回退。


### 3D前景持久化重写（2026-10-27，本地完成，未部署）

仅新建前景在明确内容拒绝后调用现有`rewriteBlockedPrompt`，使用透明前景专用配置与现有API LLM白名单，显式high；不把拒绝假定为关键词误判，必要时实质调整为合规内容。最多原提示一次加三轮重写，空输出或重复已拒提示立即停止；背景与局部补画仍保持原行为。专用重写不读取其他服区的卡图、不附加普通卡底部1/4留白；每轮重新施加原生透明PNG、实体不透明、所选主体、头手与持物轮廓完整及允许自然取景等约束。

每轮先持久化原始输入指纹、提示词、独立确定性上游ID、调用次数及拒绝历史，再提交；接单回执不明时继续GET当前轮原ID，不进入下一轮重写。仅durable-v1确认未接单时按原同ID／同内容协议补交。重写调用在持久检查点中占预算，同轮并发轮询不重复调用，失联超过120秒才允许第二次LLM调用；明确暂错冷却60秒，同轮最多两次，原45分钟总期限不刷新。CAS事务同时检查当前状态和有效租约，旧请求不能覆盖新结果或提交生图。LLM若在响应落盘前进程中断，恢复时可能按剩余预算重做文本重写，不会因此重复提交图像；终态旧任务不重开。状态仍保存于已有`static_v2_layers.state_json`，无需schema或计费变化。

本地API118项测试、测试范围TypeScript检查通过，覆盖回执丢失、进程重建、并发、租约失效、预算耗尽及专用构图约束；未构建、部署、提交或调用真实模型。真实上游内容调整效果和线上恢复尚未验收。


2026-10-27 本地姿态中性化与持物截断修订（未部署）：前景通用规则删除抬臂、脑后和内收肘部等具体动作示例，动作／手势／取景由角色及创作主题决定；重写配置同步遵循，不替用户添加固定动作模板。透明、实体不透明、所选轮廓完整与源画布边界约束继续每轮附加。Worker补充长段近不透明边缘的内侧实体证据，避免真实持物裁切因边缘Alpha未达250而漏检，同时保留短接触／柔和轮廓的排除；补画定位使用许可连通完成后的交叉段并识别被裁持物。局部补画仍最多一次，保护头手及蒙版外RGBA；不能采用时保留已遮住截断的合格构图，或一次小范围水平回收并复验。凯伦佩吉浮世绘原图层和原构图隔离回放已验证补画不可用的回收分支（模拟补画失败，真实模型调用0），并非已补齐扇面或已覆盖线上作品；证据见SNAP-UB `temp/3d-karen-fan-20261027/`。 本地API119项及类型检查、Worker实际素材86项（0跳过）通过；未构建、部署或提交。


2026-10-27 4∶5竖向前景（本地候选，未部署）：新前景请求1024×1280，背景仍请求1024×1536；每层状态保存outputSize，旧记录省略时保持2∶3、继续查询原确定性上游ID。生成和专用重写每轮保留4∶5、透明与轮廓边界要求；背景明确独立竖向构图。校验实际模型尺寸的比例及有界体积，最多容纳一个横向像素的取整差，不重采样前景；修补方图契约保持。构图根据服务器校验的独立图层元数据覆盖旧1024×1536源坐标规则，以实际前景尺寸解释中心和锚点；背景cover卡窗独立居中，框／角标和最终1024方形坐标不动。旧图层继续兼容；API123项（含TypeScript）、Worker实际素材90项通过。真实隔离样图／原始拒绝／恢复记录在SNAP-UB `temp/3d-portrait-45-20261027/`；未部署、提交或修改生产作品与账务。

4∶5隔离实测补充：Worker对仅剩底部框外实体渐隐的候选，可有限水平回收并重合成，仍保留源PNG、缩放、旋转与固定背景／装饰，检查失败不交付。三张真实图层和high构图经冻结回放全部通过，未新增模型调用；另两张指定角色被上游明确拒绝，失败记录保留，不更换渠道重试。此为本地候选与实验，不代表生产已切换；详细边界见SNAP-UB对应功能说明及verification.json。

2026-10-27 单人头部完整（本地，未部署）：生成、专用重写及自适应构图统一要求完整发顶、头部两侧、五官与下颌；头可留框内，但框和角标不得遮断，不把源截断藏框后当完整。构图须标注完整头部保护区，Worker按该区检查并保留前景连续覆盖；标注范围仍由模型决定，不宣称程序已独立识别人头。API123项、Worker91项及三张冻结原图层／原构图回放通过，0新增模型调用；证据SNAP-UB `temp/3d-complete-head-20261027/`。未部署或提交。


### 2026-10-27：4∶5竖向前景、持久重写与完整头部保护上线

用户批准后构建部署Inkast API `10faa512195a5fc4b15ea5a0457e443b1a342e075d73584fb3dc29ba4045b43a`，协调Mini Worker runtime `5c0d5b0545de04bdf388f1264e50c817586a0af7a85e710ef8774271a0bab288`。上线前景持久重写与中性姿态、4∶5竖向前景／独立2∶3背景布局、实际源宽高坐标、一像素比例取整兼容、持物真实截面检测、下方衣料有限水平回收及完整头部保护。头可以不出框，但模型标注的完整头部保护区不能被框／角标截断，真实源截断不靠藏框后放行；保护范围仍依赖模型语义标注。最终1024方形透明无损WebP、批准框／角标位置尺寸、50能量与5／1并发保持，不恢复模型终审。

API构建及63项JDC发布包测试、Mini安装后91项实际素材测试通过；API66文件（5模块变化）、Worker17源码（6模块变化）与本地清单回读一致，旧任务／图层、1108份work大小／mtime及上游图片任务文件保持，ChatGPT2API四源码未改。env和Worker配置只改API发布身份，overlay不变；零在途暂停入口并协调切换后，心跳、SQLite quick_check及两公网config通过，Nginx按原SHA恢复。部署期间无新模型调用，不重跑旧任务、不覆盖历史成品、不改账务、不发小程序、不提交／推送；真实新任务与手机验收待用户试用。两机回退`releases/20261027-portrait-head/`须协调代码及身份，证据SNAP-UB `temp/3d-portrait-head-deploy-20261027/verification.json`。


#### 管理员重新构图（2026-10-27）

可信云对象校验管理员本人后调用`POST /v2/recompositions`，只接收新id、owner_key、source_job_id及instruction（空为自动，最多1000字）。存储事务复核同作者成功generated来源，将成功的foreground/background地址与哈希及原数值冻结到新任务；不接受图层URL、模型或账务覆盖。任务仍占generated并发槽；不修改源任务和旧成品。计费豁免由云对象独立实现，不进入能量预留／结算。

claim向Worker提供重新构图上下文和已有布局回执。`POST /worker/:id/composition`仅Worker证明＋有效租约可写，保存最终实际plan供下次构图参考。旧任务无回执时Worker只读已校验本机产物，缺失即失败；原前景／背景入口只返回冻结图层，不重新生图；2026-10-27后续修订允许经租约与原PNG哈希约束的一次局部repair，按同作者成功来源链解析固定图片渠道。high视觉规划遵守用户布局要求与全部固定框／完整头部规则；程序拒绝与旧plan只有微小差异的候选。来源、要求、上下文纳入恢复指纹，不能靠再次领取重置任务预算。

2026-10-27 API发布 `20c85993b6fed0bbcbc1b757a9a786ec5657b074df42aacf2f444b82d3328467`，匹配Mini Worker `b6589109002d147a91f27e398f8e75c5e16219541a4f40a00a0e4b0e4efa5429`；127项本地与67项JDC发布包测试通过，66文件逐项回读、旧任务图层及SQLite检查通过。云对象／schema回读一致，索引CLI应用成功，小程序开发版编译完成。未实际调用模型验收新构图、未正式发布小程序、未提交代码；回退 `/root/inkast/releases/20261027-recomposition/` 须与Worker协调。


2026-10-27 较早的局部补齐隔离试验未部署（后续上线见下）：候选允许经Worker租约与原PNG哈希约束的单次repair，跨重新构图来源链解析固定渠道，禁止重生原图层；视觉规划将明示部位／方向输出为requirements供Worker像素验收。API128项通过；指定绯红女巫旧素材试验的单次编辑被上游内容防护拒绝，没有成功成品，按用户条件未部署。详见SNAP-UB的AI变体说明及同日repair-verification.json。


#### 重新构图平移优先（2026-10-27，已部署）

重新构图先由一次high规划识别用户指定的平移方向和出框部位，程序在原图层上搜索最多12个平移位置，找到满足要求且有实质差异的位置即结束；人物缩放与角度沿用来源作品，许可多边形、头手保护区及截面线随人物同步投影，背景、固定框和角标不移动。每个位置仍执行指定部位像素验收、完整头部、实体透明度、裁切接缝及交付边界检查，不能用其他部位出框替代目标。

所有平移候选都不合格时，才允许一次严格蒙版局部补齐；原前景／背景不重新生成。来源链校验同作者成功任务和原PNG地址／哈希，补齐固定原渠道、任务ID及输入哈希；临时故障续查原任务，明确防护拒绝不重发、不切渠道。补齐后重新合成并执行相同验收，仍不合格则本次重新构图失败，旧作品保留；管理员免费规则不变。

用户本次明确授权部署，API `4a1316dff95b9b93290588c95852d08510c269531c0161cfc691b3d55aa55fb1`、Worker runtime `1d82d8a1337722077af927264c3ac786323fb526b0b7feaeca9c302daf4d7168` 已协调上线。API本地128项、JDC实际发布包68项、Mini实际素材102项（0跳过）及构建通过；66份API／19份Worker源码逐项回读一致，独立心跳、SQLite quick_check及两公网config正常，Nginx门禁逐字恢复。旧任务／图层、2111份work文件大小／mtime及上游任务文件保持，env和Worker配置仅改变发布身份，overlay与ChatGPT2API源码不变。

真实原图层隔离回放中，普通左上平移一次通过且0补齐调用；原“臀部左出框”要求在12位置后仍失败，未误放行、未再次请求被拒的编辑。回放复用已有规划，不创建线上任务或调用新模型；局部补齐成功效果及手机端新任务仍待实单验收。未重跑旧任务、覆盖旧作品、改账务、发布小程序、提交或推送。两机回退 `releases/20261027-recomposition-translation-first/` 须协调API与Worker身份；证据 SNAP-UB `temp/3d-recomposition-translation-deploy-20261027/verification.json`。


#### 材质区分与原图层有界恢复（2026-10-27，本地完成，未部署）

出框末端按原前景源坐标的`materialRegions`区分：身体／头手／胳膊（body）和扇子、杯子、武器等硬物（rigid）不可用渐隐代替完整轮廓；柔软衣料／披风衣角（clothing）、轻纱（gauze）、能量（energy）允许末端局部自然渐隐，不要求为它们强行补画。只柔化指定末端，不降低整个人或整件衣服的不透明度；body／rigid与头手保护优先于重叠软材质标注。新原生构图必须返回材质区，旧配方缺标注时保持严格规则。材质与保护区仍依赖模型语义判断，并非新增独立语义分割。

新图直接生成在已冻结前景／背景上共用最多12个本地位置，关闭每个候选内嵌的位置搜索；比较初始方案后有合格位置即结束，不再为可选增强调用生图。全部失败才增加一个持久化布局规划阶段，带入有界失败位置／指标，用其2–3份候选重新合成，不再开启第二轮12位置搜索。仍有真实实体缺口时才使用现有严格蒙版局部补齐；明确终态网络失败且没有可复用结果时允许第二个编辑任务，全单最多两个。丢失回执继续查询同ID，明确防护拒绝不重发／不换渠道，第二次也失败不再新增任务；旧failed状态不因读取自动复活。原图层、原渠道、输入哈希、租约与45分钟图层期限保持绑定，网络重试不重置期限。管理员重新构图仍先平移、再必要补齐，不增加这次新图专用的额外布局阶段。

软材质渐隐后不再错误提名实体缺口；身体与硬物真实截面仍须补齐或落到框后。所有结果继续验证完整头部、固定框与角标、底部闭合、接缝及1024方形交付；新图验证失败直接保留实际失败指标与补齐回执摘要，避免classic降级再次失败覆盖原原因。无新增订单或二次扣能量，当前60能量／首次成功免费、旧50订单原额结算、管理员重新构图免费保持。

本地Worker105项（真实资产，0跳过）、Inkast API129项（含TypeScript）通过，覆盖软材质允许／身体硬物优先、真实源截面局部渐隐、12位置和一次额外布局、补齐第二次丢失回执与终态拒绝。三张旧成功样图的冻结图层／旧最终配方隔离回放全部通过，输出PNG哈希逐张一致；这是缺少材质标注的兼容验证，不代表新模型材质标注或新补画效果已验收。未调用新模型、重跑线上旧单、覆盖作品、改账务、构建、部署或提交；证据SNAP-UB `temp/3d-material-recovery-20261027/`。


2026-10-27 材质区分与原图层有界恢复已部署：API `70cab148a6680634e8d559aa410d6da1e087e695cc57f61092a86e56caa02a6f`、Mini runtime `c0e7491997ac30d4df3ca8783091a5ad60b446d713211d6d65fbcdcef06b4a3e` 协调上线。衣料／轻纱／能量末端允许局部渐隐，身体／头手／胳膊及硬质道具优先保护；新图先共用12个本地位置，再最多一个额外规划阶段，必要补齐仅在首次明确网络终态且无结果时允许第二个编辑任务，拒绝不重发／不换渠道。原图层、输入哈希、租约和原45分钟期限继续冻结，不恢复模型终审。

API构建、本地129项、JDC实际发布包69项及Mini安装后105项（0跳过）测试通过，66份API／20份Worker源码回读匹配（仅3个API模块、8份Worker源码变化）；SQLite quick_check、独立心跳身份与两个公网config正常。旧任务／图层、3151份work大小／mtime及上游图片任务文件保持，ChatGPT2API四源码保持；env与Worker配置只改发布身份，overlay不变，临时Nginx门禁按原SHA恢复。云对象60能量／首次成功免费和旧单原额结算不改；Inkast参考50仍由既有云端报价覆盖。未新调用模型、重跑旧单、改账务／schema／云函数、覆盖旧成品、发布小程序、提交或推送；新任务材质识别和真实补齐成品效果仍待验收。两机回退`releases/20261027-material-recovery/`须协调代码及身份。证据SNAP-UB `temp/3d-material-recovery-deploy-20261027/verification.json`。


#### 管理员恢复失败成品（2026-10-27，后端已部署，未提交）

入口位于小程序“AI变体审核 → 3D卡牌”，未删除的直接生成／原图层重新构图失败作品提供“恢复成品”；3D管理包含管理员本人的作品。云对象再次校验管理员，原作品ID、作者、来源服区与卡牌、原数值快照及公开状态保持；恢复成功更新同一作品的成品与timeline_at，原用户刷新其3D历史即可看到并预览，管理员不成为作品作者。

“重新合成”冻结已有成功前景／背景的地址与SHA-256，以一次显式恢复请求开启新的构图检查点，继承原重新构图要求；禁止重新生成图层或调用局部生图修补。合格后直接交付；仍失败则保留可预览候选。“准备候选图”优先提取本机旧任务已冻结的渲染报告／PNG，匹配来源、两图层、数值及报告／产物哈希，最多六张；没有可用旧候选时才运行当前构图与合成，供人工选择。每个候选须通过固定尺寸、方形交付越界、内窗覆盖、底部、已批准边框及数值来源检查，以透明无损WebP保存。人工采用仅选择服务端候选ID，不接受客户端图层、URL、作者或价格覆盖；采用可以跳过构图质量判断，不绕过文件与固定交付约束。

恢复不建立新作品、不扣能量，也不占首次成功免费资格。原任务若尚未完成失败结算，先完成原退费再允许恢复；已退款金额／余额／流水保持。云对象admin_recovery跳过收费并纳入既有cron终态同步，用户历史维持只读手动刷新，不依赖用户在线。SQLite沿用state_json保存恢复请求与旧失败摘要、操作人、候选和图层绑定，不新增表；同请求重复提交不重置任务，旧租约失效，不同并发恢复或重复采用不能覆盖成功结果。客户端确认弹窗、提交和读取共用忙碌锁，无定时轮询。

一次限定权限／重复采用／退款的聚焦审查后，主流程补充并发测试，复现并修复两处竞态：旧恢复的正常或拒绝回包晚到时，只按status比较会写入新一轮恢复；等待原结算时另一管理员已采用成功，旧请求未重验终态仍可重开。现在正常、拒绝和删除同步写入均绑定恢复请求ID；只更新远端制作字段，不回写旧账务／公开状态／恢复标记。结算后再次核对终态、删除状态及恢复请求，变更则拒绝旧操作。新增5项确定性回归，覆盖两种晚回包、结算等待以及同／不同请求并发采用；退款仍只落账一次。

部署前本地Inkast API131项（含TypeScript）、Worker真实资产107项（0跳过）、小程序／云对象68项通过，覆盖管理员跨用户恢复、退款待结算、断线原ID、重复采用、原用户历史可见、缺／变更素材拒绝、预览缓存复用、禁用新生图及微信模板内存编译。定向ESLint／语法／diff检查通过；全仓vue-tsc有其他模块38处错误，本次修改文件未报错。该阶段未构建／部署／提交、调用新模型、操作线上任务／账务或做设备验收。证据SNAP-UB `temp/3d-admin-recovery-20261027/`。普通用户继续消费既有作品字段，旧退款不迁移。


2026-10-27 经用户授权完成构建部署：Inkast API `e91c64ad803dc029ef16c64d547882f41e638b3a28213b5a983934e3b93419bd` 与Mini Worker runtime `7328d37e7f59013ba326444f8892fdbb1d0cba37aa0895ea73ebd5a2e07d1c82` 协调上线。JDC实际发布包71项、Mini安装后真实素材107项（0跳过）及云端回读代码51项通过；67份API／21份Worker源码、variantGenerator代码及作品schema回读一致。SQLite quick_check、匹配心跳及双公网config通过，Nginx临时门禁按原SHA恢复；非法恢复参数400、未认证候选读取401、缺少Worker证明的候选上传403。原任务／图层、3151份work大小／mtime、上游图片任务文件保持，env和Worker配置仅改发布身份，overlay及ChatGPT2API源码保持。仅上传目标schema的admin_recovery只读字段及费用描述，无新增集合／索引、原账务写入、新模型调用、旧单恢复或覆盖历史成品。管理员入口已由既有watch编译到微信开发版并核对组件注册和恢复方法，未发布正式小程序或做手机／真实恢复任务验收；未提交／推送。两机回退`releases/20261027-admin-recovery/`须协调代码及身份，云对象／schema旧版备份与证据位于SNAP-UB `temp/3d-admin-recovery-deploy-20261027/verification.json`。


#### 构图持久后台任务（2026-10-27，已部署并验证原图层恢复）

`POST /plugins/v1/vision/tasks/:task` 先将插件、任务名、完整输入指纹及固定请求ID写入SQLite `plugin_vision_jobs`，返回202；`GET /plugins/v1/vision/tasks/:id` 查询原任务。后台调用与HTTP连接分离，每插件最多2个、全局4个运行，排队与运行合计16个；构图上游期限20分钟，模型和high保持。重复提交同ID同输入复用回执，异输入409；插件不可读取他人任务。终态持久化结果／错误后清除大图输入，保留指纹；读取不新建任务。

Worker在发请求前保存固定ID，短提交后查询原ID，丢回执／断线／Worker重启继续同一尝试，不消耗新视觉次数；已确认接单后记录丢失失败关闭。仅供构图的参考视图缩到最长边1024、JPEG86，冻结PNG与高清合成不变。API进程重启时恢复未执行队列；已在上游执行且结果未知的调用标记`vision_interrupted`，不自动重放潜在收费请求。原同步视觉端点保持兼容，既有6次构图／12次视觉预算保持，明确不可重试错误优先。


2026-10-27 已完成构建部署及两张原图层恢复：API `23b88f54d6fa3926b83fb6e420388ebb4651c64b6546f68561a9e2440e6d7345`，Mini runtime `f9ea33daadd99b63a9e3236744fcd3db788f1362a0968731a8d2125ce1dfb8a3`。JDC实际发布包75项、Mini安装后112项（0跳过）、69份API／22份Worker源码回读、SQLite quick_check、匹配心跳及双公网config通过，原3252份work与原任务图层在部署前后保持。env与Worker配置仅改发布身份，overlay和ChatGPT2API四源码保持；两机回退`releases/20261027-durable-plan/`须协调身份。

两张均复用原PNG和原上游图层ID，未重新生图或局部补齐，最终1024方形透明无损WebP；德古拉恢复总耗时1302.409秒（21分42秒），尚气1929.287秒（32分09秒），各两次构图。德古拉首次因上游180秒无新数据失败，第二次405.764秒成功；尚气首次触发20分钟构图总期限，第二次473.064秒成功。四个后台视觉任务均持久化终态并清除大图输入；两张原用户作品已回写succeeded，原退款字段、对应流水与首次免费资格哈希保持，未新建订单或扣能量。真实图片浏览器尺寸／视觉核对通过，手机交互未重新验收；未发布正式小程序、提交或推送。上游慢响应和偶发无数据中断仍然存在，不把可恢复流程称为上游性能问题已消失。证据SNAP-UB `temp/3d-durable-plan-20261027/verification.json`。


2026-10-29上线补记：以上Codex适配及断流停止重试已部署JDC，API发布`66d6b8c3943b`，69份运行文件回读及98项发布包测试通过；Mini只配对Worker身份，原渠道/provider/overlay保持。ChatGPT2API增量读流补丁随后上线，Mini493项及24项子测试通过、17项跳过，健康与原两任务查询正常。独立Codex provider仍只在本地隔离测试库，生产默认未切换；本次未新增真实生图或提交。回退、保留期清理与部署证据见cc对应服务记录及本机`data/codex-stability-deploy-20261029/`。


2026-10-29连续绘画隔离原型：ChatGPT2API新增本地会话日志，尚无HTTP入口，Inkast业务任务未接入。订阅Codex不接受previous_response_id；客户端保留同一账号的文字历史、原始输出及PNG，图片工具记录本身不等同于下一轮可见原图，另提供显式图片引用试验模式。同一步指纹固定，未知结果停止重发，已存PNG不随上下文尾段失败丢失。六次隔离图片调用取得三张PNG，其中前景与参考图edit背景完整完成、原会话edit背景终态未知。显式两图文字核验295.160秒通过，纯文字对照6.822秒；最后一次显式历史背景edit在362.915秒发生IncompleteRead，无完整图或终态，未重发。图片可见性有实证，仍不能宣称连续生图更稳定或成品视觉更一致；此次直连订阅后端不经过Inkast，断连最初来源未定位。本地514项及24子测试、Mini会话核心19项通过；未改变生产provider、3D路由或小程序。可见图片和脱敏证据位于本地忽略目录`data/codex-session-trial-20261029/`，生产接入须继续独立验收。


### 2026-10-30：Codex 连续绘画接入 3D（后端已部署）

新建原生 3D 任务选用 Codex provider 时，前景和背景使用同一个显式图片上下文项目。`v2ImageProviderIds` 可单独配置 3D 生图来源，省略时沿用 `imageProviderIds`，显式空数组停止新建图层；普通插画仍用原 `imageProviderIds`。已有状态继续绑定原 provider，配置更新不能把在途单图任务中途改成连续绘画。重新构图／管理员恢复继续复用原 PNG，不开启新项目；局部补画沿用已有独立编辑路径。

Inkast 在首次提交前通过 GET 确认上游声明 `X-Codex-Drawing-Session: explicit-images-v1`；原图层状态冻结项目标识、原任务 ID 及前景 SHA-256。背景提交只传项目标识、前景步骤和哈希，由 ChatGPT2API 在同一账号内加载原 PNG、创作历史及不透明 reasoning；不再从 R2 下载后重复编码上传前景。每层成功必须有匹配项目的 `drawing_context_status=ready`，下载 PNG 的哈希须与会话回执一致。透明 PNG、前景 4∶5／背景 2∶3、原提示词及固定边框／角标合成保持。

提交回执丢失仍查询同一确定性 ID；只有 durable-v1 明确确认未接单，才允许同 ID 同内容有限补交。上下文未知时停止，不换账号、渠道或重写生图；前景明确内容拒绝后的原重写规则保留，新的修订轮次使用独立项目。已存完整图但上下文尾段未知时保留图，不能自动生成背景。完整上下文已落盘而 R2 交付失败／服务重启时，只恢复原图交付；交付结果单独缓存，恢复有预算和冷却，等待恢复时不提前暴露失败终态。

上线顺序为 ChatGPT2API → Inkast API → 私有 overlay 的 3D provider 选择；先验收协议和两图共享上下文，再接真实用户任务。用户随后授权构建部署，生产API发布`7217217f9ea6`，新3D已选择专属Codex provider；普通生图overlay、profile、顺序和原provider配置核对保持。协议探测／健康／心跳已通过，真实维纳斯验收另记；这不保证2.5实际引擎或high参数严格执行，旧网页路径和已接单状态不自动迁移。


2026-10-30聚焦审查修复：若合法完整 PNG 已落盘而会话尾段断开，ChatGPT2API 保持错误终态 `CODEX_CONTEXT_INCOMPLETE`，同时在 `data` 中提供经哈希核对的原图交付，并标记 `drawing_context_status=incomplete`。R2 失败及重启仍只从原 PNG 恢复交付；Inkast 校验项目、上下文状态和 PNG SHA 后，把链接／哈希留在失败图层中用于取回，不能将其当作 `ready` 或自动启动背景。明确的上游拒绝不交付预览。手动停止后查询／重启不得再次恢复交付；执行队列暂满属于等待，不计入真实交付尝试、不提前返回失败。这是恢复与诊断契约，不是新增小程序管理员按钮或自动采用成品。

维纳斯完整生产式验收已成功：独立测试任务`v2-0583e6fd-c937-43b1-ba69-e4fb7ade2b5f`，提交到成品381.594秒（约6分22秒）；Codex前景59.127秒、同项目背景40.338秒，原high构图174.437秒，其余排队／交付／轮询／合成107.692秒。两图各一次提交，前景未重写；同一绘画项目／账号、背景前景SHA绑定和两步completed已核对。最终1024方形透明无损WebP，951,822字节，SHA `901d1fe227d2d576c65f0bea6e8f3e47de995ab599467cc0304e20c765e2c165`。原图层和中性底显示已目视：右手、头发、裙纱及水花出框，底部闭合，框／3-3角标固定；无手调、局部补生图或成品模型终审。请求两图high，上游工具实际回报前景medium／背景low；2.5为请求别名，不能据此保证实际引擎或high严格执行。此次是一张新任务完整验收，不代表全部角色或并发稳定性。原用户作品、账务保持；未提交或发布小程序。脱敏证据与图片见Inkast忽略目录`data/codex-drawing-deploy-20261030/verification.json`。
