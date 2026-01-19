// Slash command handlers

import type { HttpAcpClient } from "../../client/http-client";
import type { SessionConfig, AvailableCommandData } from "../../protocol/acp-types";
import type { OutputLine, StatusInfo } from "../types";
import { COMMANDS } from "../constants";
import { setConfig, getMcpServers, addMcpServer, removeMcpServer, type McpServerConfig } from "../../utils/config";
import { detectKeys, formatKeysDisplay } from "../../utils/keys";
import { createHistory, saveHistory, type ConversationHistory } from "../../utils/history";
import { isAgentCommand } from "../utils/command-matching";
import { getSessionUsage, formatTokens as formatTokensUsage } from "../../utils/claude-usage";

// Standalone API for VM operations (works without HTTP server)
import * as api from "../../api/standalone";

export interface CommandHandlerContext {
  client: HttpAcpClient | null;
  sessionConfig: SessionConfig;
  setSessionConfig: (config: Partial<SessionConfig>) => void;
  statusInfo: StatusInfo;
  setStatusInfo: React.Dispatch<React.SetStateAction<StatusInfo>>;
  addOutput: (line: Omit<OutputLine, "id">) => void;
  setOutput: React.Dispatch<React.SetStateAction<OutputLine[]>>;
  clearOutput: () => void;
  setContinueMode: (mode: boolean) => void;
  historyRef: React.MutableRefObject<ConversationHistory | null>;
  exit: () => void;
  reconnect: (url: string) => void;
  currentServerUrl?: string;
  agentCommands?: AvailableCommandData[];
}

export type CommandResult = {
  handled: boolean;
};

/**
 * Handle a slash command
 * @returns true if the command was handled, false if it should be passed to the agent
 */
export function handleSlashCommand(
  input: string,
  ctx: CommandHandlerContext
): CommandResult {
  const parts = input.slice(1).trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase() ?? "";
  const arg = parts[1];

  // Agent commands take precedence over local commands
  if (ctx.agentCommands && isAgentCommand(cmd, ctx.agentCommands)) {
    // Synced commands: perform local side effects AND pass to agent
    syncAgentCommandSideEffects(cmd, arg, parts, ctx);
    // Pass through to agent
    return { handled: false };
  }

  switch (cmd) {
    case "help":
    case "h":
      handleHelp(ctx);
      return { handled: true };

    case "continue":
    case "c":
      handleContinue(ctx);
      return { handled: true };

    case "new":
    case "n":
      handleNew(ctx);
      return { handled: true };

    case "sessions":
    case "s":
      handleSessions(ctx);
      return { handled: true };

    case "session":
      handleSession(arg, ctx);
      return { handled: true };

    case "clear":
      handleClear(ctx);
      return { handled: true };

    case "model":
    case "m":
      handleModel(arg, ctx);
      return { handled: true };

    case "compact":
      ctx.addOutput({ type: "system", content: "Compaction happens automatically when context fills up." });
      return { handled: true };

    case "reload":
    case "r":
      handleReload(ctx);
      return { handled: true };

    case "docs":
    case "d":
      handleDocs(ctx);
      return { handled: true };

    case "keys":
    case "k":
      handleKeys(ctx);
      return { handled: true };

    case "mcp":
      handleMcp(parts, ctx);
      return { handled: true };

    case "plan":
    case "p":
      handlePlan(arg, ctx);
      return { handled: true };

    case "agent":
    case "a":
      handleAgent(parts, ctx);
      return { handled: true };

    case "usage":
    case "u":
      handleUsage(ctx);
      return { handled: true };

    case "token":
      handleToken(ctx);
      return { handled: true };

    case "connect":
      handleConnect(arg, ctx);
      return { handled: true };

    case "local":
      handleLocal(ctx);
      return { handled: true };

    case "skill":
      handleSkill(parts, ctx).catch(err => {
        ctx.addOutput({ type: "error", content: `Skill error: ${err.message}` });
      });
      return { handled: true };

    case "vm":
    case "v":
    case "vm:list":
    case "vm:new":
    case "vm:create":
    case "vm:branch":
    case "vm:connect":
    case "vm:delete":
    case "vm:status":
    case "vm:run":
      handleVm(parts, ctx).catch(err => {
        ctx.addOutput({ type: "error", content: `VM error: ${err.message}` });
      });
      return { handled: true };

    default:
      // Pass unknown commands through to the agent - it may handle them
      // (e.g., /usage, /review, /compact are agent commands in Claude Code)
      return { handled: false };
  }
}

/**
 * Sync local CLI state when agent commands are executed.
 * This ensures the CLI display reflects what the agent is doing.
 */
function syncAgentCommandSideEffects(
  cmd: string,
  arg: string | undefined,
  parts: string[],
  ctx: CommandHandlerContext
): void {
  switch (cmd) {
    case "new":
    case "n":
      // Clear local output and reset history when agent starts new conversation
      ctx.setOutput([]);
      ctx.setContinueMode(false);
      ctx.historyRef.current = createHistory("new");
      saveHistory(ctx.historyRef.current);
      break;

    case "clear":
      // Clear local output display when agent clears
      ctx.setOutput([]);
      break;

    case "model":
    case "m": {
      // Sync model change to status bar
      const validModels = ["sonnet", "opus", "haiku"];
      if (arg && validModels.includes(arg.toLowerCase())) {
        const model = arg.toLowerCase();
        ctx.setStatusInfo(prev => ({ ...prev, model }));
        setConfig({ model }); // Persist locally too
      }
      break;
    }

    // Other agent commands don't need local side effects
    // /compact, /cost, /config, /help, etc. - just pass through
  }
}

function handleHelp(ctx: CommandHandlerContext): void {
  ctx.addOutput({ type: "system", content: "" });
  ctx.addOutput({ type: "system", content: "Available commands:" });
  for (const c of COMMANDS) {
    const alias = c.alias ? ` (/${c.alias})` : "";
    ctx.addOutput({ type: "system", content: `  /${c.name}${alias} - ${c.description}` });
  }
  ctx.addOutput({ type: "system", content: "  exit - Quit the CLI" });
  ctx.addOutput({ type: "system", content: "" });
  ctx.addOutput({ type: "system", content: "Bash escape:" });
  ctx.addOutput({ type: "system", content: "  !<command> - Execute bash command (e.g., !ls -la)" });
  ctx.addOutput({ type: "system", content: "" });
}

function handleContinue(ctx: CommandHandlerContext): void {
  ctx.setContinueMode(true);
  ctx.addOutput({ type: "system", content: "↩ Will continue last conversation" });
}

function handleNew(ctx: CommandHandlerContext): void {
  console.error("[DEBUG] handleNew called"); // Debug log to stderr
  ctx.setContinueMode(false);
  // Reset history
  ctx.historyRef.current = createHistory("new");
  saveHistory(ctx.historyRef.current);
  
  // Clear screen and set new output atomically (avoid stale state from addOutput)
  console.error("[DEBUG] About to clear screen"); // Debug log
  process.stdout.write("\x1b[2J\x1b[H");
  console.error("[DEBUG] About to setOutput"); // Debug log
  ctx.setOutput([{ type: "system", content: "🆕 Starting new conversation", id: `new-${Date.now()}` }]);
  console.error("[DEBUG] setOutput called"); // Debug log
  
  ctx.client?.newSession(ctx.sessionConfig)
    .then((result) => {
      console.error("[DEBUG] newSession resolved", result.sessionId); // Debug log
      ctx.setStatusInfo(prev => ({ ...prev, sessionId: result.sessionId }));
    })
    .catch((err) => {
      console.error("[DEBUG] newSession failed", err); // Debug log
    });
}

function handleSessions(ctx: CommandHandlerContext): void {
  if (!ctx.client) {
    ctx.addOutput({ type: "error", content: "Not connected to server" });
    return;
  }

  ctx.client.listSessions()
    .then((result) => {
      if (result.sessions.length === 0) {
        ctx.addOutput({ type: "system", content: "No sessions found." });
        ctx.addOutput({ type: "system", content: "Start a new session by sending a message." });
        return;
      }

      ctx.addOutput({ type: "system", content: "" });
      ctx.addOutput({ type: "system", content: `Sessions (${result.sessions.length}):` });
      ctx.addOutput({ type: "system", content: "" });

      for (const session of result.sessions) {
        const isCurrent = session.id === result.currentSessionId;
        const marker = isCurrent ? "→ " : "  ";
        const name = session.name ? ` "${session.name}"` : "";
        const lastUsed = formatRelativeTime(new Date(session.lastUsedAt));
        const cost = session.totalCost > 0 ? ` · $${session.totalCost.toFixed(4)}` : "";
        const mode = session.mode === "plan" ? " [plan]" : "";

        // Show short ID (first 8 chars)
        const shortId = session.id.slice(0, 8);

        ctx.addOutput({
          type: "system",
          content: `${marker}${shortId}${name}${mode} - ${session.turns} turns${cost} - ${lastUsed}`,
        });
      }

      ctx.addOutput({ type: "system", content: "" });
      ctx.addOutput({ type: "system", content: "Switch to a session: /session <id>" });
    })
    .catch((err) => {
      ctx.addOutput({ type: "error", content: `Failed to list sessions: ${err.message}` });
    });
}

function handleSession(sessionId: string | undefined, ctx: CommandHandlerContext): void {
  if (!ctx.client) {
    ctx.addOutput({ type: "error", content: "Not connected to server" });
    return;
  }

  if (!sessionId) {
    ctx.addOutput({ type: "system", content: "Usage: /session <id>" });
    ctx.addOutput({ type: "system", content: "Use /sessions to list available sessions." });
    return;
  }

  // Allow partial session IDs - find matching session
  ctx.client.listSessions()
    .then((result) => {
      // Find session matching the provided ID (prefix match)
      const matches = result.sessions.filter(s => s.id.startsWith(sessionId));

      if (matches.length === 0) {
        ctx.addOutput({ type: "error", content: `No session found matching: ${sessionId}` });
        ctx.addOutput({ type: "system", content: "Use /sessions to list available sessions." });
        return;
      }

      if (matches.length > 1) {
        ctx.addOutput({ type: "error", content: `Multiple sessions match "${sessionId}":` });
        for (const s of matches.slice(0, 5)) {
          ctx.addOutput({ type: "system", content: `  ${s.id.slice(0, 8)}` });
        }
        ctx.addOutput({ type: "system", content: "Please provide a more specific ID." });
        return;
      }

      const session = matches[0]!;

      // Switch to this session
      return ctx.client!.loadSession(session.id)
        .then(async (loadResult) => {
          ctx.setContinueMode(true);
          // Update session ID in status bar
          ctx.setStatusInfo(prev => ({ ...prev, sessionId: loadResult.sessionId }));
          // Clear local output cache - start fresh for this session
          ctx.clearOutput();

          // Sync outputs from server
          try {
            const outputsResult = await ctx.client!.getSessionOutputs();
            if (outputsResult.outputs.length > 0) {
              ctx.addOutput({ type: "system", content: `📜 Loading ${outputsResult.outputs.length} previous messages...` });
              for (const output of outputsResult.outputs) {
                ctx.addOutput({
                  type: output.type as "user" | "text" | "tool" | "tool-result" | "system" | "error" | "stats",
                  content: output.content,
                  color: output.color,
                  toolName: output.toolName,
                });
              }
            }
          } catch {
            // Ignore sync errors
          }
        });
    })
    .catch((err) => {
      ctx.addOutput({ type: "error", content: `Failed to switch session: ${err.message}` });
    });
}

// Helper function for relative time formatting
function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function handleClear(ctx: CommandHandlerContext): void {
  process.stdout.write("\x1b[2J\x1b[H"); // Clear screen and move cursor to top
  ctx.setOutput([]);
}

function handleModel(arg: string | undefined, ctx: CommandHandlerContext): void {
  const models = ["sonnet", "opus", "haiku"];
  if (arg && models.includes(arg.toLowerCase())) {
    ctx.setSessionConfig({ model: arg.toLowerCase() });
    ctx.setStatusInfo(prev => ({ ...prev, model: arg.toLowerCase() }));
    setConfig({ model: arg.toLowerCase() }); // Persist to config file
    ctx.addOutput({ type: "system", content: `Model set to: ${arg.toLowerCase()}` });
  } else {
    ctx.addOutput({ type: "system", content: `Current model: ${ctx.sessionConfig.model || "opus"}` });
    ctx.addOutput({ type: "system", content: `Usage: /model <sonnet|opus|haiku>` });
  }
}

function handleReload(ctx: CommandHandlerContext): void {
  if (ctx.client) {
    ctx.client.reloadDocs()
      .then((result) => {
        ctx.addOutput({ type: "system", content: `✓ ${result.message}` });
      })
      .catch((err) => {
        ctx.addOutput({ type: "error", content: `Failed to reload docs: ${err.message}` });
      });
  }
}

function handleDocs(ctx: CommandHandlerContext): void {
  if (ctx.client) {
    ctx.client.getDocs()
      .then((result) => {
        if (result.docs.length === 0) {
          ctx.addOutput({ type: "system", content: "No project docs loaded." });
          ctx.addOutput({ type: "system", content: "Place CLAUDE.md, AGENT.md, or AGENTS.md in your project directory." });
        } else {
          ctx.addOutput({ type: "system", content: `Loaded ${result.docs.length} doc(s):` });
          for (const doc of result.docs) {
            const size = doc.content.length;
            const sizeStr = size > 1024 ? `${(size / 1024).toFixed(1)}KB` : `${size}B`;
            ctx.addOutput({ type: "system", content: `  ${doc.name} (${sizeStr}) - ${doc.path}` });
          }
          ctx.addOutput({ type: "system", content: "" });
          ctx.addOutput({ type: "system", content: `Auto-loaded: ${result.store.autoLoaded ? "yes" : "no (set via API)"}` });
          ctx.addOutput({ type: "system", content: `Last loaded: ${new Date(result.store.loadedAt).toLocaleString()}` });
        }
      })
      .catch((err) => {
        ctx.addOutput({ type: "error", content: `Failed to get docs: ${err.message}` });
      });
  }
}

function handleKeys(ctx: CommandHandlerContext): void {
  const localKeys = detectKeys();
  ctx.addOutput({ type: "system", content: "" });
  for (const line of formatKeysDisplay(localKeys).split("\n")) {
    ctx.addOutput({ type: "system", content: line });
  }
  ctx.addOutput({ type: "system", content: "" });

  // Sync keys to server
  if (localKeys.length > 0 && ctx.client) {
    const keysMap = Object.fromEntries(localKeys.map(k => [k.name, k.value]));
    ctx.client.authenticate(keysMap)
      .then(() => {
        ctx.addOutput({ type: "system", content: `✓ Synced ${localKeys.length} keys to server` });
      })
      .catch((err) => {
        ctx.addOutput({ type: "error", content: `Failed to sync keys: ${err.message}` });
      });
  }
}

function handleMcp(parts: string[], ctx: CommandHandlerContext): void {
  const subCmd = parts[1]?.toLowerCase();
  const serverName = parts[2];

  // Helper to display servers
  const displayServers = (servers: Record<string, unknown>) => {
    const serverNames = Object.keys(servers);
    if (serverNames.length === 0) {
      ctx.addOutput({ type: "system", content: "No MCP servers configured." });
      ctx.addOutput({ type: "system", content: "" });
      ctx.addOutput({ type: "system", content: "Usage:" });
      ctx.addOutput({ type: "system", content: "  /mcp add <name> <command> [args...]  - Add stdio server" });
      ctx.addOutput({ type: "system", content: "  /mcp add-sse <name> <url>            - Add SSE server" });
      ctx.addOutput({ type: "system", content: "  /mcp remove <name>                   - Remove server" });
      ctx.addOutput({ type: "system", content: "  /mcp list                            - List servers" });
    } else {
      ctx.addOutput({ type: "system", content: `MCP Servers (${serverNames.length}):` });
      for (const name of serverNames) {
        const server = servers[name] as Record<string, unknown>;
        if (server.type === "sse") {
          ctx.addOutput({ type: "system", content: `  ${name} (SSE): ${server.url}` });
        } else if (server.type === "http") {
          ctx.addOutput({ type: "system", content: `  ${name} (HTTP): ${server.url}` });
        } else {
          // stdio
          const args = (server.args as string[] | undefined)?.join(" ") || "";
          ctx.addOutput({ type: "system", content: `  ${name} (stdio): ${server.command} ${args}`.trim() });
        }
      }
    }
  };

  if (!subCmd || subCmd === "list") {
    // List MCP servers - use client API if connected
    if (ctx.client) {
      ctx.client.mcpList()
        .then((result) => displayServers(result.servers))
        .catch((err) => ctx.addOutput({ type: "error", content: `Failed to list MCP servers: ${err.message}` }));
    } else {
      displayServers(getMcpServers());
    }
    return;
  }

  if (subCmd === "add" && serverName) {
    // /mcp add <name> <command> [args...]
    const command = parts[3];
    const args = parts.slice(4);
    if (!command) {
      ctx.addOutput({ type: "error", content: "Usage: /mcp add <name> <command> [args...]" });
    } else {
      const config = { command, args: args.length > 0 ? args : undefined };
      if (ctx.client) {
        ctx.client.mcpAdd(serverName, config)
          .then(() => {
            ctx.addOutput({ type: "system", content: `✓ Added MCP server: ${serverName}` });
            ctx.addOutput({ type: "system", content: `  Command: ${command} ${args.join(" ")}`.trim() });
            ctx.addOutput({ type: "system", content: "  Server will be available on next prompt." });
          })
          .catch((err) => ctx.addOutput({ type: "error", content: `Failed to add MCP server: ${err.message}` }));
      } else {
        addMcpServer(serverName, config as McpServerConfig).then(() => {
          ctx.addOutput({ type: "system", content: `✓ Added MCP server: ${serverName}` });
          ctx.addOutput({ type: "system", content: `  Command: ${command} ${args.join(" ")}`.trim() });
          ctx.addOutput({ type: "system", content: "  Server will be available on next prompt." });
        });
      }
    }
    return;
  }

  if (subCmd === "add-sse" && serverName) {
    // /mcp add-sse <name> <url>
    const url = parts[3];
    if (!url) {
      ctx.addOutput({ type: "error", content: "Usage: /mcp add-sse <name> <url>" });
    } else {
      const config = { type: "sse" as const, url };
      if (ctx.client) {
        ctx.client.mcpAdd(serverName, config)
          .then(() => {
            ctx.addOutput({ type: "system", content: `✓ Added MCP SSE server: ${serverName}` });
            ctx.addOutput({ type: "system", content: `  URL: ${url}` });
            ctx.addOutput({ type: "system", content: "  Server will be available on next prompt." });
          })
          .catch((err) => ctx.addOutput({ type: "error", content: `Failed to add MCP server: ${err.message}` }));
      } else {
        addMcpServer(serverName, config).then(() => {
          ctx.addOutput({ type: "system", content: `✓ Added MCP SSE server: ${serverName}` });
          ctx.addOutput({ type: "system", content: `  URL: ${url}` });
          ctx.addOutput({ type: "system", content: "  Server will be available on next prompt." });
        });
      }
    }
    return;
  }

  if (subCmd === "add-http" && serverName) {
    // /mcp add-http <name> <url>
    const url = parts[3];
    if (!url) {
      ctx.addOutput({ type: "error", content: "Usage: /mcp add-http <name> <url>" });
    } else {
      const config = { type: "http" as const, url };
      if (ctx.client) {
        ctx.client.mcpAdd(serverName, config)
          .then(() => {
            ctx.addOutput({ type: "system", content: `✓ Added MCP HTTP server: ${serverName}` });
            ctx.addOutput({ type: "system", content: `  URL: ${url}` });
            ctx.addOutput({ type: "system", content: "  Server will be available on next prompt." });
          })
          .catch((err) => ctx.addOutput({ type: "error", content: `Failed to add MCP server: ${err.message}` }));
      } else {
        addMcpServer(serverName, config).then(() => {
          ctx.addOutput({ type: "system", content: `✓ Added MCP HTTP server: ${serverName}` });
          ctx.addOutput({ type: "system", content: `  URL: ${url}` });
          ctx.addOutput({ type: "system", content: "  Server will be available on next prompt." });
        });
      }
    }
    return;
  }

  if (subCmd === "remove" && serverName) {
    // /mcp remove <name>
    if (ctx.client) {
      ctx.client.mcpRemove(serverName)
        .then((result) => {
          if (result.success) {
            ctx.addOutput({ type: "system", content: `✓ Removed MCP server: ${serverName}` });
          } else {
            ctx.addOutput({ type: "error", content: `MCP server not found: ${serverName}` });
          }
        })
        .catch((err) => ctx.addOutput({ type: "error", content: `Failed to remove MCP server: ${err.message}` }));
    } else {
      removeMcpServer(serverName).then((removed) => {
        if (removed) {
          ctx.addOutput({ type: "system", content: `✓ Removed MCP server: ${serverName}` });
        } else {
          ctx.addOutput({ type: "error", content: `MCP server not found: ${serverName}` });
        }
      });
    }
    return;
  }

  ctx.addOutput({ type: "error", content: "Usage: /mcp <list|add|add-sse|add-http|remove> [name] [...]" });
}

function handlePlan(arg: string | undefined, ctx: CommandHandlerContext): void {
  const subCmd = arg?.toLowerCase();

  if (!subCmd) {
    // Toggle plan mode
    if (ctx.client) {
      const newMode = ctx.statusInfo.planMode ? "default" : "plan";
      ctx.client.setMode(newMode)
        .then(() => {
          if (newMode === "plan") {
            ctx.addOutput({ type: "system", content: "📋 Plan mode: ON" });
            ctx.addOutput({ type: "system", content: "  Agent will plan without executing tools." });
          } else {
            ctx.addOutput({ type: "system", content: "▶️ Plan mode: OFF" });
            ctx.addOutput({ type: "system", content: "  Agent will execute tools normally." });
          }
          ctx.setStatusInfo(prev => ({ ...prev, planMode: newMode === "plan" }));
        })
        .catch((err) => ctx.addOutput({ type: "error", content: `Failed to set mode: ${err.message}` }));
    } else {
      ctx.addOutput({ type: "error", content: "Not connected to server" });
    }
    return;
  }

  if (subCmd === "show") {
    // Show current plan and mode
    if (ctx.client) {
      ctx.client.getPlan()
        .then((result) => {
          const modeIcon = result.mode === "plan" ? "📋" : "▶️";
          ctx.addOutput({ type: "system", content: `${modeIcon} Mode: ${result.mode}` });
          if (result.plan.length === 0) {
            ctx.addOutput({ type: "system", content: "No plan entries." });
          } else {
            ctx.addOutput({ type: "system", content: `Plan (${result.plan.length} entries):` });
            for (const entry of result.plan) {
              const statusIcon = entry.status === "completed" ? "✓" :
                                entry.status === "in_progress" ? "⏳" :
                                entry.status === "failed" ? "✗" : "○";
              ctx.addOutput({ type: "system", content: `  ${statusIcon} [${entry.id}] ${entry.description}` });
            }
          }
        })
        .catch((err) => ctx.addOutput({ type: "error", content: `Failed to get plan: ${err.message}` }));
    } else {
      ctx.addOutput({ type: "error", content: "Not connected to server" });
    }
    return;
  }

  if (subCmd === "on") {
    // Enable plan mode
    if (ctx.client) {
      ctx.client.setMode("plan")
        .then(() => {
          ctx.addOutput({ type: "system", content: "📋 Plan mode: ON" });
          ctx.addOutput({ type: "system", content: "  Agent will plan without executing tools." });
          ctx.setStatusInfo(prev => ({ ...prev, planMode: true }));
        })
        .catch((err) => ctx.addOutput({ type: "error", content: `Failed to set mode: ${err.message}` }));
    } else {
      ctx.addOutput({ type: "error", content: "Not connected to server" });
    }
    return;
  }

  if (subCmd === "off") {
    // Disable plan mode
    if (ctx.client) {
      ctx.client.setMode("default")
        .then(() => {
          ctx.addOutput({ type: "system", content: "▶️ Plan mode: OFF" });
          ctx.addOutput({ type: "system", content: "  Agent will execute tools normally." });
          ctx.setStatusInfo(prev => ({ ...prev, planMode: false }));
        })
        .catch((err) => ctx.addOutput({ type: "error", content: `Failed to set mode: ${err.message}` }));
    } else {
      ctx.addOutput({ type: "error", content: "Not connected to server" });
    }
    return;
  }

  if (subCmd === "clear") {
    // Clear the current plan
    if (ctx.client) {
      ctx.client.clearPlan()
        .then(() => {
          ctx.addOutput({ type: "system", content: "✓ Plan cleared" });
        })
        .catch((err) => ctx.addOutput({ type: "error", content: `Failed to clear plan: ${err.message}` }));
    } else {
      ctx.addOutput({ type: "error", content: "Not connected to server" });
    }
    return;
  }

  ctx.addOutput({ type: "system", content: "Usage: /plan [on|off|show|clear]" });
  ctx.addOutput({ type: "system", content: "  (none) - Toggle plan mode" });
  ctx.addOutput({ type: "system", content: "  on     - Enable plan mode (no tool execution)" });
  ctx.addOutput({ type: "system", content: "  off    - Disable plan mode (normal execution)" });
  ctx.addOutput({ type: "system", content: "  show   - Show current plan and mode" });
  ctx.addOutput({ type: "system", content: "  clear  - Clear the current plan" });
}

async function handleUsage(ctx: CommandHandlerContext): Promise<void> {
  if (!ctx.client) {
    ctx.addOutput({ type: "error", content: "Not connected to server" });
    return;
  }

  try {
    // Get session info
    const result = await ctx.client.listSessions();
    const currentSession = result.sessions.find(s => s.id === result.currentSessionId);

    ctx.addOutput({ type: "system", content: "" });
    ctx.addOutput({ type: "system", content: "Usage Statistics" });
    ctx.addOutput({ type: "system", content: "─".repeat(40) });

    // Get Claude Code usage data
    const usage = await getSessionUsage(result.currentSessionId || null);

    if (currentSession) {
      // Current session stats
      const createdAt = new Date(currentSession.createdAt);
      const duration = Date.now() - createdAt.getTime();
      const durationMins = Math.floor(duration / 60000);
      const durationHours = Math.floor(durationMins / 60);
      const durationStr = durationHours > 0
        ? `${durationHours}h ${durationMins % 60}m`
        : `${durationMins}m`;

      ctx.addOutput({ type: "system", content: "" });
      ctx.addOutput({ type: "system", content: "Current Session:" });
      ctx.addOutput({ type: "system", content: `  ID: ${currentSession.id.slice(0, 8)}` });
      ctx.addOutput({ type: "system", content: `  Turns: ${currentSession.turns}` });
      ctx.addOutput({ type: "system", content: `  Duration: ${durationStr}` });
      ctx.addOutput({ type: "system", content: `  Mode: ${currentSession.mode}` });
    }

    // Show Claude Code token usage if available
    if (usage && (usage.totalInputTokens > 0 || usage.totalOutputTokens > 0)) {
      ctx.addOutput({ type: "system", content: "" });
      ctx.addOutput({ type: "system", content: "Token Usage (this session):" });
      ctx.addOutput({ type: "system", content: `  Input: ${formatTokensUsage(usage.totalInputTokens)} tokens` });
      ctx.addOutput({ type: "system", content: `  Output: ${formatTokensUsage(usage.totalOutputTokens)} tokens` });
      if (usage.totalCacheReadTokens > 0) {
        ctx.addOutput({ type: "system", content: `  Cache Read: ${formatTokensUsage(usage.totalCacheReadTokens)} tokens` });
      }
      if (usage.totalCacheWriteTokens > 0) {
        ctx.addOutput({ type: "system", content: `  Cache Write: ${formatTokensUsage(usage.totalCacheWriteTokens)} tokens` });
      }
      ctx.addOutput({ type: "system", content: `  Cost: $${usage.totalCostUsd.toFixed(4)}` });

      // Show per-model breakdown if multiple models used
      if (usage.deltas.length > 1) {
        ctx.addOutput({ type: "system", content: "" });
        ctx.addOutput({ type: "system", content: "  By Model:" });
        for (const delta of usage.deltas) {
          const modelShort = delta.model.includes("opus") ? "opus" : delta.model.includes("sonnet") ? "sonnet" : delta.model;
          ctx.addOutput({
            type: "system",
            content: `    ${modelShort}: ${formatTokensUsage(delta.inputTokens)} in, ${formatTokensUsage(delta.outputTokens)} out ($${delta.costUsd.toFixed(4)})`
          });
        }
      }
    } else if (usage === null) {
      ctx.addOutput({ type: "system", content: "" });
      ctx.addOutput({ type: "system", content: "  Token data: Not available (no baseline snapshot)" });
    }

    // Show model info
    ctx.addOutput({ type: "system", content: "" });
    ctx.addOutput({ type: "system", content: "Configuration:" });
    ctx.addOutput({ type: "system", content: `  Model: ${ctx.statusInfo.model}` });

    ctx.addOutput({ type: "system", content: "" });
  } catch (err) {
    ctx.addOutput({ type: "error", content: `Failed to get usage: ${err instanceof Error ? err.message : String(err)}` });
  }
}

function handleToken(ctx: CommandHandlerContext): void {
  if (!ctx.client) {
    ctx.addOutput({ type: "error", content: "Not connected to server" });
    return;
  }

  const token = ctx.client.authToken;
  const isOwner = ctx.client.isOwner;

  ctx.addOutput({ type: "system", content: "" });
  if (token) {
    ctx.addOutput({ type: "system", content: "Connection Token:" });
    ctx.addOutput({ type: "system", content: `  ${token}` });
    ctx.addOutput({ type: "system", content: "" });
    ctx.addOutput({ type: "system", content: isOwner ? "  Status: Owner (claimed this server)" : "  Status: Authorized" });
    ctx.addOutput({ type: "system", content: "" });
    ctx.addOutput({ type: "system", content: "  Keep this token safe! Anyone with this token can" });
    ctx.addOutput({ type: "system", content: "  access this server." });
  } else {
    ctx.addOutput({ type: "system", content: "No connection token available." });
    ctx.addOutput({ type: "system", content: "  Server may not be claimed yet." });
  }
  ctx.addOutput({ type: "system", content: "" });
}

function handleConnect(url: string | undefined, ctx: CommandHandlerContext): void {
  if (!url) {
    // Show current connection
    if (ctx.currentServerUrl) {
      ctx.addOutput({ type: "system", content: `Currently connected to: ${ctx.currentServerUrl}` });
    } else {
      ctx.addOutput({ type: "system", content: "Not connected to any server." });
    }
    ctx.addOutput({ type: "system", content: "" });
    ctx.addOutput({ type: "system", content: "Usage: /connect <url>" });
    ctx.addOutput({ type: "system", content: "Example: /connect http://192.168.1.100:9999" });
    return;
  }

  // Validate URL
  try {
    new URL(url);
  } catch {
    ctx.addOutput({ type: "error", content: `Invalid URL: ${url}` });
    return;
  }

  // Save URL for auto-reconnect (explicit /connect always saves)
  setConfig({ lastServerUrl: url }).catch(() => {});

  // Trigger reconnection
  ctx.reconnect(url);
}

function handleLocal(ctx: CommandHandlerContext): void {
  // Clear saved server URL and inform user
  setConfig({ lastServerUrl: null }).catch(() => {});
  ctx.addOutput({ type: "system", content: "Cleared saved remote server." });
  ctx.addOutput({ type: "system", content: "Next launch will start in local mode." });
  ctx.addOutput({ type: "system", content: "" });
  ctx.addOutput({ type: "system", content: "To connect to a server now, use: /connect <url>" });
}

function handleAgent(parts: string[], ctx: CommandHandlerContext): void {
  const subCmd = parts[1]?.toLowerCase();
  const agentId = parts[2];

  if (!ctx.client) {
    ctx.addOutput({ type: "error", content: "Not connected to server" });
    return;
  }

  // Helper to display agents
  const displayAgents = (agents: Array<{
    identity: string;
    name: string;
    shortName?: string;
    description: string;
    protocol: string;
    active: boolean;
  }>, currentAgent: string) => {
    if (agents.length === 0) {
      ctx.addOutput({ type: "system", content: "No agents available." });
      return;
    }

    ctx.addOutput({ type: "system", content: "" });
    ctx.addOutput({ type: "system", content: `Agents (${agents.length}):` });
    ctx.addOutput({ type: "system", content: "" });

    for (const agent of agents) {
      const isCurrent = agent.identity === currentAgent;
      const marker = isCurrent ? "→ " : "  ";
      const shortName = agent.shortName ? ` (${agent.shortName})` : "";
      const status = agent.active ? "" : " [inactive]";
      ctx.addOutput({
        type: "system",
        content: `${marker}${agent.identity}${shortName}${status}`,
      });
      ctx.addOutput({
        type: "system",
        content: `    ${agent.description || "No description"}`,
      });
      ctx.addOutput({
        type: "system",
        content: `    Protocol: ${agent.protocol}`,
      });
    }

    ctx.addOutput({ type: "system", content: "" });
    ctx.addOutput({ type: "system", content: "Switch agent: /agent select <id>" });
  };

  if (!subCmd || subCmd === "list") {
    // List available agents
    ctx.client.agentList()
      .then((result) => displayAgents(result.agents, result.currentAgent))
      .catch((err) => ctx.addOutput({ type: "error", content: `Failed to list agents: ${err.message}` }));
    return;
  }

  if (subCmd === "select" || subCmd === "use") {
    if (!agentId) {
      ctx.addOutput({ type: "error", content: "Usage: /agent select <agent-id>" });
      ctx.addOutput({ type: "system", content: "Use /agent list to see available agents." });
      return;
    }

    ctx.client.agentSelect(agentId)
      .then((result) => {
        if (result.success) {
          ctx.addOutput({ type: "system", content: `Switched to agent: ${result.agentId}` });
        } else {
          ctx.addOutput({ type: "error", content: result.message || `Failed to select agent: ${agentId}` });
        }
      })
      .catch((err) => ctx.addOutput({ type: "error", content: `Failed to select agent: ${err.message}` }));
    return;
  }

  if (subCmd === "status") {
    ctx.client.agentStatus()
      .then((result) => {
        ctx.addOutput({ type: "system", content: "" });
        ctx.addOutput({ type: "system", content: `Current agent: ${result.currentAgent}` });
        ctx.addOutput({ type: "system", content: `Protocol: ${result.protocol}` });
        ctx.addOutput({ type: "system", content: `Running: ${result.isRunning ? "yes" : "no"}` });
        ctx.addOutput({ type: "system", content: "" });
      })
      .catch((err) => ctx.addOutput({ type: "error", content: `Failed to get agent status: ${err.message}` }));
    return;
  }

  ctx.addOutput({ type: "system", content: "Usage: /agent <list|select|status> [agent-id]" });
  ctx.addOutput({ type: "system", content: "  list              - Show available agents" });
  ctx.addOutput({ type: "system", content: "  select <id>       - Switch to a different agent" });
  ctx.addOutput({ type: "system", content: "  status            - Show current agent status" });
}

async function handleSkill(parts: string[], ctx: CommandHandlerContext): Promise<void> {
  const subCmd = parts[1]?.toLowerCase();
  const skillsetName = parts[2];

  // Import skillset functions
  const { listSkillsets, getSkillset, getSkillsetsDir } = await import("../../utils/skillsets");

  if (!subCmd || subCmd === "list") {
    // List local skillsets
    const skillsets = await listSkillsets();
    if (skillsets.length === 0) {
      ctx.addOutput({ type: "system", content: "No skillsets defined." });
      ctx.addOutput({ type: "system", content: "" });
      ctx.addOutput({ type: "system", content: `Create skillsets in: ${getSkillsetsDir()}` });
      ctx.addOutput({ type: "system", content: "  Example: ~/.vers-agent/skillsets/coding/commit.md" });
      ctx.addOutput({ type: "system", content: "" });
      ctx.addOutput({ type: "system", content: "Then sync to remote: /skill sync <skillset>" });
    } else {
      ctx.addOutput({ type: "system", content: "" });
      ctx.addOutput({ type: "system", content: `Skillsets (${skillsets.length}):` });
      for (const name of skillsets) {
        const skillset = await getSkillset(name);
        const count = skillset?.skills.length || 0;
        ctx.addOutput({ type: "system", content: `  ${name} (${count} skills)` });
      }
      ctx.addOutput({ type: "system", content: "" });
      ctx.addOutput({ type: "system", content: "Sync to remote: /skill sync <skillset>" });
    }
    return;
  }

  if (subCmd === "show" && skillsetName) {
    const skillset = await getSkillset(skillsetName);
    if (!skillset) {
      ctx.addOutput({ type: "error", content: `Skillset not found: ${skillsetName}` });
      return;
    }

    ctx.addOutput({ type: "system", content: "" });
    ctx.addOutput({ type: "system", content: `Skillset: ${skillset.name}` });
    ctx.addOutput({ type: "system", content: `Skills (${skillset.skills.length}):` });
    for (const skill of skillset.skills) {
      ctx.addOutput({ type: "system", content: `  /${skill.name}` });
    }
    ctx.addOutput({ type: "system", content: "" });
    return;
  }

  if (subCmd === "sync" && skillsetName) {
    if (!ctx.client) {
      ctx.addOutput({ type: "error", content: "Not connected to remote server" });
      return;
    }

    const skillset = await getSkillset(skillsetName);
    if (!skillset) {
      ctx.addOutput({ type: "error", content: `Skillset not found: ${skillsetName}` });
      return;
    }

    if (skillset.skills.length === 0) {
      ctx.addOutput({ type: "error", content: `Skillset "${skillsetName}" has no skills` });
      return;
    }

    ctx.addOutput({ type: "system", content: `Syncing ${skillset.skills.length} skills to remote...` });

    // Sync each skill to ~/.claude/skills/<name>/SKILL.md
    let synced = 0;
    for (const skill of skillset.skills) {
      try {
        // Create skill directory and write SKILL.md
        const skillDir = `~/.claude/skills/${skill.name}`;
        await ctx.client.bashExecute(`mkdir -p ${skillDir}`);
        await ctx.client.bashExecute(`cat > ${skillDir}/SKILL.md << 'SKILLEOF'\n${skill.content}\nSKILLEOF`);
        synced++;
        ctx.addOutput({ type: "system", content: `  ✓ ${skill.name}` });
      } catch (err) {
        ctx.addOutput({ type: "error", content: `  ✗ ${skill.name}: ${err}` });
      }
    }

    ctx.addOutput({ type: "system", content: "" });
    ctx.addOutput({ type: "system", content: `Synced ${synced}/${skillset.skills.length} skills to ~/.claude/skills/` });
    ctx.addOutput({ type: "system", content: "Claude will use these skills automatically based on context" });
    return;
  }

  // Show usage
  ctx.addOutput({ type: "system", content: "Usage: /skill <list|show|sync> [skillset]" });
  ctx.addOutput({ type: "system", content: "  list              - Show local skillsets" });
  ctx.addOutput({ type: "system", content: "  show <name>       - Show skills in a skillset" });
  ctx.addOutput({ type: "system", content: "  sync <name>       - Push skillset to remote ~/.claude/commands/" });
  ctx.addOutput({ type: "system", content: "" });
  ctx.addOutput({ type: "system", content: `Skillsets dir: ${getSkillsetsDir()}` });
}

async function handleVm(parts: string[], ctx: CommandHandlerContext): Promise<void> {
  // Support both `/vm:new` and `/vm new` formats
  // If first part contains ':', split on that instead
  let subCmd: string | undefined;
  let vmId: string | undefined;
  let restArgs: string[] = [];

  if (parts[0]?.includes(":")) {
    // Format: /vm:new:vmid or /vm:new
    const colonParts = parts[0].split(":");
    subCmd = colonParts[1]?.toLowerCase();
    vmId = colonParts[2];
    restArgs = parts.slice(1);
  } else {
    // Format: /vm new vmid
    subCmd = parts[1]?.toLowerCase();
    vmId = parts[2];
    restArgs = parts.slice(3);
  }

  // Helper to format relative time
  const formatRelativeTime = (dateStr: string): string => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);

    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString();
  };

  // Helper to display VM tree
  const displayVms = (vms: Array<{
    vmId: string;
    parent?: string | null;
    status: string;
    task?: string;
    approach?: string;
    createdAt: string;
  }>, currentVmId?: string) => {
    if (vms.length === 0) {
      ctx.addOutput({ type: "system", content: "No VMs found." });
      ctx.addOutput({ type: "system", content: "" });
      ctx.addOutput({ type: "system", content: "Create a VM: /vm create [task]" });
      return;
    }

    ctx.addOutput({ type: "system", content: "" });
    ctx.addOutput({ type: "system", content: `VMs (${vms.length}):` });
    ctx.addOutput({ type: "system", content: "" });

    // Build tree structure
    const roots = vms.filter(v => !v.parent);
    const children = new Map<string, typeof vms>();
    for (const vm of vms) {
      if (vm.parent) {
        const siblings = children.get(vm.parent) || [];
        siblings.push(vm);
        children.set(vm.parent, siblings);
      }
    }

    // Display tree recursively
    const displayNode = (vm: typeof vms[0], indent: string = "") => {
      const isCurrent = vm.vmId === currentVmId;
      const marker = isCurrent ? "→ " : "  ";
      const shortId = vm.vmId.slice(0, 8);
      const statusIcon = vm.status === "ready" ? "●" :
                        vm.status === "busy" ? "◐" :
                        vm.status === "completed" ? "✓" :
                        vm.status === "failed" ? "✗" : "○";
      const task = vm.task ? ` "${vm.task.slice(0, 30)}..."` : "";
      const approach = vm.approach ? ` [${vm.approach}]` : "";
      const time = formatRelativeTime(vm.createdAt);

      ctx.addOutput({
        type: "system",
        content: `${indent}${marker}${statusIcon} ${shortId}${task}${approach} - ${time}`,
      });

      // Display children
      const nodeChildren = children.get(vm.vmId) || [];
      for (const child of nodeChildren) {
        displayNode(child, indent + "  ");
      }
    };

    for (const root of roots) {
      displayNode(root);
    }

    ctx.addOutput({ type: "system", content: "" });
  };

  if (!subCmd || subCmd === "list") {
    // List VMs (standalone - no server needed)
    try {
      const result = await api.listVms();
      displayVms(result.vms);

      if (result.vms.length > 0) {
        ctx.addOutput({ type: "system", content: "Commands:" });
        ctx.addOutput({ type: "system", content: "  /vm connect <id>  - Connect to VM's agent" });
        ctx.addOutput({ type: "system", content: "  /vm branch <id>   - Fork a VM" });
        ctx.addOutput({ type: "system", content: "  /vm delete <id>   - Delete a VM" });
      }
    } catch (err) {
      ctx.addOutput({ type: "error", content: `Failed to list VMs: ${err}` });
    }
    return;
  }

  if (subCmd === "create" || subCmd === "new") {
    // Create a new VM (standalone - no server needed)
    const task = restArgs.join(" ") || undefined;
    ctx.addOutput({ type: "system", content: "Creating VM..." });

    try {
      const result = await api.createVm(task);
      ctx.addOutput({ type: "system", content: `✓ Created VM: ${result.vmId.slice(0, 8)}` });
      ctx.addOutput({ type: "system", content: `  Agent URL: ${result.agentUrl}` });
      ctx.addOutput({ type: "system", content: "" });
      ctx.addOutput({ type: "system", content: `Connect to it: /vm connect ${result.vmId.slice(0, 8)}` });
    } catch (err) {
      ctx.addOutput({ type: "error", content: `Failed to create VM: ${err}` });
    }
    return;
  }

  if (subCmd === "branch" && vmId) {
    // Branch a VM (standalone - no server needed)
    // /vm:branch:<id> 3 → create 3 branches
    // /vm:branch:<id> → create 1 branch
    const countArg = restArgs[0];
    const count = countArg && /^\d+$/.test(countArg) ? parseInt(countArg, 10) : 1;

    try {
      // Find full VM ID from partial
      const vm = await api.findVmByPartialId(vmId);
      if (!vm) {
        ctx.addOutput({ type: "error", content: `VM not found: ${vmId}` });
        return;
      }

      if (count === 1) {
        ctx.addOutput({ type: "system", content: `Branching VM ${vmId}...` });
        const result = await api.branchVmById(vm.vmId);
        ctx.addOutput({ type: "system", content: `✓ Branched VM: ${result.vmId.slice(0, 8)}` });
        ctx.addOutput({ type: "system", content: `  Parent: ${result.parentId.slice(0, 8)}` });
      } else {
        ctx.addOutput({ type: "system", content: `Creating ${count} branches from ${vmId.slice(0, 8)}...` });
        ctx.addOutput({ type: "system", content: "" });

        // Create branches in parallel
        const branchPromises = Array.from({ length: count }, () =>
          api.branchVmById(vm.vmId)
        );
        const results = await Promise.allSettled(branchPromises);

        let succeeded = 0;
        for (const result of results) {
          if (result.status === "fulfilled") {
            ctx.addOutput({ type: "system", content: `  ✓ ${result.value.vmId.slice(0, 8)}` });
            succeeded++;
          } else {
            ctx.addOutput({ type: "error", content: `  ✗ Failed: ${result.reason}` });
          }
        }

        ctx.addOutput({ type: "system", content: "" });
        ctx.addOutput({ type: "system", content: `Created ${succeeded}/${count} branches` });
        if (succeeded > 0) {
          ctx.addOutput({ type: "system", content: `Run prompts: /vm:run <prompt>` });
        }
      }
    } catch (err) {
      ctx.addOutput({ type: "error", content: `Failed to branch VM: ${err}` });
    }
    return;
  }

  if (subCmd === "delete" && vmId) {
    // Delete a VM (standalone - no server needed)
    try {
      // Find full VM ID from partial
      const vm = await api.findVmByPartialId(vmId);
      if (!vm) {
        ctx.addOutput({ type: "error", content: `VM not found: ${vmId}` });
        return;
      }

      const result = await api.deleteVm(vm.vmId);
      if (result.deleted) {
        ctx.addOutput({ type: "system", content: `✓ Deleted VM: ${vm.vmId.slice(0, 8)}` });
      } else {
        ctx.addOutput({ type: "error", content: `Failed to delete VM: ${vmId}` });
      }
    } catch (err) {
      ctx.addOutput({ type: "error", content: `Failed to delete VM: ${err}` });
    }
    return;
  }

  if (subCmd === "connect" && vmId) {
    // Connect to a VM (standalone - no server needed)
    try {
      // Find full VM ID from partial
      const vm = await api.findVmByPartialId(vmId);
      if (!vm) {
        ctx.addOutput({ type: "error", content: `VM not found: ${vmId}` });
        return;
      }

      // Get the agent URL for this VM
      const agentUrl = api.getAgentUrl(vm.vmId);
      ctx.addOutput({ type: "system", content: `✓ Connected to VM: ${vm.vmId.slice(0, 8)}` });
      ctx.addOutput({ type: "system", content: `  Agent URL: ${agentUrl}` });
      ctx.addOutput({ type: "system", content: "" });
      ctx.addOutput({ type: "system", content: "Prompts will now be sent to this VM's agent." });

      // Trigger reconnection to the VM's agent
      ctx.reconnect(agentUrl);
    } catch (err) {
      ctx.addOutput({ type: "error", content: `Failed to connect to VM: ${err}` });
    }
    return;
  }

  if (subCmd === "status") {
    // Show current VM status (based on current connection)
    ctx.addOutput({ type: "system", content: "" });
    if (ctx.currentServerUrl) {
      // Try to extract VM ID from the URL if it's a vers VM URL
      const vmMatch = ctx.currentServerUrl.match(/vers-vm-([a-f0-9-]+)/);
      if (vmMatch?.[1]) {
        ctx.addOutput({ type: "system", content: `Connected to VM: ${vmMatch[1].slice(0, 8)}` });
      } else {
        ctx.addOutput({ type: "system", content: "Connected to remote server" });
      }
      ctx.addOutput({ type: "system", content: `Agent URL: ${ctx.currentServerUrl}` });
    } else {
      ctx.addOutput({ type: "system", content: "Currently running locally (no VM)" });
    }
    ctx.addOutput({ type: "system", content: "" });
    return;
  }

  if (subCmd === "run") {
    // Run a prompt on all VMs (standalone - no server needed)
    const prompt = vmId ? `${vmId} ${restArgs.join(" ")}` : restArgs.join(" ");

    if (!prompt.trim()) {
      ctx.addOutput({ type: "error", content: "Usage: /vm:run <prompt>" });
      return;
    }

    ctx.addOutput({ type: "system", content: "Dispatching prompt to VMs..." });

    try {
      const result = await api.runOnAllVms(prompt);

      if (result.dispatched === 0) {
        ctx.addOutput({ type: "system", content: "No VMs to dispatch to." });
        ctx.addOutput({ type: "system", content: "Create VMs first: /vm:new" });
      } else {
        ctx.addOutput({ type: "system", content: "" });
        ctx.addOutput({ type: "system", content: `✓ Dispatched to ${result.dispatched} VM(s):` });
        for (const id of result.vmIds) {
          ctx.addOutput({ type: "system", content: `  • ${id.slice(0, 8)}` });
        }
        ctx.addOutput({ type: "system", content: "" });
        ctx.addOutput({ type: "system", content: "Check status: /vm:list" });
        ctx.addOutput({ type: "system", content: "Connect to VM: /vm:connect:<id>" });
      }
    } catch (err) {
      ctx.addOutput({ type: "error", content: `Failed to dispatch: ${err}` });
    }
    return;
  }

  // Show usage
  ctx.addOutput({ type: "system", content: "Usage: /vm:<command>[:<id>] [args]" });
  ctx.addOutput({ type: "system", content: "" });
  ctx.addOutput({ type: "system", content: "  /vm:list              - Show VMs with tree structure" });
  ctx.addOutput({ type: "system", content: "  /vm:new [task]        - Create a new root VM" });
  ctx.addOutput({ type: "system", content: "  /vm:branch:<id> [n]   - Fork VM (optionally n times)" });
  ctx.addOutput({ type: "system", content: "  /vm:connect:<id>      - Connect CLI to VM's agent" });
  ctx.addOutput({ type: "system", content: "  /vm:delete:<id>       - Delete a VM" });
  ctx.addOutput({ type: "system", content: "  /vm:status            - Show current VM connection" });
  ctx.addOutput({ type: "system", content: "  /vm:run <prompt>      - Fire prompt to all VMs" });
  ctx.addOutput({ type: "system", content: "" });
  ctx.addOutput({ type: "system", content: "Space-separated format also works: /vm new, /vm branch <id>, etc." });
}
