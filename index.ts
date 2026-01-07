import { runCli } from "./src/cli/cli.js";
import { createHttpServer } from "./src/server/http-server";
import { loadConfig, loadMcpServers } from "./src/utils/config";
import { loadDocsStore } from "./src/utils/docs-store";

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

// Parse --url option
const urlIndex = args.indexOf("--url");
const serverUrl = urlIndex !== -1 && args[urlIndex + 1] ? args[urlIndex + 1] : undefined;

// Remote mode: connect to existing server (implies CLI-only)
const remoteMode = serverUrl !== undefined;

if (showHelp) {
  console.log(`vers-agent - ACP-compliant agent harness with CLI

Usage:
  vers-agent [options]

Options:
  --cli             Run interactive CLI only (connects to HTTP server)
  --server          Run ACP server only (HTTP, no CLI)
  --url <url>       Connect CLI to remote server (e.g., --url http://192.168.1.100:9999)
  --continue, -c    Continue the last conversation
  (default)         Run both HTTP server and CLI simultaneously

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

  if (remoteMode) {
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
      // HTTP server only (daemon mode)
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
      const server = createHttpServer(PORT);

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
      await runCli({ continueSession, serverUrl: `http://localhost:${PORT}` });
    }
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
