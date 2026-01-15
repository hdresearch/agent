// Config and MCP server management handlers

import {
  getConfig,
  setConfig,
  getMcpServers,
  addMcpServer,
  removeMcpServer,
  type McpServerConfig,
  type AgentConfig,
} from "../../utils/config";

// ============================================================
// Config Handlers
// ============================================================

export interface ConfigGetResult {
  config: AgentConfig;
}

export function handleConfigGet(): ConfigGetResult {
  return { config: getConfig() };
}

export interface ConfigSetParams {
  autoApprovePermissions?: boolean;
  model?: string;
  defaultAgent?: string;
}

export interface ConfigSetResult {
  success: boolean;
  config: AgentConfig;
}

export async function handleConfigSet(params: ConfigSetParams): Promise<ConfigSetResult> {
  const updatedConfig = await setConfig(params);
  return { success: true, config: updatedConfig };
}

// ============================================================
// MCP Server Handlers
// ============================================================

export interface McpListResult {
  servers: Record<string, McpServerConfig>;
}

export function handleMcpList(): McpListResult {
  const servers = getMcpServers();
  return { servers };
}

export interface McpAddParams {
  name: string;
  config: McpServerConfig;
}

export interface McpAddResult {
  success: boolean;
  servers: Record<string, McpServerConfig>;
}

export async function handleMcpAdd(params: McpAddParams): Promise<McpAddResult> {
  if (!params.name) {
    throw new Error("Missing name parameter");
  }
  if (!params.config) {
    throw new Error("Missing config parameter");
  }
  const servers = await addMcpServer(params.name, params.config);
  return { success: true, servers };
}

export interface McpRemoveParams {
  name: string;
}

export interface McpRemoveResult {
  success: boolean;
  servers: Record<string, McpServerConfig>;
}

export async function handleMcpRemove(params: McpRemoveParams): Promise<McpRemoveResult> {
  if (!params.name) {
    throw new Error("Missing name parameter");
  }
  const removed = await removeMcpServer(params.name);
  return { success: removed, servers: getMcpServers() };
}
