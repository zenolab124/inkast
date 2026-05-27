/**
 * Codex CLI header injection shared by image and LLM drivers.
 *
 * Some OpenAI-compatible proxies gate quota / moderation by client identity:
 * only requests that look like the official Codex CLI get full quota and
 * loose moderation. A single `extras.useCodexHeader: true` checkbox on a
 * capability flips on a fixed header set that mimics that client. Operator
 * toggles it in the Web UI; raw header values are not user-editable to
 * avoid drift.
 *
 * Pinned version intentionally — Codex bumps these strings over time but
 * the proxies we target only care about the originator tag and a
 * Codex-shaped User-Agent, not the exact version number.
 */

import type { ProviderCapability } from "../storage/providers.js";

export const CODEX_CLI_HEADERS: Record<string, string> = {
  originator: "codex_cli_rs",
  "User-Agent": "codex_cli_rs/0.49.0 (Darwin 25.5.0; arm64) terminal",
};

export function resolveExtraHeaders(
  capability: ProviderCapability,
): Record<string, string> | undefined {
  return capability.extras?.useCodexHeader === true ? CODEX_CLI_HEADERS : undefined;
}
