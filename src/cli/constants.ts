// CLI constants

export const COMMANDS = [
  { name: "help", alias: "h", description: "Show available commands" },
  { name: "clear", alias: null, description: "Clear the screen" },
  { name: "continue", alias: "c", description: "Continue last conversation" },
  { name: "new", alias: "n", description: "Start new conversation" },
  { name: "compact", alias: null, description: "Compact conversation context" },
  { name: "reload", alias: "r", description: "Re-inject CLAUDE.md/AGENT.md on next message" },
  { name: "docs", alias: "d", description: "Show loaded project docs (CLAUDE.md, AGENT.md)" },
  { name: "model", alias: "m", description: "Change model (sonnet/opus/haiku)" },
  { name: "thinking", alias: "t", description: "Toggle thinking mode (on/off [budget])" },
  { name: "keys", alias: "k", description: "Show/sync API keys with server" },
  { name: "mcp", alias: null, description: "Manage MCP servers (list/add/remove)" },
  { name: "plan", alias: "p", description: "Toggle plan mode (or: on/off/show/clear)" },
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
