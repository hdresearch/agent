/**
 * CLI Commands - Standalone command executor for vers-agent
 *
 * Provides subcommand-style CLI interface:
 *   vers-agent run "prompt"
 *   vers-agent watch
 *   vers-agent vms
 *   vers-agent vm create [task]
 *   etc.
 */

import { HttpAcpClient } from "../client/http-client";
import { tokenStore } from "../utils/token-store";
import * as api from "../api/standalone";

// ANSI color codes
const colors = {
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  reset: "\x1b[0m",
};

function red(s: string): string {
  return `${colors.red}${s}${colors.reset}`;
}
function green(s: string): string {
  return `${colors.green}${s}${colors.reset}`;
}
function yellow(s: string): string {
  return `${colors.yellow}${s}${colors.reset}`;
}
function blue(s: string): string {
  return `${colors.blue}${s}${colors.reset}`;
}
function cyan(s: string): string {
  return `${colors.cyan}${s}${colors.reset}`;
}

// Get VM color based on first char of vmId
function vmColor(vmId: string): (s: string) => string {
  const first = vmId[0]?.toLowerCase() || "0";
  if (first >= "0" && first <= "3") return blue;
  if (first >= "4" && first <= "7") return green;
  if (first >= "8" && first <= "b") return yellow;
  return cyan;
}

interface CommandContext {
  client: HttpAcpClient;
  args: string[];
}

// Known subcommands (for detection in index.ts)
export const SUBCOMMANDS = [
  "run",
  "prompt",
  "watch",
  "health",
  "status",
  "new",
  "sessions",
  "cancel",
  "config",
  "yolo",
  "no-yolo",
  "vms",
  "vm",
  "exec",
  "agents",
  "skills",
  "queue",
  "upgrade",
  "help",
];

/**
 * Check if the first argument is a subcommand
 */
export function isSubcommand(arg: string): boolean {
  return SUBCOMMANDS.includes(arg);
}

/**
 * Get server URL from args/env/default
 * Note: For CLI subcommands, we default to localhost unless --url is specified.
 * This differs from the interactive CLI which remembers the last connected server.
 */
async function getServerUrl(args: string[]): Promise<string> {
  // Check --url flag (explicit remote connection)
  const urlIndex = args.indexOf("--url");
  const urlArg = urlIndex !== -1 ? args[urlIndex + 1] : undefined;
  if (urlArg) {
    return urlArg;
  }

  // Check VERS_URL env var
  if (process.env.VERS_URL) {
    return process.env.VERS_URL;
  }

  // Default to localhost for CLI subcommands
  // (The interactive CLI uses config.lastServerUrl for reconnection,
  // but for one-off commands we want to hit the local server by default)
  const port = process.env.PORT || "9999";
  return `http://localhost:${port}`;
}

/**
 * Check if URL is localhost
 */
function isLocalhost(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
}

/**
 * Auto-claim localhost server if unclaimed
 */
async function autoClaimLocalhost(serverUrl: string): Promise<string | null> {
  try {
    const response = await fetch(`${serverUrl}/claim`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Client-Id": "vers-agent-cli",
      },
      signal: AbortSignal.timeout(2000),
    });
    if (response.ok) {
      const data = await response.json() as { token?: string; claimed: boolean; isOwner?: boolean };
      if (data.token) {
        // New claim - save the token
        tokenStore.setToken(serverUrl, data.token);
        return data.token;
      } else if (data.isOwner) {
        // Already claimed by us, token should be in store
        return tokenStore.getToken(serverUrl);
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Verify token is still valid for this server
 */
async function verifyToken(serverUrl: string, token: string): Promise<boolean> {
  try {
    const response = await fetch(`${serverUrl}/claim`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "X-Client-Id": "vers-agent-cli",
      },
      signal: AbortSignal.timeout(2000),
    });
    if (response.ok) {
      const data = await response.json() as { isOwner?: boolean };
      return data.isOwner === true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Create authenticated HTTP client
 */
async function createClient(serverUrl: string): Promise<HttpAcpClient> {
  // For localhost, ensure we have a valid token
  if (isLocalhost(serverUrl)) {
    const existingToken = tokenStore.getToken(serverUrl);
    if (existingToken) {
      // Verify the token is still valid (server might have been reset)
      const isValid = await verifyToken(serverUrl, existingToken);
      if (!isValid) {
        // Token is stale, clear it and try to claim fresh
        tokenStore.removeToken(serverUrl);
        await autoClaimLocalhost(serverUrl);
      }
    } else {
      // No token, try to claim
      await autoClaimLocalhost(serverUrl);
    }
  }

  const client = new HttpAcpClient(serverUrl);
  // Token is auto-loaded from tokenStore in constructor
  return client;
}

/**
 * Stream SSE events from server
 */
async function streamEvents(
  serverUrl: string,
  endpoint: string,
  onEvent: (event: unknown) => void,
  signal?: AbortSignal
): Promise<void> {
  const token = tokenStore.getToken(serverUrl);
  const headers: Record<string, string> = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(`${serverUrl}${endpoint}`, {
    headers,
    signal,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`SSE connection failed: ${response.status} ${text}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Parse SSE format: "data: {...}\n\n"
    const lines = buffer.split("\n");
    buffer = lines.pop() || ""; // Keep incomplete line in buffer

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          const json = JSON.parse(line.slice(6));
          onEvent(json);
        } catch {
          // Ignore parse errors
        }
      }
    }
  }
}

// ============================================================
// Command Implementations
// ============================================================

async function helpCommand(): Promise<number> {
  console.log(`vers-agent - ACP-compliant agent harness

${blue("Usage:")}
  vers-agent <command> [options]
  vers-agent [--server | --cli | --url <url>]

${blue("Commands:")}
  ${green("run")} <prompt>         Send prompt and stream response
  ${green("prompt")} <text>        Send prompt (returns immediately)
  ${green("watch")}                Watch SSE event stream
  ${green("health")}               Check server health
  ${green("status")}               Show health + config

  ${green("new")}                  Create new session
  ${green("sessions")}             List sessions
  ${green("cancel")}               Cancel running task

  ${green("config")}               Show current config
  ${green("config set")} <k> <v>   Set config value
  ${green("yolo")}                 Enable auto-approve permissions
  ${green("no-yolo")}              Disable auto-approve permissions

  ${green("vms")}                  List VMs
  ${green("vm create")} [task]     Create a new VM
  ${green("vm run")} <prompt>      Run prompt on all VMs
  ${green("vm watch")} [vmIds]     Watch VM event stream
  ${green("vm sync")} <id>         Sync local git to VM
  ${green("vm eval")} <id>         Evaluate VM (build/test/lint)
  ${green("exec")} <id> <cmd>      Execute command on VM (shortcut)

  ${green("agents")}               List available agents
  ${green("skills")}               List skills
  ${green("queue")}                List queued prompts

  ${green("upgrade")}              Upgrade to latest stable release
  ${green("upgrade --nightly")}    Upgrade to latest nightly build

${blue("Options:")}
  --url <url>           Connect to remote server
  --server              Run ACP server only
  --cli                 Run interactive CLI only
  --mcp                 Run as MCP server (for Claude integration)
  --new, -n             Start fresh session
  --help, -h            Show this help

${blue("Examples:")}
  vers-agent run "fix the bug in auth.ts"
  vers-agent vm create "implement feature X"
  vers-agent vm watch
  vers-agent --server
`);
  return 0;
}

// ============================================================
// Upgrade Command
// ============================================================

const GITHUB_REPO = "hdresearch/agent";
const GITHUB_API = "https://api.github.com";

interface GithubRelease {
  tag_name: string;
  name: string;
  assets: Array<{
    name: string;
    browser_download_url: string;
  }>;
}

/**
 * Get the platform-specific binary name
 */
function getBinaryName(): string {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === "darwin") {
    return arch === "arm64" ? "vers-agent-darwin-arm64" : "vers-agent-darwin-x64";
  } else if (platform === "linux") {
    return "vers-agent-linux-x64";
  } else if (platform === "win32") {
    return "vers-agent-windows-x64.exe";
  }

  throw new Error(`Unsupported platform: ${platform}-${arch}`);
}

/**
 * Get the current binary path
 */
function getCurrentBinaryPath(): string {
  // If running as compiled binary, use its path
  // Otherwise use a default location
  const execPath = process.execPath;
  if (execPath.endsWith("vers-agent") || execPath.includes("vers-agent")) {
    return execPath;
  }
  // Running from bun/node - use default location
  return "/usr/local/bin/vers-agent";
}

/**
 * Fetch the latest release info from GitHub
 */
async function fetchLatestRelease(nightly: boolean): Promise<GithubRelease> {
  const url = nightly
    ? `${GITHUB_API}/repos/${GITHUB_REPO}/releases/tags/nightly`
    : `${GITHUB_API}/repos/${GITHUB_REPO}/releases/latest`;

  const response = await fetch(url, {
    headers: {
      "Accept": "application/vnd.github.v3+json",
      "User-Agent": "vers-agent-cli",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to fetch release info: ${response.status} ${text}`);
  }

  return response.json() as Promise<GithubRelease>;
}

/**
 * Download a file to a destination path
 */
async function downloadFile(url: string, destPath: string): Promise<void> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "vers-agent-cli",
    },
  });

  if (!response.ok) {
    throw new Error(`Download failed: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  await Bun.write(destPath, arrayBuffer);
}

async function upgradeCommand(args: string[]): Promise<number> {
  const nightly = args.includes("--nightly");
  const force = args.includes("--force");

  try {
    console.log(`Checking for ${nightly ? "nightly" : "latest stable"} release...`);

    // Fetch release info
    const release = await fetchLatestRelease(nightly);
    const binaryName = getBinaryName();

    // Find the asset for this platform
    const asset = release.assets.find(a => a.name === binaryName);
    if (!asset) {
      console.error(red(`No binary found for this platform: ${binaryName}`));
      console.log(`Available assets: ${release.assets.map(a => a.name).join(", ")}`);
      return 1;
    }

    console.log(`Found release: ${green(release.tag_name)} (${release.name || ""})`);
    console.log(`Binary: ${asset.name}`);

    // Determine installation path
    const currentPath = getCurrentBinaryPath();
    const tempPath = `${currentPath}.new`;
    const backupPath = `${currentPath}.backup`;

    console.log(`Installing to: ${currentPath}`);

    // Download to temp location
    console.log(`Downloading...`);
    await downloadFile(asset.browser_download_url, tempPath);

    // Make executable
    await Bun.$`chmod +x ${tempPath}`.quiet();

    // Verify the download
    const result = await Bun.$`${tempPath} --help`.quiet().nothrow();
    if (result.exitCode !== 0) {
      await Bun.$`rm -f ${tempPath}`.quiet();
      console.error(red("Downloaded binary is invalid"));
      return 1;
    }

    // Backup current binary (if exists)
    const currentExists = await Bun.file(currentPath).exists();
    if (currentExists) {
      await Bun.$`mv ${currentPath} ${backupPath}`.quiet();
    }

    // Move new binary into place
    await Bun.$`mv ${tempPath} ${currentPath}`.quiet();

    // Clean up backup
    if (currentExists) {
      await Bun.$`rm -f ${backupPath}`.quiet();
    }

    console.log(green(`✓ Successfully upgraded to ${release.tag_name}`));
    console.log(`Run ${cyan("vers-agent --help")} to verify.`);

    return 0;
  } catch (err) {
    console.error(red(`Upgrade failed: ${err}`));
    return 1;
  }
}

async function healthCommand(ctx: CommandContext): Promise<number> {
  try {
    const response = await fetch(`${ctx.client.serverUrl}/health`);
    const data = await response.json();
    console.log(JSON.stringify(data, null, 2));
    return 0;
  } catch (err) {
    console.error(red(`Error: ${err}`));
    return 1;
  }
}

async function statusCommand(ctx: CommandContext): Promise<number> {
  try {
    // Health
    console.log(blue("Health:"));
    const healthRes = await fetch(`${ctx.client.serverUrl}/health`);
    const health = await healthRes.json();
    console.log(JSON.stringify(health, null, 2));

    // Config
    console.log(`\n${blue("Config:")}`);
    const result = await ctx.client.rpcCall<{ config: unknown }>("config/get", {});
    console.log(JSON.stringify(result.config, null, 2));
    return 0;
  } catch (err) {
    console.error(red(`Error: ${err}`));
    return 1;
  }
}

async function runCommand(ctx: CommandContext): Promise<number> {
  const text = ctx.args.slice(1).join(" ");
  if (!text) {
    console.error(red("Usage: vers-agent run <prompt>"));
    return 1;
  }

  console.log(`${blue(">")} ${text}\n`);

  // Send prompt
  try {
    await ctx.client.rpcCall("session/prompt", { text });
  } catch (err) {
    console.error(red(`Error sending prompt: ${err}`));
    return 1;
  }

  // Stream events until completed/failed
  const abortController = new AbortController();

  try {
    await streamEvents(
      ctx.client.serverUrl,
      "/events",
      (event: unknown) => {
        const data = (event as { data?: { type?: string; text?: string; toolName?: string; title?: string; error?: string } })?.data;
        if (!data) return;

        switch (data.type) {
          case "content_chunk":
            if (data.text) process.stdout.write(data.text);
            break;
          case "tool_call":
            console.log(`\n${yellow(`[Tool: ${data.toolName || data.title}]`)}`);
            break;
          case "tool_result":
            console.log(green("[Done]"));
            break;
          case "completed":
            console.log(`\n${green("[Completed]")}\n`);
            abortController.abort();
            break;
          case "failed":
            console.log(`\n${red(`[Failed: ${data.error}]`)}\n`);
            abortController.abort();
            break;
        }
      },
      abortController.signal
    );
  } catch (err) {
    // AbortError is expected when we call abort()
    if ((err as Error).name !== "AbortError") {
      console.error(red(`Stream error: ${err}`));
      return 1;
    }
  }

  return 0;
}

async function promptCommand(ctx: CommandContext): Promise<number> {
  const text = ctx.args.slice(1).join(" ");
  if (!text) {
    console.error(red("Usage: vers-agent prompt <text>"));
    return 1;
  }

  try {
    console.log(`${blue("Sending prompt:")} ${text}`);
    const result = await ctx.client.rpcCall("session/prompt", { text });
    console.log(JSON.stringify(result, null, 2));
    return 0;
  } catch (err) {
    console.error(red(`Error: ${err}`));
    return 1;
  }
}

async function watchCommand(ctx: CommandContext): Promise<number> {
  console.log(blue("Watching events (Ctrl+C to stop)..."));

  try {
    await streamEvents(ctx.client.serverUrl, "/events", (event: unknown) => {
      const data = (event as { data?: { type?: string; text?: string; toolName?: string; title?: string; error?: string } })?.data;
      if (!data) return;

      switch (data.type) {
        case "content_chunk":
          if (data.text) process.stdout.write(data.text);
          break;
        case "tool_call":
          console.log(`\n${yellow(`[Tool: ${data.toolName || data.title}]`)}`);
          break;
        case "tool_result":
          console.log(green("[Done]"));
          break;
        case "completed":
          console.log(`\n${green("[Completed]")}\n`);
          break;
        case "failed":
          console.log(`\n${red(`[Failed: ${data.error}]`)}\n`);
          break;
      }
    });
  } catch (err) {
    if ((err as Error).name !== "AbortError") {
      console.error(red(`Stream error: ${err}`));
      return 1;
    }
  }

  return 0;
}

async function newSessionCommand(ctx: CommandContext): Promise<number> {
  try {
    console.log(blue("Creating new session..."));
    const result = await ctx.client.rpcCall("session/new", {});
    console.log(JSON.stringify(result, null, 2));
    return 0;
  } catch (err) {
    console.error(red(`Error: ${err}`));
    return 1;
  }
}

async function sessionsCommand(ctx: CommandContext): Promise<number> {
  try {
    const result = await ctx.client.rpcCall("session/list", {});
    console.log(JSON.stringify(result, null, 2));
    return 0;
  } catch (err) {
    console.error(red(`Error: ${err}`));
    return 1;
  }
}

async function cancelCommand(ctx: CommandContext): Promise<number> {
  try {
    console.log(yellow("Cancelling..."));
    const result = await ctx.client.rpcCall("session/cancel", {});
    console.log(JSON.stringify(result, null, 2));
    return 0;
  } catch (err) {
    console.error(red(`Error: ${err}`));
    return 1;
  }
}

async function configCommand(ctx: CommandContext): Promise<number> {
  try {
    // Check for "config set key value"
    if (ctx.args[1] === "set" && ctx.args[2]) {
      const key = ctx.args[2];
      const value = ctx.args.slice(3).join(" ");
      const params: Record<string, unknown> = {};

      // Handle boolean values
      if (value === "true") params[key] = true;
      else if (value === "false") params[key] = false;
      else params[key] = value;

      console.log(blue(`Setting ${key}=${value}...`));
      const result = await ctx.client.rpcCall<{ config: unknown }>("config/set", params);
      console.log(JSON.stringify(result.config, null, 2));
      return 0;
    }

    // Just show config
    const result = await ctx.client.rpcCall<{ config: unknown }>("config/get", {});
    console.log(JSON.stringify(result.config, null, 2));
    return 0;
  } catch (err) {
    console.error(red(`Error: ${err}`));
    return 1;
  }
}

async function yoloCommand(ctx: CommandContext): Promise<number> {
  try {
    console.log(green("Enabling auto-approve..."));
    const result = await ctx.client.rpcCall<{ config: unknown }>("config/set", { autoApprovePermissions: true });
    console.log(JSON.stringify(result.config, null, 2));
    return 0;
  } catch (err) {
    console.error(red(`Error: ${err}`));
    return 1;
  }
}

async function noYoloCommand(ctx: CommandContext): Promise<number> {
  try {
    console.log(yellow("Disabling auto-approve..."));
    const result = await ctx.client.rpcCall<{ config: unknown }>("config/set", { autoApprovePermissions: false });
    console.log(JSON.stringify(result.config, null, 2));
    return 0;
  } catch (err) {
    console.error(red(`Error: ${err}`));
    return 1;
  }
}

// ============================================================
// VM Commands
// ============================================================

async function vmsCommand(ctx: CommandContext): Promise<number> {
  try {
    const result = await ctx.client.rpcCall("vm/list", {});
    console.log(JSON.stringify(result, null, 2));
    return 0;
  } catch (err) {
    console.error(red(`Error: ${err}`));
    return 1;
  }
}

async function vmCommand(ctx: CommandContext): Promise<number> {
  const subCmd = ctx.args[1];

  switch (subCmd) {
    case "create": {
      const task = ctx.args.slice(2).join(" ") || undefined;
      try {
        const params: { task?: string } = {};
        if (task) params.task = task;
        const result = await ctx.client.rpcCall("vm/create", params);
        console.log(JSON.stringify(result, null, 2));
        return 0;
      } catch (err) {
        console.error(red(`Error: ${err}`));
        return 1;
      }
    }

    case "run": {
      const prompt = ctx.args.slice(2).join(" ");
      if (!prompt) {
        console.error(red("Usage: vers-agent vm run <prompt>"));
        return 1;
      }
      try {
        console.log(`${blue("Running on all VMs:")} ${prompt}`);
        const result = await ctx.client.rpcCall("vm/run", { prompt });
        console.log(JSON.stringify(result, null, 2));
        return 0;
      } catch (err) {
        console.error(red(`Error: ${err}`));
        return 1;
      }
    }

    case "watch": {
      const vmIds = ctx.args[2] || undefined;
      const endpoint = vmIds ? `/events/vms?vmIds=${vmIds}` : "/events/vms";

      if (vmIds) {
        console.log(blue(`Watching VM events for: ${vmIds} (Ctrl+C to stop)...`));
      } else {
        console.log(blue("Watching all VM events (Ctrl+C to stop)..."));
      }

      let currentVm = "";

      try {
        await streamEvents(ctx.client.serverUrl, endpoint, (event: unknown) => {
          const vmId = (event as { vmId?: string })?.vmId || "";
          const eventData = (event as { event?: { data?: { type?: string; text?: string; toolName?: string; title?: string; error?: string } } })?.event?.data;
          if (!eventData) return;

          const shortVm = vmId.slice(0, 8);
          const colorFn = vmColor(vmId);

          switch (eventData.type) {
            case "content_chunk":
              if (eventData.text) {
                // Print VM prefix if switching VMs
                if (currentVm !== vmId) {
                  if (currentVm) console.log("");
                  process.stdout.write(`${colorFn(`[${shortVm}]`)} `);
                  currentVm = vmId;
                }
                process.stdout.write(eventData.text);
              }
              break;
            case "tool_call":
              console.log(`\n${colorFn(`[${shortVm}]`)} ${yellow(`⚙ ${eventData.toolName || eventData.title}`)}`);
              currentVm = "";
              break;
            case "tool_result":
              console.log(`${colorFn(`[${shortVm}]`)} ${green("✓")}`);
              break;
            case "completed":
              console.log(`\n${colorFn(`[${shortVm}]`)} ${green("✓ Done")}`);
              currentVm = "";
              break;
            case "failed":
              console.log(`\n${colorFn(`[${shortVm}]`)} ${red(`✗ Failed: ${eventData.error}`)}`);
              currentVm = "";
              break;
          }
        });
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          console.error(red(`Stream error: ${err}`));
          return 1;
        }
      }
      return 0;
    }

    case "exec": {
      const vmId = ctx.args[2];
      const cmd = ctx.args.slice(3).join(" ");
      if (!vmId || !cmd) {
        console.error(red("Usage: vers-agent vm exec <vmId> <command>"));
        return 1;
      }
      try {
        const result = await ctx.client.rpcCall("vm/execute", { vmId, command: cmd });
        console.log(JSON.stringify(result, null, 2));
        return 0;
      } catch (err) {
        console.error(red(`Error: ${err}`));
        return 1;
      }
    }

    case "sync": {
      const vmId = ctx.args[2];
      const baseCommit = ctx.args[3] || process.env.VERS_GOLDEN_COMMIT_ID;
      if (!vmId) {
        console.error(red("Usage: vers-agent vm sync <vmId> [baseCommit]"));
        return 1;
      }
      if (!baseCommit) {
        console.error(red("Error: No base commit specified and VERS_GOLDEN_COMMIT_ID not set"));
        return 1;
      }
      try {
        const result = await ctx.client.rpcCall("vm/sync", { vmId, baseCommit });
        console.log(JSON.stringify(result, null, 2));
        return 0;
      } catch (err) {
        console.error(red(`Error: ${err}`));
        return 1;
      }
    }

    case "eval": {
      const vmId = ctx.args[2];
      if (!vmId) {
        console.error(red("Usage: vers-agent vm eval <vmId>"));
        return 1;
      }
      try {
        console.log(blue(`Evaluating VM ${vmId}...`));
        const result = await ctx.client.rpcCall("vm/eval", { vmId });
        console.log(JSON.stringify(result, null, 2));
        return 0;
      } catch (err) {
        console.error(red(`Error: ${err}`));
        return 1;
      }
    }

    case "outputs": {
      const vmId = ctx.args[2];
      const limit = ctx.args[3] ? parseInt(ctx.args[3], 10) : undefined;
      if (!vmId) {
        console.error(red("Usage: vers-agent vm outputs <vmId> [limit]"));
        return 1;
      }
      try {
        const params: { vmId: string; limit?: number } = { vmId };
        if (limit) params.limit = limit;
        const result = await ctx.client.rpcCall("vm/outputs", params);
        console.log(JSON.stringify(result, null, 2));
        return 0;
      } catch (err) {
        console.error(red(`Error: ${err}`));
        return 1;
      }
    }

    case "status": {
      const limit = ctx.args[2] ? parseInt(ctx.args[2], 10) : 1;
      try {
        const result = await ctx.client.rpcCall("vm/outputs/all", { limit });
        console.log(JSON.stringify(result, null, 2));
        return 0;
      } catch (err) {
        console.error(red(`Error: ${err}`));
        return 1;
      }
    }

    case "wait": {
      const vmId = ctx.args[2];
      const timeout = ctx.args[3] ? parseInt(ctx.args[3], 10) : undefined;
      if (!vmId) {
        console.error(red("Usage: vers-agent vm wait <vmId> [timeout_ms]"));
        return 1;
      }
      try {
        console.log(blue(`Waiting for VM ${vmId} to complete...`));
        const params: { vmId: string; timeout?: number } = { vmId };
        if (timeout) params.timeout = timeout;
        const result = await ctx.client.rpcCall("vm/wait", params);
        console.log(JSON.stringify(result, null, 2));
        return 0;
      } catch (err) {
        console.error(red(`Error: ${err}`));
        return 1;
      }
    }

    case "delete": {
      const vmId = ctx.args[2];
      if (!vmId) {
        console.error(red("Usage: vers-agent vm delete <vmId>"));
        return 1;
      }
      try {
        // Use standalone API - no server needed
        await api.loadConfig();
        const result = await api.deleteVm(vmId);
        console.log(JSON.stringify(result, null, 2));
        return 0;
      } catch (err) {
        console.error(red(`Error: ${err}`));
        return 1;
      }
    }

    default:
      console.error(red(`Unknown vm subcommand: ${subCmd}`));
      console.log(`\n${blue("Available vm commands:")}`);
      console.log("  vm create [task]     Create a new VM");
      console.log("  vm delete <id>       Delete a VM");
      console.log("  vm run <prompt>      Run prompt on all VMs");
      console.log("  vm watch [vmIds]     Watch VM event stream");
      console.log("  vm exec <id> <cmd>   Execute command on VM");
      console.log("  vm sync <id> [base]  Sync local git to VM");
      console.log("  vm eval <id>         Evaluate VM");
      console.log("  vm outputs <id>      Get VM outputs");
      console.log("  vm status [limit]    Get all VM status");
      console.log("  vm wait <id> [ms]    Wait for VM completion");
      return 1;
  }
}

async function agentsCommand(ctx: CommandContext): Promise<number> {
  try {
    const result = await ctx.client.rpcCall("agent/list", {});
    console.log(JSON.stringify(result, null, 2));
    return 0;
  } catch (err) {
    console.error(red(`Error: ${err}`));
    return 1;
  }
}

async function skillsCommand(ctx: CommandContext): Promise<number> {
  try {
    const result = await ctx.client.rpcCall("skill/list", {});
    console.log(JSON.stringify(result, null, 2));
    return 0;
  } catch (err) {
    console.error(red(`Error: ${err}`));
    return 1;
  }
}

async function queueCommand(ctx: CommandContext): Promise<number> {
  try {
    const result = await ctx.client.rpcCall("queue/list", {});
    console.log(JSON.stringify(result, null, 2));
    return 0;
  } catch (err) {
    console.error(red(`Error: ${err}`));
    return 1;
  }
}

async function execCommand(ctx: CommandContext): Promise<number> {
  const vmId = ctx.args[1];
  const cmd = ctx.args.slice(2).join(" ");
  if (!vmId || !cmd) {
    console.error(red("Usage: vers exec <vmId> <command>"));
    return 1;
  }
  try {
    const result = await ctx.client.rpcCall("vm/execute", { vmId, command: cmd });
    // If result has stdout/stderr, print them directly
    const res = result as { stdout?: string; stderr?: string; exitCode?: number };
    if (res.stdout) {
      process.stdout.write(res.stdout);
    }
    if (res.stderr) {
      process.stderr.write(res.stderr);
    }
    return res.exitCode ?? 0;
  } catch (err) {
    console.error(red(`Error: ${err}`));
    return 1;
  }
}

// ============================================================
// Main Command Router
// ============================================================

/**
 * Execute a CLI command and return exit code
 */
export async function executeCommand(args: string[]): Promise<number> {
  const cmd = args[0];

  // Help doesn't need a client
  if (cmd === "help" || cmd === "--help" || cmd === "-h") {
    return helpCommand();
  }

  // Upgrade doesn't need a client
  if (cmd === "upgrade") {
    return upgradeCommand(args);
  }

  // Get server URL and create client
  const serverUrl = await getServerUrl(args);
  const client = await createClient(serverUrl);

  const ctx: CommandContext = { client, args };

  switch (cmd) {
    case "health":
      return healthCommand(ctx);
    case "status":
      return statusCommand(ctx);
    case "run":
      return runCommand(ctx);
    case "prompt":
      return promptCommand(ctx);
    case "watch":
      return watchCommand(ctx);
    case "new":
      return newSessionCommand(ctx);
    case "sessions":
      return sessionsCommand(ctx);
    case "cancel":
      return cancelCommand(ctx);
    case "config":
      return configCommand(ctx);
    case "yolo":
      return yoloCommand(ctx);
    case "no-yolo":
      return noYoloCommand(ctx);
    case "vms":
      return vmsCommand(ctx);
    case "vm":
      return vmCommand(ctx);
    case "exec":
      return execCommand(ctx);
    case "agents":
      return agentsCommand(ctx);
    case "skills":
      return skillsCommand(ctx);
    case "queue":
      return queueCommand(ctx);
    default:
      console.error(red(`Unknown command: ${cmd}`));
      console.log(`Run ${green("vers-agent help")} for usage.`);
      return 1;
  }
}
