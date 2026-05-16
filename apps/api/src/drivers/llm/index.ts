import type { LlmBackendDescriptor } from "@inkast/shared";
import { BUILTIN_CLAUDE_CODE_ID } from "../../storage/providers.js";
import { ClaudeCodeDriver } from "./claude-code.js";
import { OpenAiCompatibleDriver } from "./openai-compatible.js";
import type { LlmDriver } from "./types.js";

export * from "./types.js";
export type { LlmBackendDescriptor };

/**
 * Driver cache: instances are reused across calls so each driver's internal
 * state (warmup freshness window, in-flight dedup) actually accumulates. For
 * openai-compatible we key on providerId so editing/deleting a provider
 * doesn't poison another provider's cached instance.
 *
 * Cached instances re-read the underlying provider record from SQLite on every
 * call (see OpenAiCompatibleDriver.completeJson), so config edits take effect
 * without needing to invalidate this cache.
 */
const cache = new Map<string, LlmDriver>();

function isBuiltinClaudeCode(backend: LlmBackendDescriptor): boolean {
  if (backend === "claude-code") return true;
  if (typeof backend === "object" && backend.providerId === BUILTIN_CLAUDE_CODE_ID) {
    return true;
  }
  return false;
}

function cacheKey(backend: LlmBackendDescriptor): string {
  if (isBuiltinClaudeCode(backend)) return "claude-code";
  return typeof backend === "string" ? backend : `openai-compatible:${backend.providerId}`;
}

export function getLlmDriver(backend: LlmBackendDescriptor = "claude-code"): LlmDriver {
  const key = cacheKey(backend);
  const existing = cache.get(key);
  if (existing) return existing;

  let driver: LlmDriver;
  if (isBuiltinClaudeCode(backend)) {
    driver = new ClaudeCodeDriver();
  } else if (typeof backend === "object" && backend.kind === "openai-compatible") {
    if (!backend.providerId?.trim()) {
      throw new Error("openai-compatible backend requires a providerId");
    }
    driver = new OpenAiCompatibleDriver(backend.providerId);
  } else {
    throw new Error(`unknown LLM backend: ${JSON.stringify(backend)}`);
  }
  cache.set(key, driver);
  return driver;
}
