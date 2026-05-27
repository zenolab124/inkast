/**
 * 兜底(builtin)LLM 通道配置。镜像 builtin-image-config.ts。
 * baseUrl + apiKey 都到位才算 enabled。
 *
 *   PUBLIC_BUILTIN_LLM_BASE_URL
 *   PUBLIC_BUILTIN_LLM_API_KEY      → keychain `api-builtin-llm-key`
 *   PUBLIC_BUILTIN_LLM_MODEL        默认 'gpt-4o-mini'
 *   PUBLIC_BUILTIN_LLM_USE_CODEX_HEADER
 *   PUBLIC_BUILTIN_LLM_COST_PER_CALL 默认 1
 */
export interface BuiltinLlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  useCodexHeader: boolean;
  costPerCall: number;
  enabled: boolean;
}

let _cached: BuiltinLlmConfig | null = null;

export function loadBuiltinLlmConfig(): BuiltinLlmConfig {
  if (_cached) return _cached;
  const baseUrl = process.env.PUBLIC_BUILTIN_LLM_BASE_URL?.trim() ?? "";
  const apiKey = process.env.PUBLIC_BUILTIN_LLM_API_KEY?.trim() ?? "";
  const model = process.env.PUBLIC_BUILTIN_LLM_MODEL?.trim() || "gpt-4o-mini";
  const useCodexHeader = process.env.PUBLIC_BUILTIN_LLM_USE_CODEX_HEADER === "1";
  const costRaw = Number(process.env.PUBLIC_BUILTIN_LLM_COST_PER_CALL ?? "1");
  const costPerCall = Number.isFinite(costRaw) && costRaw > 0 ? Math.floor(costRaw) : 1;
  _cached = {
    baseUrl,
    apiKey,
    model,
    useCodexHeader,
    costPerCall,
    enabled: Boolean(baseUrl && apiKey),
  };
  return _cached;
}
