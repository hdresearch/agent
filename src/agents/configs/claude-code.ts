// Claude Code agent configuration

import type { AcpAgentConfig } from "../../protocol/acp-types";

export const CLAUDE_CODE_CONFIG: AcpAgentConfig = {
  clientInfo: {
    name: "vers-agent",
    version: "0.1.0",
  },
  capabilities: {
    fileSystem: { read: true, write: true },
    terminal: { create: true },
  },
  defaultModel: "claude-sonnet-4-20250514",
  authMethods: ["api_key"],
};
