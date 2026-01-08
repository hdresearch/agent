import { runCli } from "./src/cli/cli.js";
import { createHttpServer } from "./src/server/http-server";
import { loadConfig, loadMcpServers, getConfig, setConfig } from "./src/utils/config";
import { loadDocsStore } from "./src/utils/docs-store";
import { authStore } from "./src/utils/auth-store";

// CRITICAL: Emergency exit handler - must be first!
// Track rapid SIGINT presses for force exit (works even when Ink blocks SIGINT)
let sigintCount = 0;
let lastSigintTime = 0;
const FORCE_EXIT_HANDLER = () => {
  const now = Date.now();
  if (now - lastSigintTime < 1500) {
    sigintCount++;
  } else {
    sigintCount = 1;
  }
  lastSigintTime = now;

  // Force exit after 3 rapid Ctrl+C presses
  if (sigintCount >= 3) {
    console.log("\n\nForce exit (3x Ctrl+C)");
    process.exit(0);
  }
};

// Register SIGINT handler immediately and make it hard to remove
process.on("SIGINT", FORCE_EXIT_HANDLER);

// Periodically re-register the handler in case something removes it
setInterval(() => {
  if (!process.listeners("SIGINT").includes(FORCE_EXIT_HANDLER)) {
    process.on("SIGINT", FORCE_EXIT_HANDLER);
  }
}, 1000);

// Note: We don't add a stdin data handler here because it conflicts with Ink's input handling.
// The SIGINT handler above handles Ctrl+C for force exit (3x rapid presses).

// Global error handlers to prevent crashes
process.on("uncaughtException", (err) => {
  console.error("[FATAL] Uncaught exception:", err);
  console.error(err.stack);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("[FATAL] Unhandled rejection at:", promise, "reason:", reason);
});

// Auto-detect Claude Code executable if not already set
async function findClaudeCode(): Promise<string | null> {
  // Already set
  if (process.env.CLAUDE_CODE_EXECUTABLE) {
    return process.env.CLAUDE_CODE_EXECUTABLE;
  }

  // Try to find the actual binary path (ignores shell aliases)
  const tryPaths = async (): Promise<string | null> => {
    // Use 'command -v' which ignores aliases and finds the actual binary
    try {
      const proc = Bun.spawn(["bash", "-c", "command -v claude"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const output = await new Response(proc.stdout).text();
      const path = output.trim();
      if (path && await Bun.file(path).exists()) {
        return path;
      }
    } catch {}

    // Common installation paths
    const commonPaths = [
      // User local bin (common for pipx, etc.)
      `${process.env.HOME}/.local/bin/claude`,
      // npm global (various locations)
      `${process.env.HOME}/.npm-global/bin/claude`,
      "/usr/local/bin/claude",
      "/usr/bin/claude",
      // Homebrew
      "/opt/homebrew/bin/claude",
      "/usr/local/Cellar/claude/bin/claude",
      // pnpm
      `${process.env.HOME}/.local/share/pnpm/claude`,
      // yarn global
      `${process.env.HOME}/.yarn/bin/claude`,
      // Bundled with vers-agent
      `${import.meta.dir}/dist/claude-code/cli.js`,
      `${import.meta.dir}/../claude-code/cli.js`,
    ];

    for (const p of commonPaths) {
      try {
        if (await Bun.file(p).exists()) {
          return p;
        }
      } catch {}
    }

    return null;
  };

  const found = await tryPaths();
  if (found) {
    process.env.CLAUDE_CODE_EXECUTABLE = found;
    return found;
  }

  return null;
}

const PORT = parseInt(process.env.PORT || "9999", 10);
const args = process.argv.slice(2);

const showHelp = args.includes("--help") || args.includes("-h");
const cliOnly = args.includes("--cli");
const serverOnly = args.includes("--server");
const continueSession = args.includes("--continue") || args.includes("-c");
const forceLocal = args.includes("--local");

// Parse --url option
const urlIndex = args.indexOf("--url");
const explicitServerUrl = urlIndex !== -1 && args[urlIndex + 1] ? args[urlIndex + 1] : undefined;

if (showHelp) {
  console.log(`vers-agent - ACP-compliant agent harness with CLI

Usage:
  vers-agent [options]

Options:
  --cli             Run interactive CLI only (connects to HTTP server)
  --server          Run ACP server only (HTTP, no CLI)
  --url <url>       Connect CLI to remote server (e.g., --url http://192.168.1.100:9999)
  --local           Force local mode (clears saved remote server)
  --continue, -c    Continue the last conversation
  (default)         Run both HTTP server and CLI simultaneously (or reconnect to last remote server)

Environment:
  PORT              HTTP server port (default: 9999)
  ANTHROPIC_API_KEY API key for Claude
  CLAUDE_CODE_EXECUTABLE  Path to Claude Code binary

Protocol:
  vers-agent implements the Agent Client Protocol (ACP) using JSON-RPC 2.0.
  - POST /rpc       JSON-RPC endpoint for requests
  - GET /events     SSE stream for notifications

Examples:
  vers-agent                        # Both server and CLI
  vers-agent --server               # HTTP ACP server only
  vers-agent --cli                  # Interactive terminal only
  vers-agent --cli -c               # CLI, continue last conversation
  vers-agent --url http://vm:9999   # Connect to remote ACP server
`);
  process.exit(0);
}

async function main() {
  // Load persistent config from ~/.vers/agent_config.json
  await loadConfig();
  // Load MCP server configuration
  await loadMcpServers();
  // Load persisted docs store
  await loadDocsStore();

  // Helper to check if URL is a remote server (not localhost)
  const isRemoteUrl = (url: string): boolean => {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();
      return host !== "localhost" && host !== "127.0.0.1" && host !== "::1";
    } catch {
      return false;
    }
  };

  // Determine server URL: explicit > saved > local
  const savedConfig = getConfig();
  let serverUrl: string | undefined;
  let remoteMode = false;

  if (forceLocal) {
    // Clear saved server URL when forcing local mode
    if (savedConfig.lastServerUrl) {
      await setConfig({ lastServerUrl: null });
      console.log("Cleared saved remote server. Running locally.");
    }
  } else if (explicitServerUrl) {
    // Explicit --url takes precedence
    serverUrl = explicitServerUrl;
    remoteMode = true;
    // Save for auto-reconnect (explicit --url always saves)
    await setConfig({ lastServerUrl: serverUrl });
  } else if (savedConfig.lastServerUrl && !cliOnly && !serverOnly) {
    // Use saved URL (set via /connect or --url)
    serverUrl = savedConfig.lastServerUrl;
    remoteMode = true;
    console.log(`Reconnecting to saved server: ${serverUrl}`);
  }

  if (remoteMode && serverUrl) {
    // Remote mode: connect to existing server (no local Claude Code needed)
    console.log(`Connecting to ${serverUrl}...`);
    await runCli({ continueSession, serverUrl });
  } else {
    // Local mode: need Claude Code executable
    const claudePath = await findClaudeCode();
    if (!claudePath) {
      console.error(`Error: Claude Code executable not found.

Please either:
  1. Install Claude Code: npm install -g @anthropic-ai/claude-code
  2. Set CLAUDE_CODE_EXECUTABLE environment variable
  3. Use --url to connect to a remote server

Example:
  export CLAUDE_CODE_EXECUTABLE=/path/to/claude
  vers-agent
`);
      process.exit(1);
    }
    console.log(`Using Claude Code: ${claudePath}`);

    if (cliOnly) {
      // CLI only (connects to local HTTP server)
      await runCli({ continueSession, serverUrl: `http://localhost:${PORT}` });
    } else if (serverOnly) {
      // HTTP server only (daemon mode) - reset claim for local access
      authStore.resetClaim();
      const server = createHttpServer(PORT);
      console.log("ACP server running. Press Ctrl+C to stop.");

      // Handle shutdown
      process.on("SIGINT", () => {
        server.close();
        process.exit(0);
      });
      process.on("SIGTERM", () => {
        server.close();
        process.exit(0);
      });

      // Keep process alive
      await new Promise(() => {});
    } else {
      // Both: start HTTP server, then CLI
      // Reset claim for local mode - local client should have automatic access
      authStore.resetClaim();
      const server = createHttpServer(PORT);
      const actualPort = server.port;

      // Handle shutdown
      process.on("SIGINT", () => {
        server.close();
        process.exit(0);
      });
      process.on("SIGTERM", () => {
        server.close();
        process.exit(0);
      });

      console.log(""); // blank line before CLI prompt
      await runCli({ continueSession, serverUrl: `http://localhost:${actualPort}` });
    }
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
