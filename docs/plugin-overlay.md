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

SQLite给任务增加input_kind／creation_json，新增static_v2_layers保存每层检查点。Worker凭插件证明与有效租约调用`POST /worker/:id/layers/foreground|background`，每次只做有界的提交或查询，API重启后无需恢复内存中的后台Promise。生成顺序为透明前景→以该前景为参考的匹配背景；固定同一配置指纹与明确允许的c2i-tasks通道，high、1024×1536、PNG，不执行提示词改写或通道降级。首次请求前落盘确定性client_task_id，丢失提交回执后只GET原ID；上游记录丢失／内容拒绝／配置改变／45分钟超时明确失败，不换ID重生。每层只在校验PNG后保存URL及SHA-256；背景参考与Worker下载必须匹配该哈希，客户端看不到提示词、通道密钥或上游ID。

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
