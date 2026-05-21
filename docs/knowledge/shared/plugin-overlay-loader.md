# Plugin Overlay Loader

JSON 配置文件 → `InkastPlugin` 实例的加载机制。主线代码不含具体客户配置,客户配置都在 `INKAST_PLUGIN_DIR` env 指向的目录里(rsync 自客户 overlay 仓)。

## 核心接口

```ts
// apps/api/src/plugins/loader.ts
export function loadPluginConfigsFromDir(dir: string): InkastPlugin[]
```

## 加载流程

```
启动 inkast-api
  ↓
registry.ts 模块加载
  ↓
loadPluginsFromOverlayDir():
  ├─ 读 INKAST_PLUGIN_DIR env (未设 → warn + 跳过)
  ├─ readdirSync(dir) 扫所有文件
  ├─ 过滤: extname === ".json" && !startsWith(".") && !startsWith("_")
  ├─ 对每个文件:
  │   ├─ JSON.parse (失败 → log error 跳过,继续其它)
  │   ├─ InkastPluginSchema.safeParse (zod 校验,失败 → log error + issue paths)
  │   ├─ 去重: 同 id 在多文件 → log error 跳过后者
  │   └─ 注册到 in-memory plugins Map
  ↓
loadTokensFromEnv():
  ├─ 扫所有 INKAST_PLUGIN_TOKEN_* env
  ├─ id = key.slice(prefix).toLowerCase()
  ├─ 匹配到 registered plugin → 注册 token → plugin_id 映射
  └─ 不匹配 → log warn 忽略
```

## zod schema

```ts
const ImageStorageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("b64") }),
  z.object({
    kind: z.literal("r2"),
    bucket: z.string().min(1),
    publicBase: z.string().url().regex(/^https?:\/\//),
    keyPrefix: z.string().default(""),
    contentType: z.enum(["image/png", "image/jpeg"]).default("image/png"),
  }),
]);

const InkastPluginSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  name: z.string().min(1),
  systemPromptPatch: z.string().optional(),
  enforceFields: z.record(z.string(), z.unknown()).optional(),
  imageDefaults: z.object({
    size: z.string().min(1).optional(),
    quality: z.string().min(1).optional(),
    format: z.enum(["png", "jpeg", "webp"]).optional(),
  }),
  imageStorage: ImageStorageSchema.optional(),   // v2.1 起,未设 = 默认 b64
  llmBackend: z.union([
    z.literal("claude-code"),
    z.object({ kind: z.literal("openai-compatible"), providerId: z.string() }),
  ]).optional(),
  lang: z.enum(["zh", "en"]).optional(),
  skipLlmExpansion: z.boolean().optional(),
  skipLlmConstraintsText: z.string().optional(),
  outputDimensions: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }).optional(),
});
```

### imageStorage 字段语义(v2.1 起)

- 未设 / `{kind:"b64"}`:走 callback `b64_json` 老路径(v2 兼容)
- `{kind:"r2", bucket, publicBase, keyPrefix, contentType}`:inkast 直接 PUT R2,callback 改返 `image_url`
- **凭据不在这里**——R2 token 走 env(`R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`),JSON 只配 routing。详见 [[cloudflare-r2]]

## Token 加载语义

- Token **不进 JSON**(JSON 进 git,token 不进 git)
- Env 命名: `INKAST_PLUGIN_TOKEN_<UPPER_ID>=<64-char hex>`,例:`INKAST_PLUGIN_TOKEN_SNAPUB=...`
- 启动 log:`[plugins] loaded token for plugin 'snapub' (token-len=64)` 印证就绪

## 使用方

| 文件 | 用途 |
|---|---|
| `apps/api/src/plugins/registry.ts` | 模块加载即调用 loader |
| `apps/api/src/server/middleware/plugin-auth.ts` | `getPluginByToken(bearerToken)` 查找 |
| `apps/api/src/domain/plugin-async/index.ts` | `listRegisteredPlugins()` + `resolveLlmBackend()` |

## 关联条目

- [plugin-channel](../domains/plugin-channel.md) — 加载的 plugin 服务这个通道
- [json-overlay-vs-branch](../decisions/json-overlay-vs-branch.md) — 这个机制的设计决策
- [new-plugin-onboarding](../workflows/new-plugin-onboarding.md) — 部署侧使用流程
- [r2-direct-upload-v2.1](../decisions/r2-direct-upload-v2.1.md) — imageStorage 字段的来源决策
- [cloudflare-r2](../integrations/cloudflare-r2.md) — R2 routing 字段如何被 driver 使用
- [snapub-overlay-jdc-only](../pitfalls/snapub-overlay-jdc-only.md) — overlay JSON 不在 git 的现状
