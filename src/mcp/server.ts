/**
 * MCP Server - Exposes vers-agent CLI commands as MCP tools
 *
 * Run with: vers --mcp
 * Auto-installs into Claude's MCP settings on first run.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { HttpAcpClient } from "../client/http-client";
import { tokenStore } from "../utils/token-store";
import { homedir } from "os";
import { join } from "path";

// Server URL - defaults to localhost
const SERVER_URL = process.env.VERS_URL || `http://localhost:${process.env.PORT || "9999"}`;

// Claude MCP config paths
const CLAUDE_CONFIG_DIR = join(homedir(), ".claude");
const CLAUDE_CONFIG_FILE = join(CLAUDE_CONFIG_DIR, "claude_desktop_config.json");

interface McpServerEntry {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface ClaudeConfig {
  mcpServers?: Record<string, McpServerEntry>;
  [key: string]: unknown;
}

/**
 * Find the vers executable path
 */
function findVersExecutable(): string {
  // If we're running as a compiled binary, use that path
  const execPath = process.execPath;
  if (execPath.includes("vers")) {
    return execPath;
  }

  // Check common locations
  const homeDir = homedir();
  const candidates = [
    join(homeDir, ".local", "bin", "vers"),
    "/usr/local/bin/vers",
    "/usr/bin/vers",
  ];

  for (const candidate of candidates) {
    if (Bun.file(candidate).size > 0) {
      return candidate;
    }
  }

  // Fall back to just "vers" and hope it's in PATH
  return "vers";
}

/**
 * Check if vers is configured in Claude's MCP settings
 */
async function isVersConfigured(): Promise<boolean> {
  try {
    const file = Bun.file(CLAUDE_CONFIG_FILE);
    if (!(await file.exists())) {
      return false;
    }
    const config = (await file.json()) as ClaudeConfig;
    return !!(config.mcpServers?.vers);
  } catch {
    return false;
  }
}

/**
 * Add vers to Claude's MCP settings
 */
async function installVersToClaudeConfig(): Promise<boolean> {
  try {
    // Ensure config directory exists
    await Bun.$`mkdir -p ${CLAUDE_CONFIG_DIR}`.quiet();

    // Read existing config or create new one
    let config: ClaudeConfig = {};
    const file = Bun.file(CLAUDE_CONFIG_FILE);
    if (await file.exists()) {
      try {
        config = (await file.json()) as ClaudeConfig;
      } catch {
        // Invalid JSON, start fresh
        config = {};
      }
    }

    // Add vers MCP server
    if (!config.mcpServers) {
      config.mcpServers = {};
    }

    const versPath = findVersExecutable();
    config.mcpServers.vers = {
      command: versPath,
      args: ["--mcp"],
    };

    // Write config
    await Bun.write(CLAUDE_CONFIG_FILE, JSON.stringify(config, null, 2));

    console.error(`✓ Installed vers MCP server to ${CLAUDE_CONFIG_FILE}`);
    console.error(`  command: ${versPath}`);
    console.error(`  args: ["--mcp"]`);
    console.error("");
    console.error("Restart Claude Desktop to load the new MCP server.");

    return true;
  } catch (err) {
    console.error(`Failed to install vers to Claude config: ${err}`);
    return false;
  }
}

/**
 * Ensure vers is configured in Claude's MCP settings
 */
async function ensureVersConfigured(): Promise<void> {
  if (await isVersConfigured()) {
    console.error("vers MCP server already configured in Claude");
    return;
  }

  console.error("vers MCP server not found in Claude config, installing...");
  await installVersToClaudeConfig();
}

/**
 * Create authenticated HTTP client
 */
async function createClient(): Promise<HttpAcpClient> {
  const client = new HttpAcpClient(SERVER_URL);
  return client;
}

/**
 * Auto-claim localhost server if unclaimed
 */
async function autoClaimLocalhost(): Promise<string | null> {
  try {
    const response = await fetch(`${SERVER_URL}/claim`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Client-Id": "vers-mcp-server",
      },
      signal: AbortSignal.timeout(2000),
    });
    if (response.ok) {
      const data = (await response.json()) as {
        token?: string;
        claimed: boolean;
        isOwner?: boolean;
      };
      if (data.token) {
        tokenStore.setToken(SERVER_URL, data.token);
        return data.token;
      } else if (data.isOwner) {
        return tokenStore.getToken(SERVER_URL);
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Start the MCP server
 */
export async function startMcpServer(): Promise<void> {
  // Auto-install to Claude config if not already configured
  await ensureVersConfigured();

  // Try to claim localhost
  await autoClaimLocalhost();

  const server = new McpServer({
    name: "vers-agent",
    version: "1.0.0",
  });

  // ============================================================
  // VM Tools
  // ============================================================

  server.tool(
    "vers_vms",
    "List all VMs managed by vers-agent",
    async () => {
      const client = await createClient();
      const result = await client.rpcCall("vm/list", {});
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "vers_vm_create",
    "Create a new VM with optional task description",
    { task: z.string().optional().describe("Optional task description for the VM") },
    async ({ task }) => {
      const client = await createClient();
      const params: { task?: string } = {};
      if (task) params.task = task;
      const result = await client.rpcCall("vm/create", params);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "vers_vm_run",
    "Run a prompt on all VMs in parallel",
    { prompt: z.string().describe("The prompt to send to all VMs") },
    async ({ prompt }) => {
      const client = await createClient();
      const result = await client.rpcCall("vm/run", { prompt });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "vers_exec",
    "Execute a shell command on a specific VM",
    {
      vmId: z.string().describe("The VM ID (can be partial, will match prefix)"),
      command: z.string().describe("The shell command to execute"),
    },
    async ({ vmId, command }) => {
      const client = await createClient();
      const result = (await client.rpcCall("vm/execute", {
        vmId,
        command,
      })) as { stdout?: string; stderr?: string; exitCode?: number };

      let output = "";
      if (result.stdout) output += result.stdout;
      if (result.stderr) output += result.stderr;
      if (result.exitCode !== undefined && result.exitCode !== 0) {
        output += `\n[Exit code: ${result.exitCode}]`;
      }

      return {
        content: [{ type: "text", text: output || "(no output)" }],
      };
    }
  );

  server.tool(
    "vers_vm_sync",
    "Sync local git changes to a VM",
    {
      vmId: z.string().describe("The VM ID"),
      baseCommit: z
        .string()
        .optional()
        .describe("Base commit to sync from (defaults to VERS_GOLDEN_COMMIT_ID)"),
    },
    async ({ vmId, baseCommit }) => {
      const client = await createClient();
      const commit = baseCommit || process.env.VERS_GOLDEN_COMMIT_ID;
      if (!commit) {
        return {
          content: [
            {
              type: "text",
              text: "Error: No base commit specified and VERS_GOLDEN_COMMIT_ID not set",
            },
          ],
          isError: true,
        };
      }
      const result = await client.rpcCall("vm/sync", { vmId, baseCommit: commit });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "vers_vm_eval",
    "Evaluate a VM by running build/test/lint/typecheck",
    { vmId: z.string().describe("The VM ID to evaluate") },
    async ({ vmId }) => {
      const client = await createClient();
      const result = await client.rpcCall("vm/eval", { vmId });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "vers_vm_status",
    "Get status and recent outputs from all VMs",
    {
      limit: z
        .number()
        .optional()
        .default(1)
        .describe("Number of recent outputs per VM"),
    },
    async ({ limit }) => {
      const client = await createClient();
      const result = await client.rpcCall("vm/outputs/all", { limit });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    "vers_vm_wait",
    "Wait for a VM to complete its current task",
    {
      vmId: z.string().describe("The VM ID to wait for"),
      timeout: z
        .number()
        .optional()
        .describe("Timeout in milliseconds (default: no timeout)"),
    },
    async ({ vmId, timeout }) => {
      const client = await createClient();
      const params: { vmId: string; timeout?: number } = { vmId };
      if (timeout) params.timeout = timeout;
      const result = await client.rpcCall("vm/wait", params);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // ============================================================
  // Session/Agent Tools
  // ============================================================

  server.tool(
    "vers_run",
    "Send a prompt to the local agent and get the response",
    { prompt: z.string().describe("The prompt to send") },
    async ({ prompt }) => {
      const client = await createClient();
      await client.rpcCall("session/prompt", { text: prompt });

      // Collect response by watching events
      // For now, just return acknowledgment - streaming is complex in MCP
      return {
        content: [
          {
            type: "text",
            text: `Prompt sent: "${prompt}"\n\nUse vers_watch or check the agent output for the response.`,
          },
        ],
      };
    }
  );

  server.tool("vers_health", "Check the vers-agent server health", async () => {
    try {
      const response = await fetch(`${SERVER_URL}/health`);
      const data = await response.json();
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err}` }],
        isError: true,
      };
    }
  });

  server.tool(
    "vers_config_get",
    "Get the current vers-agent configuration",
    async () => {
      const client = await createClient();
      const result = await client.rpcCall<{ config: unknown }>("config/get", {});
      return {
        content: [{ type: "text", text: JSON.stringify(result.config, null, 2) }],
      };
    }
  );

  server.tool(
    "vers_config_set",
    "Set a vers-agent configuration value",
    {
      key: z.string().describe("Configuration key (e.g., model, autoApprovePermissions)"),
      value: z.string().describe("Configuration value"),
    },
    async ({ key, value }) => {
      const client = await createClient();
      const params: Record<string, unknown> = {};

      // Handle boolean values
      if (value === "true") params[key] = true;
      else if (value === "false") params[key] = false;
      else params[key] = value;

      const result = await client.rpcCall<{ config: unknown }>("config/set", params);
      return {
        content: [{ type: "text", text: JSON.stringify(result.config, null, 2) }],
      };
    }
  );

  server.tool(
    "vers_cancel",
    "Cancel the currently running task",
    async () => {
      const client = await createClient();
      const result = await client.rpcCall("session/cancel", {});
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // Connect via stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr so it doesn't interfere with stdio protocol
  console.error("vers-agent MCP server started");
  console.error(`Connecting to: ${SERVER_URL}`);
}
