// Agent - DEPRECATED
// This file previously contained the Claude Agent SDK integration.
// All functionality has been moved to agent-manager.ts which uses ACP subprocess mode.
//
// This file is kept only for backwards compatibility and re-exports from agent-manager.

export {
  runTask,
  cancelTask,
  isTaskRunning,
  initializeAgent,
  stopAgent,
  selectAgent,
  getCurrentAgentId,
  isAgentRunning,
  listAgents,
  clearProjectDocsCache,
  markDocsForReinjection,
} from "./agent-manager";
