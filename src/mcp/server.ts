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

// Direct imports for standalone operation
import { listManagedVms, createManagedVm, getManagedVm } from "../orchestrator";
import { execute, getAgentUrl } from "../vm";
import { VM_AGENT_DIR } from "../vm/constants";
import { loadConfig, getConfig, setConfig } from "../utils/config";
import { subscribeToVmEvents } from "../server/vm-event-aggregator";

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
  await loadConfig();

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
      try {
        const vms = await listManagedVms();
        const result = {
          vms: vms.map(vm => ({
            vmId: vm.vmId,
            parent: vm.parent,
            status: vm.metadata?.status || "ready",
            task: vm.metadata?.task,
            approach: vm.metadata?.approach,
            createdAt: vm.metadata?.createdAt || new Date().toISOString(),
          })),
        };
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error listing VMs: ${err}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "vers_vm_create",
    "Create a new VM with optional task description",
    { task: z.string().optional().describe("Optional task description for the VM") },
    async ({ task }) => {
      try {
        const vm = await createManagedVm({}, task);
        const agentUrl = getAgentUrl(vm.vmId);
        const result = {
          vmId: vm.vmId,
          agentUrl,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error creating VM: ${err}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "vers_vm_run",
    "Run a prompt on all VMs in parallel",
    { prompt: z.string().describe("The prompt to send to all VMs") },
    async ({ prompt }) => {
      try {
        const allVms = await listManagedVms();
        const dispatched: string[] = [];

        // Fire prompts to all VMs without waiting for completion
        for (const vm of allVms) {
          try {
            const managed = await getManagedVm(vm.vmId);
            if (managed) {
              // Initialize and send prompt without waiting
              managed.client.initialize("vers-agent").then(() => {
                managed.client.newSession().then((session) => {
                  managed.sessionId = session.sessionId;
                  managed.client.prompt(prompt).catch(() => {
                    // Ignore prompt errors
                  });
                });
              }).catch(() => {
                // Ignore initialization errors
              });
              dispatched.push(vm.vmId);
            }
          } catch {
            // Skip VMs that can't be reached
          }
        }

        const result = {
          dispatched: dispatched.length,
          vmIds: dispatched,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error running prompt: ${err}` }],
          isError: true,
        };
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
        const result = await execute(vmId, command);

        let output = "";
        if (result.stdout) output += result.stdout;
        if (result.stderr) output += result.stderr;
        if (result.exitCode !== undefined && result.exitCode !== 0) {
          output += `\n[Exit code: ${result.exitCode}]`;
        }

        return {
          content: [{ type: "text", text: output || "(no output)" }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error executing command: ${err}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "vers_vm_eval",
    "Evaluate a VM by running build/test/lint/typecheck",
    { vmId: z.string().describe("The VM ID to evaluate") },
    async ({ vmId }) => {
      try {
        const managed = await getManagedVm(vmId);
        if (!managed) {
          return {
            content: [{ type: "text", text: `Error: VM not found: ${vmId}` }],
            isError: true,
          };
        }

        const evalTimeout = 60000;
        const workDir = VM_AGENT_DIR;

        // Detect project type
        const detectCmd = `
          if [ -f bun.lock ] || [ -f bun.lockb ]; then echo "bun";
          elif [ -f package.json ]; then echo "node";
          elif [ -f Cargo.toml ]; then echo "rust";
          elif [ -f go.mod ]; then echo "go";
          elif [ -f pyproject.toml ] || [ -f requirements.txt ]; then echo "python";
          else echo "unknown"; fi
        `.trim().replace(/\n\s*/g, ' ');

        const detectResult = await execute(vmId, `cd ${workDir} && ${detectCmd}`);
        const projectType = detectResult.stdout.trim() || "unknown";

        // Get default commands based on project type
        const defaultCommands: Record<string, { build?: string; test?: string; lint?: string; typecheck?: string }> = {
          bun: { build: "bun run build", test: "bun test", lint: "bun run lint", typecheck: "bun run tsc --noEmit" },
          node: { build: "npm run build", test: "npm test", lint: "npm run lint", typecheck: "npm run typecheck" },
          rust: { build: "cargo build", test: "cargo test", lint: "cargo clippy -- -D warnings", typecheck: "cargo check" },
          go: { build: "go build ./...", test: "go test ./...", lint: "golangci-lint run", typecheck: "go vet ./..." },
          python: { test: "pytest", lint: "ruff check .", typecheck: "mypy ." },
          unknown: {},
        };

        const cmds = defaultCommands[projectType] || {};
        const results: Record<string, { success: boolean; exitCode: number; stdout: string; stderr: string; durationMs: number }> = {};
        const scoreBreakdown = { build: 0, test: 0, lint: 0, typecheck: 0 };

        // Helper to run a command
        async function runCmd(cmd: string): Promise<{ success: boolean; exitCode: number; stdout: string; stderr: string; durationMs: number }> {
          const start = Date.now();
          try {
            const result = await execute(vmId, `cd ${workDir} && timeout ${Math.floor(evalTimeout / 1000)} ${cmd}`);
            return {
              success: result.exitCode === 0,
              exitCode: result.exitCode,
              stdout: result.stdout,
              stderr: result.stderr,
              durationMs: Date.now() - start,
            };
          } catch (err) {
            return {
              success: false,
              exitCode: -1,
              stdout: "",
              stderr: err instanceof Error ? err.message : String(err),
              durationMs: Date.now() - start,
            };
          }
        }

        const startTime = Date.now();

        // Run build
        if (cmds.build) {
          results.build = await runCmd(cmds.build);
          scoreBreakdown.build = results.build.success ? 25 : 0;
        } else {
          scoreBreakdown.build = 25;
        }

        // Run typecheck
        if (cmds.typecheck) {
          results.typecheck = await runCmd(cmds.typecheck);
          scoreBreakdown.typecheck = results.typecheck.success ? 15 : 0;
        } else {
          scoreBreakdown.typecheck = 10;
        }

        // Run lint
        if (cmds.lint) {
          results.lint = await runCmd(cmds.lint);
          scoreBreakdown.lint = results.lint.success ? 20 : 0;
        } else {
          scoreBreakdown.lint = 15;
        }

        // Run tests
        if (cmds.test) {
          results.test = await runCmd(cmds.test);
          scoreBreakdown.test = results.test.success ? 40 : 0;
        } else {
          scoreBreakdown.test = 30;
        }

        const score = scoreBreakdown.build + scoreBreakdown.test + scoreBreakdown.lint + scoreBreakdown.typecheck;
        const success = (!results.build || results.build.success) && (!results.test || results.test.success);

        const evalResult = {
          vmId,
          success,
          projectType,
          score,
          scoreBreakdown,
          results,
          totalDurationMs: Date.now() - startTime,
        };

        return {
          content: [{ type: "text", text: JSON.stringify(evalResult, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error evaluating VM: ${err}` }],
          isError: true,
        };
      }
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
      try {
        const vmList = await listManagedVms();
        const result: Record<string, {
          vmId: string;
          status: string;
          task?: string;
          lastMessage?: string;
          lastMessageType?: string;
        }> = {};

        // Fetch outputs from each VM in parallel
        await Promise.all(
          vmList.map(async (vm) => {
            const vmId = vm.vmId;
            const metadata = vm.metadata;
            let lastMessage: string | undefined;
            let lastMessageType: string | undefined;

            try {
              const managed = await getManagedVm(vmId);
              if (managed) {
                const outputsResult = await managed.client.getSessionOutputs({});
                const outputs = outputsResult.outputs || [];

                // Find the last assistant message
                for (let i = outputs.length - 1; i >= 0; i--) {
                  const output = outputs[i];
                  if (!output) continue;
                  if (output.type === "text") {
                    lastMessage = output.content;
                    lastMessageType = "assistant";
                    break;
                  } else if (output.type === "tool-result" || output.type === "tool_result") {
                    if (!lastMessage) {
                      lastMessage = output.content.slice(0, 200);
                      lastMessageType = "tool_result";
                    }
                  }
                }
              }
            } catch {
              // VM not reachable
            }

            result[vmId] = {
              vmId,
              status: metadata?.status || "unknown",
              task: metadata?.task,
              lastMessage,
              lastMessageType,
            };
          })
        );

        return {
          content: [{ type: "text", text: JSON.stringify({ vms: result }, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error getting VM status: ${err}` }],
          isError: true,
        };
      }
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
        .describe("Timeout in milliseconds (default: 5 minutes)"),
    },
    async ({ vmId, timeout }) => {
      try {
        const waitTimeout = timeout ?? 300000; // 5 min default
        const startTime = Date.now();

        const managed = await getManagedVm(vmId);
        if (!managed) {
          return {
            content: [{ type: "text", text: JSON.stringify({ vmId, status: "failed", error: "VM not found" }, null, 2) }],
            isError: true,
          };
        }

        return new Promise((resolve) => {
          let resolved = false;
          let timeoutId: ReturnType<typeof setTimeout> | null = null;

          // Subscribe to VM events
          const unsubscribe = subscribeToVmEvents((event) => {
            if (resolved) return;
            if (event.vmId !== vmId) return;

            const eventType = event.event.type;

            if (eventType === "completed") {
              resolved = true;
              if (timeoutId) clearTimeout(timeoutId);
              unsubscribe();

              const durationMs = Date.now() - startTime;
              resolve({
                content: [{ type: "text", text: JSON.stringify({ vmId, status: "completed", durationMs }, null, 2) }],
              });
            } else if (eventType === "failed") {
              resolved = true;
              if (timeoutId) clearTimeout(timeoutId);
              unsubscribe();

              const errorData = event.event.data as { error?: string };
              resolve({
                content: [{ type: "text", text: JSON.stringify({
                  vmId,
                  status: "failed",
                  durationMs: Date.now() - startTime,
                  error: errorData?.error || "Task failed",
                }, null, 2) }],
                isError: true,
              });
            }
          });

          // Set timeout
          timeoutId = setTimeout(() => {
            if (resolved) return;
            resolved = true;
            unsubscribe();

            resolve({
              content: [{ type: "text", text: JSON.stringify({
                vmId,
                status: "timeout",
                durationMs: waitTimeout,
                error: `Timeout after ${waitTimeout}ms`,
              }, null, 2) }],
            });
          }, waitTimeout);
        });
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error waiting for VM: ${err}` }],
          isError: true,
        };
      }
    }
  );

  // ============================================================
  // Config Tools
  // ============================================================

  server.tool("vers_health", "Check the vers-agent server health", async () => {
    return {
      content: [{ type: "text", text: JSON.stringify({
        status: "ok",
        mode: "standalone",
        version: "1.0.0",
      }, null, 2) }],
    };
  });

  server.tool(
    "vers_config_get",
    "Get the current vers-agent configuration",
    async () => {
      try {
        const config = getConfig();
        return {
          content: [{ type: "text", text: JSON.stringify(config, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error getting config: ${err}` }],
          isError: true,
        };
      }
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
      try {
        const updates: Record<string, unknown> = {};

        // Handle boolean values
        if (value === "true") updates[key] = true;
        else if (value === "false") updates[key] = false;
        else updates[key] = value;

        const config = await setConfig(updates);
        return {
          content: [{ type: "text", text: JSON.stringify(config, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Error setting config: ${err}` }],
          isError: true,
        };
      }
    }
  );

  // Connect via stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr so it doesn't interfere with stdio protocol
  console.error("vers-agent MCP server started (standalone mode)");
}
