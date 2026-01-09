// Agent management handlers

import {
  initializeRegistry,
  listAgents,
  getAgent,
  type AgentDefinition,
} from "../../agents";
import type {
  AgentInfo,
  AgentListResult,
  AgentSelectParams,
  AgentSelectResult,
  AgentStatusResult,
} from "../../protocol/acp-types";
import { logStream } from "../../utils/log-stream";

// State accessors passed in from the server
export interface AgentHandlerContext {
  getCurrentAgentId: () => string;
  setCurrentAgentId: (id: string) => void;
  getRunningTaskId: () => string | null;
}

export async function handleAgentList(ctx: AgentHandlerContext): Promise<AgentListResult> {
  await initializeRegistry();
  const agents = listAgents();

  return {
    agents: agents.map((agent: AgentDefinition): AgentInfo => ({
      identity: agent.identity,
      name: agent.name,
      shortName: agent.shortName,
      description: agent.description,
      protocol: agent.protocol,
      type: agent.type,
      active: agent.active !== false,
    })),
    currentAgent: ctx.getCurrentAgentId(),
  };
}

export async function handleAgentSelect(
  params: AgentSelectParams,
  ctx: AgentHandlerContext
): Promise<AgentSelectResult> {
  const { agentId } = params;
  const currentAgentId = ctx.getCurrentAgentId();

  // Check if there's a running task
  if (ctx.getRunningTaskId()) {
    return {
      success: false,
      agentId: currentAgentId,
      message: "Cannot switch agents while a task is running",
    };
  }

  // Look up agent in registry
  await initializeRegistry();
  const agent = getAgent(agentId);

  if (!agent) {
    return {
      success: false,
      agentId: currentAgentId,
      message: `Unknown agent: ${agentId}`,
    };
  }

  if (agent.active === false) {
    return {
      success: false,
      agentId: currentAgentId,
      message: `Agent is inactive: ${agentId}`,
    };
  }

  ctx.setCurrentAgentId(agent.identity);
  logStream.info("[agent-handler] Agent selected", { agentId: agent.identity, protocol: agent.protocol });

  return {
    success: true,
    agentId: agent.identity,
  };
}

export function handleAgentStatus(ctx: AgentHandlerContext): AgentStatusResult {
  const currentAgentId = ctx.getCurrentAgentId();
  const agent = getAgent(currentAgentId);

  return {
    currentAgent: currentAgentId,
    isRunning: ctx.getRunningTaskId() !== null,
    protocol: agent?.protocol || "acp",
  };
}
