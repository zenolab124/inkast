import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { z } from "zod";
import type { InkastPlugin } from "./types.js";

/**
 * Plugin overlay loader.
 *
 * inkast 主线产品不包含任何具体客户的 plugin 配置(`snapub.ts` 等已剥离)。
 * 启动时扫 `INKAST_PLUGIN_DIR` 指向的目录,读 `*.json` 文件,zod 校验后
 * 注册到 in-memory registry。
 *
 * 配置形态完全数据化:JSON 文件可以来自:
 *   - 客户 overlay 私有 git 仓的 plugins/ 目录(rsync 到部署机的 INKAST_PLUGIN_DIR)
 *   - 同主仓的 gitignored 本地开发目录(开发期方便)
 *   - 任何 ops 自己管理的位置
 *
 * 加载策略:
 *   - dir 不存在 → 启动 OK,日志 warn,plugin 通道无任何 plugin 注册
 *   - dir 存在但空 → 同上
 *   - 单个 JSON 解析 / 校验失败 → log error,**跳过该文件**,其它继续
 */

const ImageSizeSchema = z.string().min(1);
const ImageQualitySchema = z.string().min(1);
const ImageFormatSchema = z.enum(["png", "jpeg", "webp"]);
const HttpsOriginSchema = z
  .string()
  .url()
  .refine((value) => {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.origin === value;
  }, "allowed origin must be an exact HTTPS origin without path, query, or credentials");

/**
 * Where the generated image bytes land + how the callback addresses them.
 *
 *   - "b64" (default): bytes go into plugin_tasks.b64_json, callback body
 *      carries `b64_json` + `mime`. Legacy v2 behavior.
 *   - "r2":  bytes uploaded to R2 (bucket/path from this config block),
 *      callback body carries `image_url` + `mime`. Token comes from env
 *      (R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY), so a
 *      plugin only ever declares non-secret routing here.
 */
const ImageStorageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("b64") }),
  z.object({
    kind: z.literal("r2"),
    bucket: z.string().min(1),
    publicBase: z
      .string()
      .url()
      .regex(/^https?:\/\//, "publicBase must be a full URL with scheme"),
    keyPrefix: z.string().default(""),
    contentType: z.enum(["image/png", "image/jpeg", "image/webp"]).default("image/png"),
  }),
]);

const LlmBackendDescriptorSchema = z.union([
  z.literal("claude-code"),
  z.object({
    kind: z.literal("openai-compatible"),
    providerId: z.string().min(1),
  }),
]);

const InkastPluginSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z][a-z0-9_-]*$/, "plugin id must be lowercase + digits + _-"),
  name: z.string().min(1),
  systemPromptPatch: z.string().optional(),
  enforceFields: z.record(z.string(), z.unknown()).optional(),
  imageDefaults: z.object({
    size: ImageSizeSchema.optional(),
    quality: ImageQualitySchema.optional(),
    format: ImageFormatSchema.optional(),
  }),
  // `[]` is valid on purpose: it is a fail-closed kill switch. Omitting the
  // field preserves the historical full-pool behavior for existing plugins.
  imageProviderIds: z
    .array(z.string().trim().min(1))
    .max(32)
    .refine(ids => new Set(ids).size === ids.length, "provider ids must be unique")
    .optional(),
  imageProviderOrder: z.literal("allowlist").optional(),
  imageStorage: ImageStorageSchema.optional(),
  upstreamImageUrlPassthrough: z
    .object({
      allowedOrigins: z
        .array(HttpsOriginSchema)
        .min(1)
        .max(8)
        .refine(
          origins => new Set(origins).size === origins.length,
          "allowedOrigins must be unique",
        ),
    })
    .optional(),
  llmBackend: LlmBackendDescriptorSchema.optional(),
  lang: z.enum(["zh", "en"]).optional(),
  skipLlmExpansion: z.boolean().optional(),
  skipLlmConstraintsText: z.string().optional(),
  outputDimensions: z
    .object({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      fit: z.enum(["cover", "contain-alpha"]).optional(),
      paddingPercent: z.number().min(0).max(25).optional(),
      alphaThreshold: z.number().int().min(0).max(254).optional(),
      maxCornerAlphaRatio: z.number().min(0).max(1).optional(),
    })
    .optional(),
  // source_image 额外允许域：必须是 https origin 前缀（SSRF 白名单，防裸 host / http 降级混入）
  sourceImageHosts: z.array(z.string().regex(/^https:\/\/[^/]+$/)).optional(),
}).superRefine((plugin, ctx) => {
  if (plugin.imageProviderOrder && plugin.imageProviderIds === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["imageProviderOrder"],
      message: "imageProviderOrder requires imageProviderIds",
    });
  }
  if (plugin.outputDimensions?.fit === "contain-alpha") {
    if (plugin.imageStorage?.kind !== "r2" || plugin.imageStorage.contentType !== "image/png") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["outputDimensions", "fit"],
        message: "contain-alpha requires R2 image/png storage",
      });
    }
  }
});

export function loadPluginConfigsFromDir(dir: string): InkastPlugin[] {
  let files: string[];
  try {
    const stat = statSync(dir);
    if (!stat.isDirectory()) {
      console.warn(`[plugins] INKAST_PLUGIN_DIR=${dir} is not a directory; no plugins loaded`);
      return [];
    }
    files = readdirSync(dir);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[plugins] INKAST_PLUGIN_DIR=${dir} cannot be read: ${msg}; no plugins loaded`);
    return [];
  }

  const out: InkastPlugin[] = [];
  const seenIds = new Set<string>();
  for (const f of files.sort()) {
    if (extname(f) !== ".json") continue;
    if (f.startsWith(".") || f.startsWith("_")) continue; // 跳过 hidden / underscore-prefixed
    const path = join(dir, f);
    let parsed: unknown;
    try {
      const raw = readFileSync(path, "utf-8");
      parsed = JSON.parse(raw);
    } catch (err) {
      console.error(`[plugins] failed to read/parse ${path}:`, err instanceof Error ? err.message : err);
      continue;
    }
    const result = InkastPluginSchema.safeParse(parsed);
    if (!result.success) {
      console.error(
        `[plugins] schema validation failed for ${path}:`,
        result.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "),
      );
      continue;
    }
    const plugin = result.data as unknown as InkastPlugin;
    if (seenIds.has(plugin.id)) {
      console.error(`[plugins] duplicate plugin id '${plugin.id}' in ${path}; skipped`);
      continue;
    }
    seenIds.add(plugin.id);
    out.push(plugin);
    console.log(`[plugins] loaded ${f} → plugin '${plugin.id}'`);
  }
  return out;
}
