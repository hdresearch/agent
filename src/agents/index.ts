// Agent module exports
// Provides multi-agent ACP subprocess support

// Types
export type {
  OS,
  AgentProtocol,
  AgentType,
  AgentDefinition,
  AgentAction,
  AgentRunner,
  SubprocessState,
  PendingRequest,
  RequestHandler,
  ResponseHandler,
  // ACP types
  AcpClientCapabilities,
  AcpAgentCapabilities,
  AcpImplementation,
  AcpAuthMethod,
  AcpInitializeParams,
  AcpInitializeResult,
  AcpMcpServer,
  AcpSessionNewParams,
  AcpSessionNewResult,
  AcpSessionMode,
  AcpSessionModeState,
  AcpContentBlock,
  AcpTextContent,
  AcpImageContent,
  AcpEmbeddedResourceContent,
  AcpSessionPromptParams,
  AcpSessionPromptResult,
  AcpStopReason,
  AcpSessionUpdate,
  AcpSessionUpdateType,
  AcpAgentMessageChunk,
  AcpAgentThoughtChunk,
  AcpToolCall,
  AcpToolCallUpdate,
  AcpToolKind,
  AcpToolCallStatus,
  AcpToolCallLocation,
  AcpToolCallContent,
  AcpPlan,
  AcpPlanEntry,
  AcpCurrentModeUpdate,
  AcpAvailableCommand,
  AcpAvailableCommandsUpdate,
  AcpPermissionOption,
  AcpPermissionOptionKind,
  AcpRequestPermissionParams,
  AcpRequestPermissionResult,
  AcpFsReadTextFileParams,
  AcpFsReadTextFileResult,
  AcpFsWriteTextFileParams,
  AcpTerminalCreateParams,
  AcpTerminalCreateResult,
  AcpTerminalOutputParams,
  AcpTerminalOutputResult,
  AcpTerminalKillParams,
  AcpTerminalWaitForExitParams,
  AcpTerminalWaitForExitResult,
  AcpTerminalReleaseParams,
  // Prompt types
  RunPromptOptions,
  PromptHandle,
  PromptEvent,
  PromptInitEvent,
  PromptTextDeltaEvent,
  PromptTextCompleteEvent,
  PromptToolUseEvent,
  PromptToolResultEvent,
  PromptThinkingEvent,
  PromptResultEvent,
  PromptErrorEvent,
  PromptCancelledEvent,
  PromptPermissionRequestEvent,
  ProcessedImage,
  PromptAttachment,
} from "./types";

export { getCurrentOS, getOSValue } from "./types";

// Registry
export {
  loadAgentRegistry,
  ensureRegistryLoaded,
  getAgent,
  listAgents,
  getRunCommand,
  getAgentEnv,
  getInstallAction,
  commandExists,
  installAgent,
  ensureAgentInstalled,
  registerAgent,
  unregisterAgent,
  clearRegistry,
  registerBuiltinAgents,
  initializeRegistry,
} from "./registry";

// Subprocess Manager
export { SubprocessManager, getSubprocessManager } from "./subprocess-manager";

// ACP Client
export { AcpClient, createContentBlocks } from "./acp-client";

// ACP Server
export { AcpServer } from "./acp-server";
export type { SessionUpdateHandler, PermissionHandler } from "./acp-server";

// Agent Runners
export {
  SubprocessAgentRunner,
  createAgentRunner,
} from "./agent-runner";
export type { AgentRunnerOptions } from "./agent-runner";
