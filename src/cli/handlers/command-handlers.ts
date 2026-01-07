// Slash command handlers

import type { HttpAcpClient } from "../../client/http-client";
import type { SessionConfig } from "../../protocol/acp-types";
import type { OutputLine, StatusInfo } from "../types";
import { COMMANDS } from "../constants";
import { setConfig, getMcpServers, addMcpServer, removeMcpServer, type McpServerConfig } from "../../utils/config";
import { detectKeys, formatKeysDisplay } from "../../utils/keys";
import { createHistory, saveHistory, type ConversationHistory } from "../../utils/history";

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

    case "thinking":
    case "t":
      handleThinking(parts, ctx);
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

    case "token":
      handleToken(ctx);
      return { handled: true };

    default:
      ctx.addOutput({ type: "error", content: `Unknown command: /${cmd}. Type /help for commands.` });
      return { handled: true };
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
  ctx.setContinueMode(false);
  // Reset history
  ctx.historyRef.current = createHistory("new");
  saveHistory(ctx.historyRef.current);
  ctx.setOutput([]);
  ctx.client?.newSession(ctx.sessionConfig)
    .then((result) => {
      ctx.setStatusInfo(prev => ({ ...prev, sessionId: result.sessionId }));
    })
    .catch(() => {});
  ctx.addOutput({ type: "system", content: "🆕 Starting new conversation" });
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

      const session = matches[0];

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

function handleThinking(parts: string[], ctx: CommandHandlerContext): void {
  const arg = parts[1];
  if (arg === "off") {
    ctx.setSessionConfig({ thinkingBudget: null });
    ctx.setStatusInfo(prev => ({ ...prev, thinking: { enabled: false, budget: null } }));
    setConfig({ thinkingBudget: null }); // Persist to config file
    ctx.addOutput({ type: "system", content: "🧠 Thinking mode: OFF" });
  } else if (arg === "on" || !arg) {
    const budget = parts[2] ? parseInt(parts[2], 10) : 10000;
    if (isNaN(budget) || budget < 1024) {
      ctx.addOutput({ type: "error", content: "Thinking budget must be at least 1024 tokens" });
    } else {
      ctx.setSessionConfig({ thinkingBudget: budget });
      ctx.setStatusInfo(prev => ({ ...prev, thinking: { enabled: true, budget } }));
      setConfig({ thinkingBudget: budget }); // Persist to config file
      ctx.addOutput({ type: "system", content: `🧠 Thinking mode: ON (budget: ${budget.toLocaleString()} tokens)` });
    }
  } else {
    const budget = parseInt(arg, 10);
    if (!isNaN(budget) && budget >= 1024) {
      ctx.setSessionConfig({ thinkingBudget: budget });
      ctx.setStatusInfo(prev => ({ ...prev, thinking: { enabled: true, budget } }));
      setConfig({ thinkingBudget: budget }); // Persist to config file
      ctx.addOutput({ type: "system", content: `🧠 Thinking mode: ON (budget: ${budget.toLocaleString()} tokens)` });
    } else {
      ctx.addOutput({ type: "system", content: `🧠 Thinking mode: ${ctx.sessionConfig.thinkingBudget ? `ON (${ctx.sessionConfig.thinkingBudget.toLocaleString()} tokens)` : "OFF"}` });
      ctx.addOutput({ type: "system", content: "Usage: /thinking <on|off> [budget]" });
    }
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
