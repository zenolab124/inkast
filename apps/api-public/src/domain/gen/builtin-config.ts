/**
 * 兜底(builtin)生图通道配置:Phase 1 单 provider,env 化。Phase 2 想做
 * priority 池再升级到 SQLite providers 表。
 *
 * 本地 dev 没配 → enabled=false → endpoint 返 503,用户改走透明代理。
 * 生产 jdc 通过 systemd EnvironmentFile 注入完整配置。
 *
 * 凭据存放约定:
 *   PUBLIC_BUILTIN_PROVIDER_API_KEY  → keychain service `api-builtin-image-key`
 *                                       (本地 dev)/ jdc env(生产)
 *   其它字段是公开配置,直接 env。
 */
export interface BuiltinConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  useCodexHeader: boolean;
  /** 一次生图扣多少次余额。默认 1。 */
  costPerImage: number;
  /** baseUrl + apiKey 都到位才算 enabled。 */
  enabled: boolean;
}

let _cached: BuiltinConfig | null = null;

export function loadBuiltinConfig(): BuiltinConfig {
  if (_cached) return _cached;

  const baseUrl = process.env.PUBLIC_BUILTIN_PROVIDER_BASE_URL?.trim() ?? "";
  const apiKey = process.env.PUBLIC_BUILTIN_PROVIDER_API_KEY?.trim() ?? "";
  const model = process.env.PUBLIC_BUILTIN_PROVIDER_MODEL?.trim() || "gpt-image-2";
  const useCodexHeader = process.env.PUBLIC_BUILTIN_USE_CODEX_HEADER === "1";
  const costRaw = Number(process.env.PUBLIC_BUILTIN_COST_PER_IMAGE ?? "1");
  const costPerImage = Number.isFinite(costRaw) && costRaw > 0 ? Math.floor(costRaw) : 1;

  _cached = {
    baseUrl,
    apiKey,
    model,
    useCodexHeader,
    costPerImage,
    enabled: Boolean(baseUrl && apiKey),
  };
  return _cached;
}
