import OpenAI, { APIError } from "openai";
import { appendImageCleanlinessInstruction } from "./prompt-cleanliness.js";

/**
 * 透明代理 image driver。每次请求**新建** OpenAI client(用户带过来的 key
 * 是单次 ad-hoc 凭据,不复用、不缓存)。响应返回后 client 实例被 GC 掉,
 * 凭据不会以任何形式持久化到 jdc。
 *
 * 跟主线 drivers/image/openai-compatible.ts 的差异:
 * - 不查 DB providers / capabilities,凭据完全由调用方传入
 * - 不做 retry / fallover(主线那套是 DB-driven pool,公开版透明代理一次性,
 *   失败直接抛错让前端决定要不要换 provider)
 * - 不做 sharp transcode / R2 upload(那是 task 8 R2 中转的事)
 *
 * codex header 由 ad-hoc capability shape 决定,沿用主线 drivers/codex-header.ts
 * 的固定字符串(写死,Phase 1 不暴露细节给用户)。
 */

const CODEX_CLI_HEADERS: Record<string, string> = {
  originator: "codex_cli_rs",
  "User-Agent": "codex_cli_rs/0.49.0 (Darwin 25.5.0; arm64) terminal",
};

export interface PassthroughInput {
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  size?: string;
  n?: number;
  /** Inject Codex CLI 仿冒头(部分代理按客户端身份 gate 配额/审查)。 */
  useCodexHeader?: boolean;
  /** Hono passes through AbortSignal so client disconnect cancels upstream. */
  signal?: AbortSignal;
}

export interface PassthroughOutput {
  /** OpenAI 兼容 /v1/images/generations 原 response.data[i].b64_json 数组 */
  b64Images: string[];
  /** 实际用的 model(回显,方便前端记录) */
  model: string;
  /** Upstream response 整体耗时(ms) */
  durationMs: number;
}

export class PassthroughError extends Error {
  constructor(
    public readonly upstreamStatus: number | null,
    public readonly upstreamCode: string | null,
    message: string,
  ) {
    super(message);
    this.name = "PassthroughError";
  }
}

export async function passthroughGenerate(input: PassthroughInput): Promise<PassthroughOutput> {
  const started = Date.now();
  const client = new OpenAI({
    apiKey: input.apiKey,
    baseURL: input.baseUrl,
    timeout: 600_000,
    ...(input.useCodexHeader ? { defaultHeaders: CODEX_CLI_HEADERS } : {}),
  });

  try {
    // gpt-image-2 / 多数兼容代理接受 SDK enum 之外的 size 值(如 'auto'),
    // 走 unchecked cast,跟主线 drivers/image/openai-compatible.ts 一致做法。
    const body = {
      model: input.model,
      prompt: appendImageCleanlinessInstruction(input.prompt),
      ...(input.size ? { size: input.size } : {}),
      ...(input.n ? { n: input.n } : {}),
      response_format: "b64_json",
    } as unknown as Parameters<typeof client.images.generate>[0];

    const res = await client.images.generate(
      body,
      input.signal ? { signal: input.signal } : undefined,
    );

    const b64Images = (res.data ?? [])
      .map(d => d.b64_json)
      .filter((v): v is string => typeof v === "string" && v.length > 0);
    if (b64Images.length === 0) {
      throw new PassthroughError(null, "empty_response", "upstream returned no b64 images");
    }

    return { b64Images, model: input.model, durationMs: Date.now() - started };
  } catch (err) {
    if (err instanceof PassthroughError) throw err;
    if (err instanceof APIError) {
      throw new PassthroughError(err.status ?? null, err.code ?? null, err.message);
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new PassthroughError(null, null, msg);
  }
}
