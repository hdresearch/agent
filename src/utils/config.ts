// Global configuration store for server endpoints
// Persists to ~/.vers/agent_config.json

import { homedir } from "os";
import { join } from "path";

const CONFIG_DIR = join(homedir(), ".vers");
const CONFIG_FILE = join(CONFIG_DIR, "agent_config.json");
const MCP_CONFIG_FILE = join(CONFIG_DIR, "mcp_servers.json");

// MCP Server configuration types (mirrors SDK types)
export interface McpStdioServerConfig {
  type?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpSSEServerConfig {
  type: "sse";
  url: string;
  headers?: Record<string, string>;
}

export interface McpHttpServerConfig {
  type: "http";
  url: string;
  headers?: Record<string, string>;
}

export type McpServerConfig = McpStdioServerConfig | McpSSEServerConfig | McpHttpServerConfig;

export interface AgentConfig {
  model: string;
  thinkingBudget: number | null; // null = off, number = budget tokens (min 1024)
  lastSessionId: string | null;  // For --continue functionality
}

export interface SessionStats {
  totalCost: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  turns: number;
  sessionId: string | null;
  mode: "default" | "plan";
}

// Plan entry from agent
export interface PlanEntry {
  id: string;
  description: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  priority?: number;
}

// Current plan state
let currentPlan: PlanEntry[] = [];

// Context window limits by model (approximate)
export const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  sonnet: 200000,
  opus: 200000,
  haiku: 200000,
};

// Default configuration
const defaultConfig: AgentConfig = {
  model: "opus",
  thinkingBudget: null,
  lastSessionId: null,
};

let config: AgentConfig = { ...defaultConfig };

// Session statistics (aggregated across tasks, not persisted)
let session: SessionStats = {
  totalCost: 0,
  totalTokens: 0,
  inputTokens: 0,
  outputTokens: 0,
  turns: 0,
  sessionId: null,
  mode: "default",
};

// ============================================================
// Persistence
// ============================================================

async function ensureConfigDir(): Promise<void> {
  try {
    await Bun.file(CONFIG_DIR).exists();
  } catch {
    // Directory doesn't exist, create it
  }
  const proc = Bun.spawn(["mkdir", "-p", CONFIG_DIR], { stdout: "ignore", stderr: "ignore" });
  await proc.exited;
}

export async function loadConfig(): Promise<AgentConfig> {
  try {
    const file = Bun.file(CONFIG_FILE);
    if (await file.exists()) {
      const text = await file.text();
      const saved = JSON.parse(text) as Partial<AgentConfig>;

      // Merge with defaults (in case new fields were added)
      config = {
        ...defaultConfig,
        ...saved,
      };

      // Validate model
      const validModels = ["sonnet", "opus", "haiku"];
      if (!validModels.includes(config.model)) {
        config.model = defaultConfig.model;
      }
    } else {
      // No config file exists, create one with defaults
      config = { ...defaultConfig };
      await saveConfig();
    }
  } catch (err) {
    // If file doesn't exist or is invalid, use defaults
    console.error("Failed to load config, using defaults:", err);
    config = { ...defaultConfig };
  }

  return getConfig();
}

export async function saveConfig(): Promise<void> {
  try {
    await ensureConfigDir();
    await Bun.write(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (err) {
    console.error("Failed to save config:", err);
  }
}

// ============================================================
// Config getters/setters
// ============================================================

export function getConfig(): AgentConfig {
  return { ...config };
}

export async function setConfig(updates: Partial<AgentConfig>): Promise<AgentConfig> {
  if (updates.model !== undefined) {
    const validModels = ["sonnet", "opus", "haiku"];
    if (!validModels.includes(updates.model)) {
      throw new Error(`Invalid model: ${updates.model}. Must be one of: ${validModels.join(", ")}`);
    }
    config.model = updates.model;
  }

  if (updates.thinkingBudget !== undefined) {
    if (updates.thinkingBudget !== null && updates.thinkingBudget < 1024) {
      throw new Error("Thinking budget must be at least 1024 tokens");
    }
    config.thinkingBudget = updates.thinkingBudget;
  }

  if (updates.lastSessionId !== undefined) {
    config.lastSessionId = updates.lastSessionId;
  }

  // Persist changes
  await saveConfig();

  return getConfig();
}

// Synchronous setter for cases where we can't await
export function setConfigSync(updates: Partial<AgentConfig>): AgentConfig {
  if (updates.model !== undefined) {
    const validModels = ["sonnet", "opus", "haiku"];
    if (!validModels.includes(updates.model)) {
      throw new Error(`Invalid model: ${updates.model}. Must be one of: ${validModels.join(", ")}`);
    }
    config.model = updates.model;
  }

  if (updates.thinkingBudget !== undefined) {
    if (updates.thinkingBudget !== null && updates.thinkingBudget < 1024) {
      throw new Error("Thinking budget must be at least 1024 tokens");
    }
    config.thinkingBudget = updates.thinkingBudget;
  }

  if (updates.lastSessionId !== undefined) {
    config.lastSessionId = updates.lastSessionId;
  }

  // Fire and forget save
  saveConfig().catch(() => {});

  return getConfig();
}

// ============================================================
// Session getters/setters (not persisted)
// ============================================================

export function getSession(): SessionStats {
  return { ...session };
}

export function updateSession(updates: Partial<SessionStats>): SessionStats {
  if (updates.totalCost !== undefined) {
    session.totalCost = updates.totalCost;
  }
  if (updates.totalTokens !== undefined) {
    session.totalTokens = updates.totalTokens;
  }
  if (updates.turns !== undefined) {
    session.turns = updates.turns;
  }
  if (updates.sessionId !== undefined) {
    session.sessionId = updates.sessionId;
    // Also persist as lastSessionId for --continue
    setConfigSync({ lastSessionId: updates.sessionId });
  }
  if (updates.mode !== undefined) {
    session.mode = updates.mode;
  }
  return getSession();
}

// Set session mode (default or plan)
export function setSessionMode(mode: "default" | "plan"): SessionStats {
  session.mode = mode;
  // Clear plan when switching modes
  if (mode === "default") {
    currentPlan = [];
  }
  return getSession();
}

// Get current session mode
export function getSessionMode(): "default" | "plan" {
  return session.mode;
}

export function addToSession(cost: number, inputTokens: number, outputTokens: number): SessionStats {
  session.totalCost += cost;
  session.inputTokens += inputTokens;
  session.outputTokens += outputTokens;
  session.totalTokens += inputTokens + outputTokens;
  session.turns += 1;
  return getSession();
}

export function resetSession(): SessionStats {
  session = {
    totalCost: 0,
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    turns: 0,
    sessionId: null,
    mode: "default",
  };
  currentPlan = [];
  return getSession();
}

// ============================================================
// Plan Management
// ============================================================

export function getPlan(): PlanEntry[] {
  return [...currentPlan];
}

export function setPlan(entries: PlanEntry[]): PlanEntry[] {
  currentPlan = [...entries];
  return getPlan();
}

export function updatePlanEntry(id: string, updates: Partial<PlanEntry>): PlanEntry | null {
  const index = currentPlan.findIndex(e => e.id === id);
  if (index === -1) return null;

  currentPlan[index] = { ...currentPlan[index], ...updates };
  return currentPlan[index];
}

export function addPlanEntry(entry: PlanEntry): PlanEntry[] {
  currentPlan.push(entry);
  return getPlan();
}

export function clearPlan(): void {
  currentPlan = [];
}

// ============================================================
// MCP Server Configuration (persisted separately)
// ============================================================

let mcpServers: Record<string, McpServerConfig> = {};

export async function loadMcpServers(): Promise<Record<string, McpServerConfig>> {
  try {
    const file = Bun.file(MCP_CONFIG_FILE);
    if (await file.exists()) {
      const text = await file.text();
      const saved = JSON.parse(text) as Record<string, McpServerConfig>;
      mcpServers = saved;
    }
  } catch (err) {
    console.error("Failed to load MCP servers config:", err);
    mcpServers = {};
  }
  return getMcpServers();
}

export async function saveMcpServers(): Promise<void> {
  try {
    await ensureConfigDir();
    await Bun.write(MCP_CONFIG_FILE, JSON.stringify(mcpServers, null, 2));
  } catch (err) {
    console.error("Failed to save MCP servers config:", err);
  }
}

export function getMcpServers(): Record<string, McpServerConfig> {
  return { ...mcpServers };
}

export async function addMcpServer(name: string, config: McpServerConfig): Promise<Record<string, McpServerConfig>> {
  mcpServers[name] = config;
  await saveMcpServers();
  return getMcpServers();
}

export async function removeMcpServer(name: string): Promise<boolean> {
  if (name in mcpServers) {
    delete mcpServers[name];
    await saveMcpServers();
    return true;
  }
  return false;
}

export async function setMcpServers(servers: Record<string, McpServerConfig>): Promise<Record<string, McpServerConfig>> {
  mcpServers = { ...servers };
  await saveMcpServers();
  return getMcpServers();
}
