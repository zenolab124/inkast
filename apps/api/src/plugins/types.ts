import type {
  ImageFormat,
  ImageQuality,
  ImageSize,
  OutputLang,
} from "@inkast/shared";
import type { LlmBackendDescriptor } from "../drivers/llm/index.js";

/**
 * Plugin 通道契约。每个对外接入方一份配置,完全独立于 Web UI。
 *
 * Web UI 走 `/api/*` 路由,plugin 走 `/plugins/*` 路由 — 两者共享底层
 * LLM driver 和 image provider 池,但请求路径、鉴权、持久化策略均隔离。
 *
 * 持久化策略由 plugin overlay 的 `imageStorage` 字段决定:
 *   - "b64"(默认):字节流走 plugin_tasks.b64_json + callback b64_json 推给调用方
 *   - "r2":字节流上传 R2(bucket/path 由配置指定),callback 只发 image_url
 * jdc 磁盘上仍然不长期落地任何生成图,只 24h 内的 plugin_tasks 行作为投递兜底。
 */
export type PluginImageStorage =
  | { kind: "b64" }
  | {
      kind: "r2";
      bucket: string;
      publicBase: string;          // e.g. "https://aivariants.124213.xyz"
      keyPrefix: string;           // e.g. "aiVariants/", "" for bucket root
      contentType: "image/png" | "image/jpeg" | "image/webp";
    };

export interface PluginOutputDimensions {
  readonly width: number;
  readonly height: number;
  /** Existing plugins default to top-anchored cover. Transparent assets opt in here. */
  readonly fit?: "cover" | "contain-alpha";
  /** Transparent safe margin on each canvas edge. Used only by contain-alpha. */
  readonly paddingPercent?: number;
  /** Maximum visible ratio accepted in any outer 10% corner sample. */
  readonly maxCornerAlphaRatio?: number;
}
export interface InkastPlugin {
  readonly id: string;
  readonly name: string;
  /**
   * Optional request-scene delegation under the authenticated plugin token.
   * The caller may submit only a configured scene name; the mapped plugin id
   * supplies output constraints/storage but does not need its own bearer token.
   */
  readonly scenePlugins?: Readonly<Record<string, string>>;
  /**
   * 追加到 prompt-engine 默认 system prompt 末尾的业务约束文本。引导 LLM
   * 在散文→JSON 拆解时主动产出符合业务要求的字段。
   */
  readonly systemPromptPatch?: string;
  /**
   * LLM 拆完 JSON 后强制覆盖 / 注入的字段(浅合并,plugin 字段优先)。用于
   * 兜底关键约束 — LLM 漏写也保证字段有值。ImagePrompt 是开放 schema,
   * 这里允许任意键。
   */
  readonly enforceFields?: Record<string, unknown>;
  /**
   * 生图参数。调用方请求体里同名字段会被忽略,以此为准。
   */
  readonly imageDefaults: {
    size?: ImageSize;
    quality?: ImageQuality;
    format?: ImageFormat;
    background?: "transparent" | "opaque" | "auto";
  };
  /**
   * Restrict every image-provider dispatch made for this plugin to these
   * provider IDs. The restriction is enforced inside the image driver, so it
   * survives prompt-rewrite retries and post-review edits.
   *
   * `undefined` preserves the legacy full-pool behavior for existing plugins.
   * An explicit empty array is intentionally fail-closed and disables image
   * dispatch for the plugin until at least one enabled provider ID is listed.
   */
  readonly imageProviderIds?: readonly string[];
  /**
   * Optional plugin-local provider ordering. Omit to retain global DB priority;
   * `"allowlist"` makes `imageProviderIds` order the fallback sequence.
   */
  readonly imageProviderOrder?: "allowlist";
  /**
   * Named request-level provider policies. Callers submit only the profile
   * name; provider IDs stay server-side in the overlay. This lets one plugin
   * expose product modes such as `fast` / `quality` without allowing callers
   * to inject arbitrary provider IDs.
   */
  readonly imageProviderProfiles?: Readonly<Record<string, {
    readonly imageProviderIds: readonly string[];
    readonly imageProviderOrder?: "allowlist";
  }>>;
  /**
   * 出图后字节流的去向。不设时默认 `{kind:"b64"}` — 走 callback b64_json
   * 路径(v2 协议默认)。设 `{kind:"r2", ...}` 切到 R2 直传(v2.1 协议)。
   * 凭据(account_id / access_key / secret) 走 env,不进 plugin overlay。
   */
  readonly imageStorage?: PluginImageStorage;
  /**
   * Explicit allowlist for provider-owned persistent image URLs that may be
   * returned directly instead of downloading and uploading to `imageStorage`.
   * Omitted by default: every upstream URL follows the normal persistence path.
   * For c2i-tasks providers, an R2-backed plugin with this allowlist requests
   * persistent URL delivery for that generation (`response_format=url`,
   * `url_source=r2`) instead of relying on provider-global output settings.
   * Exact HTTPS origin matching prevents temporary fallback-provider URLs from
   * entering a plugin's long-lived callback contract. When `outputDimensions`
   * is also configured, only an allowlisted upstream URL bypasses resize; all
   * other provider results still run through the normal resize + upload path.
   */
  readonly upstreamImageUrlPassthrough?: {
    readonly allowedOrigins: readonly string[];
  };
  /**
   * LLM 通道描述符。未指定时回落到 `INKAST_DEFAULT_LLM_PROVIDER_ID` env
   * 指向的 openai-compatible provider;再没有则用 "claude-code"。jdc 部署
   * 必须配 env(本机无 ClaudeCode 凭据)。
   */
  readonly llmBackend?: LlmBackendDescriptor;
  /** LLM 输出语言。默认 "en"(对生图模型更友好)。 */
  readonly lang?: OutputLang;
  /**
   * 跳过 LLM 散文→JSON 拆解,直接把调用方 prompt + 业务约束散文
   * 拼成最终 prompt 喂给图模。
   *
   * 取舍:
   *   - 优势:省 LLM 调用(~14s)+ 0 token 成本 + 少一个失败点
   *   - 代价:跳过 imagegen 字段化优化,出图一致性略降(取决于调用方输入质量)
   *
   * 默认 `false`(走完整 LLM 拆解路径)。开启后 `systemPromptPatch` /
   * `enforceFields` 不被使用,改用 `skipLlmConstraintsText`。
   */
  readonly skipLlmExpansion?: boolean;
  /**
   * 散文版业务约束。**仅在 `skipLlmExpansion=true` 时使用**。
   * 内容应包含:画面比例、safe zone 百分比、不要文字 / UI overlay、SFW
   * 等所有硬约束。会被原样拼接到调用方 prompt 之后,直接喂图模。
   *
   * 写法上要把 systemPromptPatch 里那种"给 LLM 看的指令式语言"翻译
   * 成"给图模看的描述式语言":图模不会"按 4 个准则拆字段",它只
   * 直接读 prompt 文字。
   */
  readonly skipLlmConstraintsText?: string;
  /**
   * 最终输出尺寸(像素)。image driver 出图后由 sharp resize 到这个尺寸
   * (`fit: "cover"`,主体居中,裁切多余)。
   *
   * 用于把 image 模型固定 size(只接受 1024x1024 / 1024x1536 / 1536x1024)
   * 精确缩放到调用方期望的卡牌艺术框尺寸。
   *
   * 不设则原样输出 driver 给的尺寸。
   */
  readonly outputDimensions?: PluginOutputDimensions;
  /**
   * When true, a caller-supplied ratio is enforced on the final persisted
   * image with a sharp cover crop. This disables upstream URL passthrough for
   * that request so the callback never claims a ratio the bytes do not have.
   */
  readonly enforceRequestedRatio?: boolean;
  /**
   * source_image 的额外允许域(完整 origin 前缀,如 "https://msnap.124213.xyz")。
   * SSRF 白名单默认只放行 imageStorage.publicBase(自家图床);调用方另有
   * 素材图床(如官方原画库)时在这里显式列出。按 `${host}/` 前缀匹配。
   */
  readonly sourceImageHosts?: readonly string[];
}
