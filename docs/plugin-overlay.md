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
  imageDefaults: {
    size?: string;                   // "auto" | "1024x1024" | "1024x1536" | ...
    quality?: string;                // "high" | "medium" | "low" | "standard" | "hd"
    format?: "png" | "jpeg" | "webp";
  };

  imageProviderIds?: string[];       // provider 白名单；[] 为关闭
  imageProviderOrder?: "allowlist"; // 可选：按上面数组顺序 fallback；省略走全局 priority

  // 可选
  systemPromptPatch?: string;        // LLM 模式: 追加到 system prompt 末尾
  enforceFields?: Record<string, unknown>;  // LLM 输出后强制覆盖
  lang?: "zh" | "en";

  skipLlmExpansion?: boolean;        // true = 跳过 LLM 拆解,直接散文 prompt
  skipLlmConstraintsText?: string;   // skipLlmExpansion=true 时拼到 user prompt 后面

  outputDimensions?: { width: number; height: number };  // sharp cover-fit resize 兜底

  upstreamImageUrlPassthrough?: {     // 显式允许 provider 持久 URL 直通 callback
    allowedOrigins: string[];         // exact HTTPS origins，如 https://img.example.com
  };                                  // c2i 按请求选 R2；命中直回，fallback 仍可走 outputDimensions

  llmBackend?:                       // 单 plugin 想指定专属 LLM provider 时用
    | "claude-code"
    | { kind: "openai-compatible"; providerId: string };
}
```

字段含义详见 [apps/api/src/plugins/types.ts](../apps/api/src/plugins/types.ts)。

zod 校验定义在 [apps/api/src/plugins/loader.ts](../apps/api/src/plugins/loader.ts)。

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
