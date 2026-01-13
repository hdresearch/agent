// Agent registry - loads and manages agent definitions
// Supports JSON files in src/data/agents/

import { readdir } from "node:fs/promises";
import { join, basename, extname } from "node:path";
import type { AgentDefinition } from "./types";
import { getCurrentOS, getOSValue } from "./types";
import { logStream } from "../utils/log-stream";

// ============================================================
// Registry State
// ============================================================

let agentRegistry: Map<string, AgentDefinition> = new Map();
let registryLoaded = false;

// ============================================================
// Loading
// ============================================================

/**
 * Get the path to the agents data directory
 */
function getAgentsDataDir(): string {
  // Look relative to the project root
  return join(import.meta.dir, "..", "data", "agents");
}

/**
 * Load an agent definition from a JSON file
 */
async function loadAgentFile(filePath: string): Promise<AgentDefinition | null> {
  try {
    const file = Bun.file(filePath);
    const content = await file.json();

    // Validate required fields
    if (!content.identity || !content.name || !content.runCommand) {
      logStream.warn("[registry] Invalid agent file: missing required fields", { filePath });
      return null;
    }

    // Set defaults
    const agent: AgentDefinition = {
      identity: content.identity,
      name: content.name,
      shortName: content.shortName || content.identity.split(".")[0],
      url: content.url || "",
      protocol: content.protocol || "acp",
      type: content.type || "coding",
      authorName: content.authorName || "",
      authorUrl: content.authorUrl || "",
      publisherName: content.publisherName || "",
      publisherUrl: content.publisherUrl || "",
      description: content.description || "",
      tags: content.tags || [],
      help: content.help,
      welcome: content.welcome,
      runCommand: content.runCommand,
      envVars: content.envVars,
      actions: content.actions,
      active: content.active !== false, // Default true
    };

    return agent;
  } catch (error) {
    logStream.error("[registry] Failed to load agent file", { filePath, error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

/**
 * Load all agent definitions from the data directory
 */
export async function loadAgentRegistry(): Promise<Map<string, AgentDefinition>> {
  const dataDir = getAgentsDataDir();

  try {
    const files = await readdir(dataDir);
    const jsonFiles = files.filter(f => extname(f) === ".json");

    // Load all files in parallel instead of sequentially
    const agentPromises = jsonFiles.map(file => {
      const filePath = join(dataDir, file);
      return loadAgentFile(filePath);
    });

    const agents = await Promise.all(agentPromises);

    // Register all successfully loaded agents
    for (const agent of agents) {
      if (agent && agent.active !== false) {
        agentRegistry.set(agent.identity, agent);
      }
    }

    registryLoaded = true;
  } catch (error) {
    // Directory might not exist yet, that's OK
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      logStream.error("[registry] Failed to load agent registry", { error: error instanceof Error ? error.message : String(error) });
    }
    registryLoaded = true;
  }

  return agentRegistry;
}

/**
 * Ensure the registry is loaded
 */
export async function ensureRegistryLoaded(): Promise<void> {
  if (!registryLoaded) {
    await loadAgentRegistry();
  }
}

// ============================================================
// Lookups
// ============================================================

/**
 * Get an agent by identity or short name
 */
export function getAgent(idOrName: string): AgentDefinition | undefined {
  const lower = idOrName.toLowerCase();

  // Try direct identity lookup first
  const direct = agentRegistry.get(idOrName);
  if (direct) return direct;

  // Try case-insensitive identity lookup
  for (const [identity, agent] of agentRegistry) {
    if (identity.toLowerCase() === lower) {
      return agent;
    }
  }

  // Try short name lookup
  for (const agent of agentRegistry.values()) {
    if (agent.shortName.toLowerCase() === lower) {
      return agent;
    }
  }

  // Try name lookup
  for (const agent of agentRegistry.values()) {
    if (agent.name.toLowerCase() === lower) {
      return agent;
    }
  }

  return undefined;
}

/**
 * List all active agents
 */
export function listAgents(): AgentDefinition[] {
  return Array.from(agentRegistry.values()).filter(a => a.active !== false);
}

/**
 * Get the run command for an agent on the current OS
 */
export function getRunCommand(agent: AgentDefinition): string | null {
  return getOSValue(agent.runCommand) ?? null;
}

/**
 * Get the install action for an agent on the current OS
 */
export function getInstallAction(agent: AgentDefinition): { command: string; description: string } | null {
  if (!agent.actions) return null;
  const osActions = getOSValue(agent.actions);
  if (!osActions) return null;
  return osActions.install ?? null;
}

/**
 * Check if a command exists in PATH
 */
export async function commandExists(command: string): Promise<boolean> {
  try {
    // Extract just the command name (not arguments)
    const cmdName = command.split(/\s+/)[0];
    if (!cmdName) return false;
    const proc = Bun.spawn(["which", cmdName], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    return exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Install an agent if it has an install action
 * Returns true if installation succeeded or was not needed
 */
export async function installAgent(agent: AgentDefinition): Promise<{ success: boolean; message: string }> {
  const runCommand = getRunCommand(agent);
  if (!runCommand) {
    return { success: false, message: `No run command defined for ${agent.name} on this OS` };
  }

  // Check if already installed
  if (await commandExists(runCommand)) {
    return { success: true, message: `${agent.name} is already installed` };
  }

  // Get install action
  const installAction = getInstallAction(agent);
  if (!installAction) {
    return {
      success: false,
      message: `${agent.name} is not installed and no install command is defined. Please install manually.`
    };
  }

  logStream.info(`[registry] Installing ${agent.name}`, { description: installAction.description });
  logStream.info("[registry] Running install command", { command: installAction.command });

  try {
    // Run install command
    const proc = Bun.spawn(["bash", "-c", installAction.command], {
      stdout: "inherit",
      stderr: "inherit",
    });
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      return {
        success: false,
        message: `Installation failed with exit code ${exitCode}`
      };
    }

    // Verify installation
    if (await commandExists(runCommand)) {
      return { success: true, message: `${agent.name} installed successfully` };
    } else {
      return {
        success: false,
        message: `Installation completed but command '${runCommand}' still not found`
      };
    }
  } catch (error) {
    return {
      success: false,
      message: `Installation failed: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

/**
 * Ensure an agent is installed, installing if necessary
 */
export async function ensureAgentInstalled(agent: AgentDefinition): Promise<{ success: boolean; message: string }> {
  const runCommand = getRunCommand(agent);
  if (!runCommand) {
    return { success: false, message: `No run command defined for ${agent.name} on this OS` };
  }

  // Check if already installed
  if (await commandExists(runCommand)) {
    return { success: true, message: `${agent.name} is available` };
  }

  // Try to install
  return installAgent(agent);
}

/**
 * Get the environment variables to inject for an agent
 */
export function getAgentEnv(
  agent: AgentDefinition,
  baseEnv?: Record<string, string>
): Record<string, string> {
  // Start with process.env, filtering out undefined values
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }

  // Merge base env
  if (baseEnv) {
    Object.assign(env, baseEnv);
  }

  // Add agent-specific env vars
  if (agent.envVars) {
    for (const [key, value] of Object.entries(agent.envVars)) {
      if (value) {
        env[key] = value;
      }
    }
  }

  return env;
}

// ============================================================
// Registration (for programmatic registration)
// ============================================================

/**
 * Register an agent definition programmatically
 */
export function registerAgent(agent: AgentDefinition): void {
  agentRegistry.set(agent.identity, agent);
}

/**
 * Unregister an agent
 */
export function unregisterAgent(identity: string): boolean {
  return agentRegistry.delete(identity);
}

/**
 * Clear the registry
 */
export function clearRegistry(): void {
  agentRegistry.clear();
  registryLoaded = false;
  registryInitialized = false;
}

// ============================================================
// Built-in Agents
// ============================================================

/**
 * Register built-in agents
 * Note: Claude SDK mode was removed - all agents now use ACP subprocess mode.
 * Default agents are embedded here to work when bundled.
 */
export function registerBuiltinAgents(): void {
  // Claude Code ACP agent (default)
  registerAgent({
    identity: "claude.com",
    name: "Claude Code",
    shortName: "claude",
    url: "https://www.claude.com/product/claude-code",
    protocol: "acp",
    type: "coding",
    authorName: "Anthropic",
    authorUrl: "https://www.anthropic.com/",
    publisherName: "vers-agent",
    publisherUrl: "",
    description: "Claude's raw power in your terminal via ACP",
    tags: [],
    runCommand: {
      "*": "claude-code-acp",
    },
    actions: {
      "*": {
        install: {
          command: "npm install -g @zed-industries/claude-code-acp",
          description: "Install Claude Code ACP adapter from Zed",
        },
      },
    },
    active: true,
  });
}

// ============================================================
// Initialization
// ============================================================

// Track if registry has been initialized
let registryInitialized = false;

/**
 * Initialize the registry with built-in agents and load from files
 * Safe to call multiple times - will only initialize once
 */
export async function initializeRegistry(): Promise<void> {
  if (registryInitialized) return;
  registryInitialized = true;

  registerBuiltinAgents();
  await loadAgentRegistry();
}
