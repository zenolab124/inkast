import { ClaudeCodeDriver } from "./claude-code.js";
import type { LlmBackend, LlmDriver } from "./types.js";

export * from "./types.js";

const cache = new Map<LlmBackend, LlmDriver>();

export function getLlmDriver(backend: LlmBackend = "claude-code"): LlmDriver {
  const existing = cache.get(backend);
  if (existing) return existing;

  let driver: LlmDriver;
  switch (backend) {
    case "claude-code":
      driver = new ClaudeCodeDriver();
      break;
    case "openai-compatible":
      throw new Error("openai-compatible LLM driver is Phase 1.5 — not implemented yet");
    default: {
      const _exhaustive: never = backend;
      throw new Error(`unknown LLM backend: ${String(_exhaustive)}`);
    }
  }
  cache.set(backend, driver);
  return driver;
}
