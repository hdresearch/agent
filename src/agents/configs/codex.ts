// OpenAI Codex agent configuration (via codex-acp)

import type { AcpAgentConfig } from "../../protocol/acp-types";

export const CODEX_CONFIG: AcpAgentConfig = {
  clientInfo: {
    name: "vers-agent",
    version: "0.1.0",
  },
  capabilities: {
    fileSystem: { read: true, write: true },
    terminal: { create: true },
  },
  defaultModel: "codex",
  // Codex supports multiple auth methods:
  // - chatgpt: Browser-based OAuth (for ChatGPT Plus users)
  // - codex_api_key: Codex API key
  // - openai_api_key: OpenAI API key
  authMethods: ["openai_api_key", "codex_api_key", "chatgpt"],
};
