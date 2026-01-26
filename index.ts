import { runCli } from "./src/cli/cli.js";

// Version injected at build time via --define BUILD_VERSION='...'
// Falls back to "dev" when running via bun (not compiled)
declare const BUILD_VERSION: string;
const VERSION = typeof BUILD_VERSION !== "undefined" ? BUILD_VERSION : "dev";
const RELEASES_BASE_URL = "https://releases.vers.sh";
import { createHttpServer } from "./src/server/http-server";
import { loadConfig, loadMcpServers, getConfig, setConfig } from "./src/utils/config";
import { loadDocsStore } from "./src/utils/docs-store";
import { authStore } from "./src/utils/auth-store";
import { initializeAgent } from "./src/core/agent-manager";
import { executeCommand, isSubcommand } from "./src/cli/commands";
import { startMcpServer, ensureVersConfigured } from "./src/mcp/server";

// Import embedded skills to ensure they're bundled
import { embeddedSkills } from "./src/skills/embedded";
export { embeddedSkills };

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

// Check for subcommand mode (first arg is a known command, not a flag)
// Subcommands run immediately and exit, bypassing the rest of the startup logic
const firstArg = args[0];
if (firstArg && !firstArg.startsWith("-") && isSubcommand(firstArg)) {
  executeCommand(args)
    .then((exitCode) => process.exit(exitCode))
    .catch((err) => {
      console.error("Error:", err);
      process.exit(1);
    });
} else {
  // Flag-based mode - run the full initialization
  runFlagMode();
}


// Check if running as standalone binary (not via bun run)
function isStandalone(): boolean {
  // process.execPath is the actual binary path
  // When compiled: /path/to/vers-agent (our binary)
  // When via bun: /path/to/bun (the bun executable)
  const execPath = process.execPath;
  return !execPath.endsWith("/bun") && !execPath.includes("/bun/") && !execPath.endsWith("/node");
}

// Detect platform for download
function detectPlatform(): string {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === "win32") {
    return "vers-agent-windows-x64.exe";
  } else if (platform === "linux") {
    return arch === "arm64" ? "vers-agent-linux-arm64" : "vers-agent-linux-x64";
  } else if (platform === "darwin") {
    return arch === "arm64" ? "vers-agent-darwin-arm64" : "vers-agent-darwin-x64";
  }
  throw new Error(`Unsupported platform: ${platform}-${arch}`);
}

// Self-update the binary
async function selfUpdate(channel: string = "nightly"): Promise<void> {
  if (!isStandalone()) {
    console.error("--update only works with standalone binary, not when running via bun");
    process.exit(1);
  }

  const asset = detectPlatform();
  const url = `${RELEASES_BASE_URL}/${channel}/${asset}`;
  const execPath = process.execPath;

  console.log(`Updating vers to ${channel}...`);
  console.log(`  ${url}`);

  try {
    const response = await fetch(url);
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Channel "${channel}" not found. Try "nightly" or a version tag like "v0.2.0"`);
      }
      throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    }

    const tmpPath = `${execPath}.new`;
    const data = await response.arrayBuffer();
    await Bun.write(tmpPath, data);

    // Make executable
    await Bun.$`chmod +x ${tmpPath}`.quiet();

    // On macOS, ad-hoc sign to satisfy Gatekeeper
    if (process.platform === "darwin") {
      await Bun.$`codesign --force --sign - ${tmpPath}`.quiet().nothrow();
      await Bun.$`xattr -d com.apple.quarantine ${tmpPath}`.quiet().nothrow();
    }

    // Replace old binary
    const backupPath = `${execPath}.old`;
    await Bun.$`mv ${execPath} ${backupPath}`.quiet();
    await Bun.$`mv ${tmpPath} ${execPath}`.quiet();
    await Bun.$`rm -f ${backupPath}`.quiet();

    console.log("✓ Updated successfully!");
    console.log(`  Run 'vers --version' to verify.`);
  } catch (err) {
    console.error("Update failed:", err);
    process.exit(1);
  }
}

function runFlagMode() {
  const showHelp = args.includes("--help") || args.includes("-h");
  const showVersion = args.includes("--version") || args.includes("-v");

  // Parse --update [channel] option
  const updateIndex = args.indexOf("--update");
  const doUpdate = updateIndex !== -1;
  const updateArg = args[updateIndex + 1];
  const updateChannel = doUpdate && updateArg && !updateArg.startsWith("-")
    ? updateArg
    : "nightly";

  const installSkills = args.includes("--install-skills");
  const mcpMode = args.includes("--mcp");
  const mcpInstall = args.includes("--mcp-install");
  const cliMode = args.includes("--cli");
  const serverMode = args.includes("--server");
  // --cli = server + interactive CLI (the full experience)
  // --server = server only (daemon mode, no CLI)
  // default (no flags) = server + interactive CLI
  const serverOnly = serverMode && !cliMode;
  const forceNewSession = args.includes("--new") || args.includes("-n");
  const continueSession = !forceNewSession; // Continue is now the default
  const forceLocal = args.includes("--local");

  // Parse --url option
  const urlIndex = args.indexOf("--url");
  const explicitServerUrl = urlIndex !== -1 && args[urlIndex + 1] ? args[urlIndex + 1] : undefined;

  // --version: print version and exit
  if (showVersion) {
    console.log(`vers ${VERSION}`);
    process.exit(0);
  }

  // --update [channel]: self-update the binary (standalone only)
  if (doUpdate) {
    selfUpdate(updateChannel)
      .then(() => process.exit(0))
      .catch((err) => {
        console.error("Update failed:", err);
        process.exit(1);
      });
    return;
  }

  // Install embedded skills to ~/.claude/skills/
  if (installSkills) {
    (async () => {
      const homeDir = process.env.HOME || process.env.USERPROFILE || "";
      const skillsDir = `${homeDir}/.claude/skills`;

      console.log("Installing embedded skills to ~/.claude/skills/\n");

      for (const skill of embeddedSkills) {
        const skillPath = `${skillsDir}/${skill.name}`;
        const filePath = `${skillPath}/SKILL.md`;

        try {
          // Create directory
          await Bun.$`mkdir -p ${skillPath}`.quiet();

          // Write skill file
          await Bun.write(filePath, skill.content);

          console.log(`  ✓ Installed: ${skill.name}`);
          console.log(`    ${filePath}\n`);
        } catch (err) {
          console.error(`  ✗ Failed to install ${skill.name}:`, err);
        }
      }

      console.log("Done! Skills are now available in Claude Code.");
      console.log("Try: /orchestrate");
      process.exit(0);
    })();
    return;
  }

  // Install MCP config only (no server)
  if (mcpInstall) {
    ensureVersConfigured()
      .then(() => process.exit(0))
      .catch((err) => {
        console.error("MCP install error:", err);
        process.exit(1);
      });
    return;
  }

  // MCP server mode - expose CLI commands as MCP tools
  if (mcpMode) {
    startMcpServer().catch((err) => {
      console.error("MCP server error:", err);
      process.exit(1);
    });
    return;
  }

  if (showHelp) {
    console.log(`vers-agent - ACP-compliant agent harness with CLI

Usage:
  vers-agent [options]
  vers-agent <command> [args]

Commands:
  run <prompt>      Send prompt and stream response
  watch             Watch SSE event stream
  health            Check server health
  vms               List VMs
  vm <subcommand>   VM operations (create, run, watch, sync, eval)
  exec <id> <cmd>   Execute command on VM
  config            Show/set configuration
  help              Show detailed command help

Options:
  --version, -v     Show version
  --update [channel] Self-update (default: nightly, or specify version like v0.2.0)
  --server          Run HTTP server only (daemon mode, no interactive CLI)
  --cli             Run interactive CLI with server (same as default)
  --mcp             Run as MCP server (stdio transport for Claude integration)
  --url <url>       Connect CLI to remote server (e.g., --url http://192.168.1.100:9999)
  --local           Force local mode (clears saved remote server)
  --new, -n         Start a fresh session (default: continue last session)
  --install-skills  Install bundled skills to ~/.claude/skills/
  (default)         Run HTTP server with interactive CLI

Environment:
  PORT              HTTP server port (default: 9999)
  ANTHROPIC_API_KEY API key for Claude
  CLAUDE_CODE_EXECUTABLE  Path to Claude Code binary

Protocol:
  vers-agent implements the Agent Client Protocol (ACP) using JSON-RPC 2.0.
  - POST /rpc       JSON-RPC endpoint for requests
  - GET /events     SSE stream for notifications

Examples:
  vers-agent                        # Start server + interactive CLI (default)
  vers-agent --server               # Start HTTP server only (daemon mode)
  vers-agent run "fix the bug"      # Send prompt and stream response
  vers-agent vms                    # List VMs
  vers-agent vm create "task"       # Create a new VM
  vers-agent exec <vmId> "ls -la"   # Execute command on VM
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
    } else if (savedConfig.lastServerUrl && !serverOnly) {
      // Use saved URL (set via /connect or --url)
      // Works for both --cli mode and default mode
      serverUrl = savedConfig.lastServerUrl;
      remoteMode = true;
      console.log(`Reconnecting to saved server: ${serverUrl}`);
    }

    if (remoteMode && serverUrl) {
      // Remote mode: connect to existing server (no local Claude Code needed)
      console.log(`Connecting to ${serverUrl}...`);
      await runCli({ continueSession, serverUrl });
    } else {
      // Local mode: check for Claude Code executable (unless server-only mode which defers to auto-install)
      if (!serverOnly) {
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
      }

      if (serverOnly) {
        // HTTP server only (daemon mode)
        const server = createHttpServer(PORT);

        // Initialize agent eagerly so commands are available immediately
        await initializeAgent();

        console.log(`\n  vers-agent server running on http://localhost:${server.port}`);
        console.log(`  → Shell UI: http://localhost:${server.port}/shell\n`);
        console.log("  Press Ctrl+C to stop.\n");

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
        const actualPort = server.port;

        // Initialize agent eagerly so commands are available immediately
        await initializeAgent();

        // Handle shutdown
        process.on("SIGINT", () => {
          server.close();
          process.exit(0);
        });
        process.on("SIGTERM", () => {
          server.close();
          process.exit(0);
        });

        console.log(`  Server: http://localhost:${actualPort}`);
        console.log(""); // blank line before CLI prompt
        await runCli({ continueSession, serverUrl: `http://localhost:${actualPort}` });
      }
    }
  }

  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
