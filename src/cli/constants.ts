// CLI constants

export const COMMANDS = [
  { name: "help", alias: "h", description: "Show available commands" },
  { name: "clear", alias: null, description: "Clear the screen" },
  { name: "continue", alias: "c", description: "Continue last conversation" },
  { name: "new", alias: "n", description: "Start new conversation" },
  { name: "sessions", alias: "s", description: "List sessions (or: /session <id> to switch)" },
  { name: "session", alias: null, description: "Switch to session by ID" },
  { name: "usage", alias: "u", description: "Show session usage statistics" },
  { name: "compact", alias: null, description: "Compact conversation context" },
  { name: "reload", alias: "r", description: "Re-inject CLAUDE.md/AGENT.md on next message" },
  { name: "docs", alias: "d", description: "Show loaded project docs (CLAUDE.md, AGENT.md)" },
  { name: "model", alias: "m", description: "Change model (sonnet/opus/haiku)" },
  { name: "keys", alias: "k", description: "Show/sync API keys with server" },
  { name: "mcp", alias: null, description: "Manage MCP servers (list/add/remove)" },
  { name: "agent", alias: "a", description: "Manage agents (list/select/status)" },
  { name: "plan", alias: "p", description: "Toggle plan mode (or: on/off/show/clear)" },
  { name: "token", alias: null, description: "Show connection token for this server" },
  { name: "connect", alias: null, description: "Connect to server (or: /connect <url>)" },
  { name: "local", alias: null, description: "Clear saved remote server for next launch" },
  { name: "skill", alias: null, description: "Manage skillsets (list/show/sync to remote)" },
  { name: "vm", alias: "v", description: "Manage VMs (list/create/branch/connect/delete)" },
  { name: "vm:list", alias: null, description: "Show VMs with tree structure" },
  { name: "vm:new", alias: null, description: "Create a new root VM" },
  { name: "vm:branch", alias: null, description: "Fork an existing VM (optionally N times)" },
  { name: "vm:connect", alias: null, description: "Connect CLI to VM's agent" },
  { name: "vm:delete", alias: null, description: "Delete a VM" },
  { name: "vm:status", alias: null, description: "Show current VM connection" },
  { name: "vm:run", alias: null, description: "Fire prompt to all VMs (fire & forget)" },
] as const;

export type Command = (typeof COMMANDS)[number];

export const TOOL_ICONS: Record<string, string> = {
  Read: "📄",
  Write: "✏️",
  Edit: "🔧",
  Bash: "💻",
  Glob: "🔍",
  Grep: "🔎",
  WebFetch: "🌐",
  WebSearch: "🔍",
  Task: "📋",
  TodoWrite: "✅",
};

// Context window limits by model
export const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  sonnet: 200000,
  opus: 200000,
  haiku: 200000,
};
