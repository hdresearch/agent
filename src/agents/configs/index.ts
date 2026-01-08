// Agent configuration registry
// Maps agent identities to their specific configurations

import type { AcpAgentConfig } from "../../protocol/acp-types";
import { DEFAULT_ACP_CONFIG } from "../../protocol/acp-types";
import { CLAUDE_CODE_CONFIG } from "./claude-code";
import { CODEX_CONFIG } from "./codex";

// Registry of agent configs by identity
const AGENT_CONFIGS: Record<string, AcpAgentConfig> = {
  // Claude Code variants
  "claude.com": CLAUDE_CODE_CONFIG,
  "anthropic.claude-code": CLAUDE_CODE_CONFIG,

  // Codex variants
  "openai.com": CODEX_CONFIG,
  "openai.codex-acp": CODEX_CONFIG,
  "zed-industries.codex-acp": CODEX_CONFIG,
};

/**
 * Get the config for an agent by identity
 * Falls back to DEFAULT_ACP_CONFIG if no specific config exists
 */
export function getAgentConfig(identity: string): AcpAgentConfig {
  return AGENT_CONFIGS[identity] ?? DEFAULT_ACP_CONFIG;
}

/**
 * Register a custom agent config
 */
export function registerAgentConfig(
  identity: string,
  config: AcpAgentConfig
): void {
  AGENT_CONFIGS[identity] = config;
}

/**
 * Check if an agent has a specific config registered
 */
export function hasAgentConfig(identity: string): boolean {
  return identity in AGENT_CONFIGS;
}

// Re-export individual configs for direct access
export { CLAUDE_CODE_CONFIG } from "./claude-code";
export { CODEX_CONFIG } from "./codex";
