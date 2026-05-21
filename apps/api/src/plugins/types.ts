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
 * plugin 通道不向磁盘持久化生成的图片字节(jdc 磁盘紧张),只把 b64_json
 * 流给调用方,inkast 这边无状态。
 */
export interface InkastPlugin {
  readonly id: string;
  readonly name: string;
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
  readonly outputDimensions?: { width: number; height: number };
}
