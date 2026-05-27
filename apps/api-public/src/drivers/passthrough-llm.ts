import OpenAI, { APIError } from "openai";

/**
 * 透明代理 LLM driver。镜像 passthrough-image:每次请求 new client、ad-hoc
 * 凭据、零持久化。response_format: json_object 强制返 JSON。
 *
 * 跟主线 drivers/llm/openai-compatible.ts 的关系:同一思路,但主线 driver
 * 强依赖 DB providers + 复杂错误分类(timeout / rate_limited / auth /
 * invalid_json),公开版只一次性调用,失败让前端决定如何重试。
 */

const CODEX_CLI_HEADERS: Record<string, string> = {
  originator: "codex_cli_rs",
  "User-Agent": "codex_cli_rs/0.49.0 (Darwin 25.5.0; arm64) terminal",
};

export interface PassthroughLlmInput {
  baseUrl: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
  useCodexHeader?: boolean;
  signal?: AbortSignal;
}

export interface PassthroughLlmOutput {
  /** 解析后的 JSON 对象。 */
  json: unknown;
  /** 原始 message.content 字符串(保留给调试)。 */
  raw: string;
  durationMs: number;
}

export class PassthroughLlmError extends Error {
  constructor(
    public readonly upstreamStatus: number | null,
    public readonly upstreamCode: string | null,
    message: string,
  ) {
    super(message);
    this.name = "PassthroughLlmError";
  }
}

export async function passthroughLlmJson(
  input: PassthroughLlmInput,
): Promise<PassthroughLlmOutput> {
  const started = Date.now();
  const client = new OpenAI({
    apiKey: input.apiKey,
    baseURL: input.baseUrl,
    timeout: 120_000,
    ...(input.useCodexHeader ? { defaultHeaders: CODEX_CLI_HEADERS } : {}),
  });

  try {
    const completion = await client.chat.completions.create(
      {
        model: input.model,
        messages: [
          { role: "system", content: input.systemPrompt },
          { role: "user", content: input.userPrompt },
        ],
        response_format: { type: "json_object" },
      },
      input.signal ? { signal: input.signal } : undefined,
    );

    const raw = completion.choices[0]?.message?.content ?? "";
    if (!raw) {
      throw new PassthroughLlmError(null, "empty_response", "LLM 返回空内容");
    }

    let json: unknown;
    try {
      json = extractJson(raw);
    } catch (err) {
      throw new PassthroughLlmError(
        null,
        "invalid_json",
        `LLM 输出非合法 JSON: ${err instanceof Error ? err.message : err}`,
      );
    }

    return { json, raw, durationMs: Date.now() - started };
  } catch (err) {
    if (err instanceof PassthroughLlmError) throw err;
    if (err instanceof APIError) {
      throw new PassthroughLlmError(err.status ?? null, err.code ?? null, err.message);
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new PassthroughLlmError(null, null, msg);
  }
}

/**
 * 容错 JSON 提取:模型有时会包 ```json fence,或加前/后散文。先 trim,
 * 剥 fence,然后裁出第一个 { … } 块再 parse。
 */
function extractJson(raw: string): unknown {
  let s = raw.trim();
  // strip fenced code blocks
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }
  // 找第一个 { 到匹配的 }(贪婪取最外层)
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first >= 0 && last > first) {
    s = s.slice(first, last + 1);
  }
  return JSON.parse(s);
}
