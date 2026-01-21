/**
 * MCP Server - Exposes vers-agent CLI commands as MCP tools
 *
 * Run with: vers --mcp
 * Auto-installs into Claude's MCP settings on first run.
 *
 * This is a STANDALONE server - it calls orchestrator/vm/config modules directly
 * without requiring an HTTP server to be running.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { homedir } from "os";
import { join } from "path";

// Standalone API - shared with CLI
import * as api from "../api/standalone";

// Claude config paths
const CLAUDE_CONFIG_DIR = join(homedir(), ".claude");
// Claude Desktop uses claude_desktop_config.json
const CLAUDE_DESKTOP_CONFIG = join(CLAUDE_CONFIG_DIR, "claude_desktop_config.json");
// Claude Code uses ~/.claude.json for user-scoped MCP servers
const CLAUDE_CODE_CONFIG = join(homedir(), ".claude.json");

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
 * Check if vers is configured in a config file
 */
async function isVersConfiguredIn(configPath: string): Promise<boolean> {
  try {
    const file = Bun.file(configPath);
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
 * Add vers to a Claude config file
 */
async function installVersToConfig(configPath: string, configName: string): Promise<boolean> {
  try {
    // Ensure parent directory exists
    const dir = configPath.substring(0, configPath.lastIndexOf("/"));
    if (dir) {
      await Bun.$`mkdir -p ${dir}`.quiet();
    }

    // Read existing config or create new one
    let config: ClaudeConfig = {};
    const file = Bun.file(configPath);
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
    await Bun.write(configPath, JSON.stringify(config, null, 2));

    console.error(`✓ Installed vers MCP server to ${configPath} (${configName})`);
    return true;
  } catch (err) {
    console.error(`Failed to install vers to ${configName}: ${err}`);
    return false;
  }
}

/**
 * Ensure vers is configured in both Claude Desktop and Claude Code
 */
export async function ensureVersConfigured(): Promise<void> {
  const versPath = findVersExecutable();
  let installedAny = false;

  // Check and install for Claude Desktop
  if (await isVersConfiguredIn(CLAUDE_DESKTOP_CONFIG)) {
    console.error("✓ vers already configured in Claude Desktop");
  } else {
    console.error("Installing vers MCP server for Claude Desktop...");
    if (await installVersToConfig(CLAUDE_DESKTOP_CONFIG, "Claude Desktop")) {
      installedAny = true;
    }
  }

  // Check and install for Claude Code
  if (await isVersConfiguredIn(CLAUDE_CODE_CONFIG)) {
    console.error("✓ vers already configured in Claude Code");
  } else {
    console.error("Installing vers MCP server for Claude Code...");
    if (await installVersToConfig(CLAUDE_CODE_CONFIG, "Claude Code")) {
      installedAny = true;
    }
  }

  if (installedAny) {
    console.error("");
    console.error(`Using executable: ${versPath}`);
    console.error("Restart Claude Desktop/Code to load the new MCP server.");
  }
  console.error("");
}


/**
 * Start the MCP server
 */
export async function startMcpServer(): Promise<void> {
  // Auto-install to Claude config if not already configured
  await ensureVersConfigured();

  // Load config for standalone operation
  await api.loadConfig();

  const server = new McpServer({
    name: "vers-agent",
    version: "1.0.0",
  });

  // Helper to wrap API calls with MCP response format
  const jsonResponse = (data: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  });

  const errorResponse = (msg: string) => ({
    content: [{ type: "text" as const, text: msg }],
    isError: true,
  });

  // ============================================================
  // VM Tools
  // ============================================================

  server.tool("vers_vms", "List all VMs managed by vers-agent", async () => {
    try {
      return jsonResponse(await api.listVms());
    } catch (err) {
      return errorResponse(`Error listing VMs: ${err}`);
    }
  });

  server.tool(
    "vers_vm_create",
    "Create a new VM with optional task description",
    { task: z.string().optional().describe("Optional task description for the VM") },
    async ({ task }) => {
      try {
        // Auto-forward ANTHROPIC_API_KEY and ANTHROPIC_BASE_URL to VMs if set
        const env: Record<string, string> = {};
        if (process.env.ANTHROPIC_API_KEY) {
          env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
        }
        if (process.env.ANTHROPIC_BASE_URL) {
          env.ANTHROPIC_BASE_URL = process.env.ANTHROPIC_BASE_URL;
        }
        return jsonResponse(await api.createVm(task, Object.keys(env).length > 0 ? env : undefined));
      } catch (err) {
        return errorResponse(`Error creating VM: ${err}`);
      }
    }
  );

  server.tool(
    "vers_vm_delete",
    "Delete a VM",
    { vmId: z.string().describe("The VM ID to delete") },
    async ({ vmId }) => {
      try {
        return jsonResponse(await api.deleteVm(vmId));
      } catch (err) {
        return errorResponse(`Error deleting VM: ${err}`);
      }
    }
  );

  server.tool(
    "vers_vm_run",
    "Run a prompt on a specific VM",
    {
      vmId: z.string().describe("The VM ID to send the prompt to"),
      prompt: z.string().describe("The prompt to send to the VM"),
    },
    async ({ vmId, prompt }) => {
      try {
        return jsonResponse(await api.runOnVm(vmId, prompt));
      } catch (err) {
        return errorResponse(`Error running prompt: ${err}`);
      }
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
      try {
        const result = await api.executeOnVm(vmId, command);
        let output = "";
        if (result.stdout) output += result.stdout;
        if (result.stderr) output += result.stderr;
        if (result.exitCode !== 0) {
          output += `\n[Exit code: ${result.exitCode}]`;
        }
        return { content: [{ type: "text" as const, text: output || "(no output)" }] };
      } catch (err) {
        return errorResponse(`Error executing command: ${err}`);
      }
    }
  );

  server.tool(
    "vers_vm_eval",
    "Evaluate a VM by running build/test/lint/typecheck",
    { vmId: z.string().describe("The VM ID to evaluate") },
    async ({ vmId }) => {
      try {
        return jsonResponse(await api.evalVm(vmId));
      } catch (err) {
        return errorResponse(`Error evaluating VM: ${err}`);
      }
    }
  );

  server.tool(
    "vers_vm_status",
    "Get status and recent outputs from all VMs",
    { limit: z.number().optional().default(1).describe("Number of recent outputs per VM") },
    async ({ limit }) => {
      try {
        return jsonResponse(await api.getVmStatus(limit));
      } catch (err) {
        return errorResponse(`Error getting VM status: ${err}`);
      }
    }
  );

  server.tool(
    "vers_vm_wait",
    "Wait for a VM to complete its current task",
    {
      vmId: z.string().describe("The VM ID to wait for"),
      timeout: z.number().optional().describe("Timeout in milliseconds (default: 5 minutes)"),
    },
    async ({ vmId, timeout }) => {
      try {
        const result = await api.waitForVm(vmId, timeout);
        if (result.status === "failed") {
          return errorResponse(JSON.stringify(result, null, 2));
        }
        return jsonResponse(result);
      } catch (err) {
        return errorResponse(`Error waiting for VM: ${err}`);
      }
    }
  );

  server.tool(
    "vers_vm_outputs",
    "Get recent conversation outputs from a VM (like tail -n)",
    {
      vmId: z.string().describe("The VM ID to get outputs from"),
      n: z.number().optional().default(10).describe("Number of recent outputs to return (default: 10)"),
    },
    async ({ vmId, n }) => {
      try {
        return jsonResponse(await api.getVmOutputs(vmId, n));
      } catch (err) {
        return errorResponse(`Error getting VM outputs: ${err}`);
      }
    }
  );

  // ============================================================
  // Config Tools
  // ============================================================

  server.tool("vers_health", "Check the vers-agent server health", async () => {
    return jsonResponse(api.getHealth());
  });

  server.tool("vers_config_get", "Get the current vers-agent configuration", async () => {
    try {
      return jsonResponse(api.getConfig());
    } catch (err) {
      return errorResponse(`Error getting config: ${err}`);
    }
  });

  server.tool(
    "vers_config_set",
    "Set a vers-agent configuration value",
    {
      key: z.string().describe("Configuration key (e.g., model, autoApprovePermissions)"),
      value: z.string().describe("Configuration value"),
    },
    async ({ key, value }) => {
      try {
        const updates: Record<string, unknown> = {};
        if (value === "true") updates[key] = true;
        else if (value === "false") updates[key] = false;
        else updates[key] = value;
        return jsonResponse(await api.setConfig(updates));
      } catch (err) {
        return errorResponse(`Error setting config: ${err}`);
      }
    }
  );

  // Connect via stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr so it doesn't interfere with stdio protocol
  console.error("vers-agent MCP server started (standalone mode)");
}
