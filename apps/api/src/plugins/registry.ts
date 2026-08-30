import type { LlmBackendDescriptor } from "../drivers/llm/index.js";
import { loadPluginConfigsFromDir } from "./loader.js";
import type { InkastPlugin } from "./types.js";

/**
 * Plugin 通道注册表。
 *
 * 客户特化配置通过 **JSON overlay 机制** 加载,主线代码不包含任何具体客户
 * plugin 文件:
 *
 *   1. 启动时读 env `INKAST_PLUGIN_DIR`(指向一个目录,通常是 overlay 仓
 *      rsync 到部署机的位置,如 `/etc/inkast/plugins`)
 *   2. 扫该目录下所有 `*.json`,zod 校验后注入 in-memory registry
 *   3. 同步读 `INKAST_PLUGIN_TOKEN_<UPPER_ID>` env,匹配到对应 plugin
 *
 * Token 不放 JSON 里(秘密 + 部署时 env 注入 / 文件系统权限分层管理)。
 * Plugin 业务约束(systemPromptPatch / enforceFields / 等)放 JSON 里。
 *
 * 见 docs/plugin-overlay.md。
 */

const plugins = new Map<string, InkastPlugin>();
const tokenToPluginId = new Map<string, string>();

const TOKEN_ENV_PREFIX = "INKAST_PLUGIN_TOKEN_";

function loadPluginsFromOverlayDir(): void {
  const dir = process.env.INKAST_PLUGIN_DIR?.trim();
  if (!dir) {
    console.warn(
      `[plugins] INKAST_PLUGIN_DIR not set; no plugin overlays loaded. ` +
        `/plugins/* routes will reject all requests with 401.`,
    );
    return;
  }
  const configs = loadPluginConfigsFromDir(dir);
  for (const p of configs) {
    plugins.set(p.id, p);
  }
  if (plugins.size === 0) {
    console.warn(
      `[plugins] INKAST_PLUGIN_DIR=${dir} loaded 0 plugins; /plugins/* will reject all requests with 401`,
    );
  } else {
    console.log(`[plugins] ${plugins.size} plugin(s) loaded from overlay dir`);
  }
}

function loadTokensFromEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (!key.startsWith(TOKEN_ENV_PREFIX)) continue;
    const pluginId = key.slice(TOKEN_ENV_PREFIX.length).toLowerCase();
    const token = process.env[key]?.trim();
    if (!token) continue;
    if (!plugins.has(pluginId)) {
      console.warn(
        `[plugins] env ${key} matches no registered plugin (resolved id=${pluginId}); ignored`,
      );
      continue;
    }
    if (tokenToPluginId.has(token)) {
      console.warn(`[plugins] duplicate token across plugins (env ${key} ignored)`);
      continue;
    }
    tokenToPluginId.set(token, pluginId);
    console.log(
      `[plugins] loaded token for plugin '${pluginId}' (token-len=${token.length})`,
    );
  }
  if (plugins.size > 0 && tokenToPluginId.size === 0) {
    console.warn(
      `[plugins] ${plugins.size} plugin(s) registered but no tokens loaded; all requests will 401. ` +
        `Set ${TOKEN_ENV_PREFIX}<PLUGIN_ID_UPPERCASE>=<token> in env.`,
    );
  }
}

// 模块加载即执行 — 顺序重要:先加载 plugin 实例,再匹配 token。
loadPluginsFromOverlayDir();
loadTokensFromEnv();

export function getPluginByToken(token: string): InkastPlugin | undefined {
  const id = tokenToPluginId.get(token);
  return id ? plugins.get(id) : undefined;
}

export function getPluginById(id: string): InkastPlugin | undefined {
  return plugins.get(id);
}

export function listRegisteredPlugins(): InkastPlugin[] {
  return Array.from(plugins.values());
}

/**
 * 解析 plugin 实际要用的 LLM backend:
 *   1. plugin 自带 llmBackend → 用 plugin 的
 *   2. 否则看 INKAST_DEFAULT_LLM_PROVIDER_ID env(部署期配)
 *   3. 都没有 → 回落 "claude-code"(本地开发场景)
 */
export function resolveLlmBackend(plugin: InkastPlugin): LlmBackendDescriptor {
  if (plugin.llmBackend) return plugin.llmBackend;
  const fallback = process.env.INKAST_DEFAULT_LLM_PROVIDER_ID?.trim();
  if (fallback) {
    return { kind: "openai-compatible", providerId: fallback };
  }
  return "claude-code";
}
