// Global configuration store for server endpoints
// Persists to ~/.vers/agent_config.json

import { homedir } from "os";
import { join } from "path";
import { mkdirSync, existsSync } from "fs";
import { logStream } from "./log-stream";

const CONFIG_DIR = join(homedir(), ".vers");
const CONFIG_FILE = join(CONFIG_DIR, "agent_config.json");
const MCP_CONFIG_FILE = join(CONFIG_DIR, "mcp_servers.json");
const HISTORY_FILE = join(CONFIG_DIR, "command_history.json");

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
  lastSessionId: string | null;  // For --continue functionality
  lastServerUrl: string | null;  // Last remote server URL for auto-reconnect
  defaultAgent: string;          // Default agent identity (e.g., "claude-sdk", "claude.com")
  autoApprovePermissions: boolean; // Auto-approve all permission requests (yolo mode)
  versApiKey: string | null;     // VERS API key for auth and SDK calls
  cwd: string | null;            // Working directory (null = use process.cwd() at startup)
  llmGatewayUrl: string | null;  // LLM gateway URL (e.g., http://litellm.llmgateway.internal:4000/anthropic)
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
  lastSessionId: null,
  lastServerUrl: null,
  defaultAgent: "claude.com",  // Default to Claude Code ACP subprocess mode
  autoApprovePermissions: true, // Auto-approve all permissions (yolo mode)
  versApiKey: null,            // Set via /claim or environment
  cwd: null,                   // null = use directory where server was launched
  llmGatewayUrl: null,         // null = use default Anthropic API
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

/**
 * Ensure the configured cwd directory exists, creating it if necessary.
 */
function ensureCwdExists(cwd: string | null): void {
  if (!cwd) return;

  try {
    if (!existsSync(cwd)) {
      mkdirSync(cwd, { recursive: true });
      logStream.info("[config] Created cwd directory", { cwd });
    }
  } catch (err) {
    logStream.error("[config] Failed to create cwd directory", {
      cwd,
      error: err instanceof Error ? err.message : String(err)
    });
  }
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

      // Ensure cwd exists if configured
      ensureCwdExists(config.cwd);
    } else {
      // No config file exists, create one with defaults
      config = { ...defaultConfig };
      await saveConfig();
    }
  } catch (err) {
    // If file doesn't exist or is invalid, use defaults
    logStream.error("[config] Failed to load config, using defaults", { error: err instanceof Error ? err.message : String(err) });
    config = { ...defaultConfig };
  }

  return getConfig();
}

export async function saveConfig(): Promise<void> {
  try {
    await ensureConfigDir();
    await Bun.write(CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (err) {
    logStream.error("[config] Failed to save config", { error: err instanceof Error ? err.message : String(err) });
  }
}

// ============================================================
// Config getters/setters
// ============================================================

export function getConfig(): AgentConfig {
  return { ...config };
}

/**
 * Get the effective working directory.
 * Uses config.cwd if set, otherwise falls back to process.cwd().
 */
export function getEffectiveCwd(): string {
  return config.cwd || process.cwd();
}

export async function setConfig(updates: Partial<AgentConfig>): Promise<AgentConfig> {
  if (updates.model !== undefined) {
    const validModels = ["sonnet", "opus", "haiku"];
    if (!validModels.includes(updates.model)) {
      throw new Error(`Invalid model: ${updates.model}. Must be one of: ${validModels.join(", ")}`);
    }
    config.model = updates.model;
  }

  if (updates.lastSessionId !== undefined) {
    config.lastSessionId = updates.lastSessionId;
  }

  if (updates.lastServerUrl !== undefined) {
    config.lastServerUrl = updates.lastServerUrl;
  }

  if (updates.defaultAgent !== undefined) {
    config.defaultAgent = updates.defaultAgent;
  }

  if (updates.autoApprovePermissions !== undefined) {
    config.autoApprovePermissions = updates.autoApprovePermissions;
  }

  if (updates.versApiKey !== undefined) {
    config.versApiKey = updates.versApiKey;
  }

  if (updates.cwd !== undefined) {
    config.cwd = updates.cwd;
    ensureCwdExists(config.cwd);
  }

  if (updates.llmGatewayUrl !== undefined) {
    config.llmGatewayUrl = updates.llmGatewayUrl;
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

  if (updates.lastSessionId !== undefined) {
    config.lastSessionId = updates.lastSessionId;
  }

  if (updates.lastServerUrl !== undefined) {
    config.lastServerUrl = updates.lastServerUrl;
  }

  if (updates.defaultAgent !== undefined) {
    config.defaultAgent = updates.defaultAgent;
  }

  if (updates.autoApprovePermissions !== undefined) {
    config.autoApprovePermissions = updates.autoApprovePermissions;
  }

  if (updates.versApiKey !== undefined) {
    config.versApiKey = updates.versApiKey;
  }

  if (updates.cwd !== undefined) {
    config.cwd = updates.cwd;
    ensureCwdExists(config.cwd);
  }

  if (updates.llmGatewayUrl !== undefined) {
    config.llmGatewayUrl = updates.llmGatewayUrl;
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

  const existing = currentPlan[index];
  if (!existing) return null;

  const updated: PlanEntry = { ...existing, ...updates };
  currentPlan[index] = updated;
  return updated;
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
    logStream.error("[config] Failed to load MCP servers config", { error: err instanceof Error ? err.message : String(err) });
    mcpServers = {};
  }
  return getMcpServers();
}

export async function saveMcpServers(): Promise<void> {
  try {
    await ensureConfigDir();
    await Bun.write(MCP_CONFIG_FILE, JSON.stringify(mcpServers, null, 2));
  } catch (err) {
    logStream.error("[config] Failed to save MCP servers config", { error: err instanceof Error ? err.message : String(err) });
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

// ============================================================
// Command History (persisted, per-session)
// ============================================================

const MAX_HISTORY_SIZE = 100;
let allHistory: Record<string, string[]> = {};
let currentSessionId: string | null = null;
let historyLoaded = false;

async function ensureHistoryLoaded(): Promise<void> {
  if (historyLoaded) return;
  try {
    const file = Bun.file(HISTORY_FILE);
    if (await file.exists()) {
      const text = await file.text();
      const saved = JSON.parse(text);
      // Handle migration from old array format to new per-session object format
      if (Array.isArray(saved)) {
        // Old format was just an array - migrate to new format under "migrated" key
        allHistory = { migrated: saved };
        // Save in new format
        saveCommandHistory().catch(() => {});
      } else if (typeof saved === "object" && saved !== null) {
        allHistory = saved as Record<string, string[]>;
      }
    }
  } catch {
    allHistory = {};
  }
  historyLoaded = true;
}

export async function loadCommandHistory(sessionId?: string | null): Promise<string[]> {
  await ensureHistoryLoaded();
  currentSessionId = sessionId || null;
  return getCommandHistory();
}

export async function saveCommandHistory(): Promise<void> {
  try {
    await ensureConfigDir();
    await Bun.write(HISTORY_FILE, JSON.stringify(allHistory, null, 2));
  } catch {
    // Ignore save errors
  }
}

export function getCommandHistory(): string[] {
  if (!currentSessionId) return [];
  const history = allHistory[currentSessionId];
  return Array.isArray(history) ? [...history] : [];
}

export function setHistorySession(sessionId: string | null): void {
  currentSessionId = sessionId;
}

export function addToCommandHistory(command: string): string[] {
  if (!currentSessionId) return [];

  const trimmed = command.trim();
  if (!trimmed) return getCommandHistory();

  const history = allHistory[currentSessionId] || [];

  // Avoid duplicates at the top
  if (history[0] === trimmed) {
    return history;
  }

  // Add to front, keep max size
  allHistory[currentSessionId] = [trimmed, ...history].slice(0, MAX_HISTORY_SIZE);

  // Fire and forget save
  saveCommandHistory().catch(() => {});

  return getCommandHistory();
}
