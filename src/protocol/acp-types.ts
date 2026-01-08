// ACP (Agent Client Protocol) type definitions
// Based on https://agentclientprotocol.com/

// ============================================================
// Client/Agent Configuration
// ============================================================

export interface AcpClientInfo {
  name: string;
  version: string;
}

export interface AcpAgentConfig {
  clientInfo: AcpClientInfo;
  capabilities: ClientCapabilities;
  defaultModel?: string;
  authMethods?: string[];
}

// Default config for agents that don't specify their own
export const DEFAULT_ACP_CONFIG: AcpAgentConfig = {
  clientInfo: { name: "vers-agent", version: "0.1.0" },
  capabilities: {
    fileSystem: { read: true, write: true },
    terminal: { create: true },
  },
};

// ============================================================
// Capabilities
// ============================================================

export interface ClientCapabilities {
  fileSystem?: FileSystemCapability;
  terminal?: TerminalCapability;
  session?: SessionCapability;
  mcp?: McpCapability;
}

export interface AgentCapabilities {
  fileSystem?: FileSystemCapability;
  terminal?: TerminalCapability;
  session?: SessionCapability;
  mcp?: McpCapability;
}

export interface FileSystemCapability {
  read?: boolean;
  write?: boolean;
}

export interface TerminalCapability {
  create?: boolean;
  interactive?: boolean;
}

export interface SessionCapability {
  modes?: string[];
  streaming?: boolean;
}

export interface McpCapability {
  tools?: boolean;
}

// ============================================================
// Initialize
// ============================================================

export interface InitializeParams {
  clientInfo?: {
    name: string;
    version?: string;
  };
  capabilities?: ClientCapabilities;
}

export interface InitializeResult {
  agentInfo: {
    name: string;
    version?: string;
  };
  capabilities: AgentCapabilities;
}

// ============================================================
// Authentication
// ============================================================

export interface AuthenticateParams {
  method: "api_key" | "token";
  credentials: Record<string, string>;
}

export interface AuthenticateResult {
  success: boolean;
  userId?: string;
}

// ============================================================
// Session Management
// ============================================================

export interface NewSessionParams {
  workingDirectory?: string;
  systemPrompt?: string;
  config?: SessionConfig;
}

export interface NewSessionResult {
  sessionId: string;
}

export interface LoadSessionParams {
  sessionId: string;
}

export interface LoadSessionResult {
  sessionId: string;
  resumed: boolean;
}

// Session info for listing
export interface SessionInfo {
  id: string;
  name?: string;
  createdAt: string;
  lastUsedAt: string;
  turns: number;
  totalCost: number;
  mode: "default" | "plan";
}

export interface ListSessionsResult {
  sessions: SessionInfo[];
  currentSessionId: string | null;
}

// Session output sync
export interface SessionOutput {
  seq: number;
  type: string;
  content: string;
  color?: string;
  toolName?: string;
}

export interface SessionSyncInfo {
  sessionId: string;
  count: number;
  lastSeq: number;
}

export interface GetSessionOutputsParams {
  sessionId?: string;  // defaults to current session
  afterSeq?: number;   // for incremental sync
}

export interface GetSessionOutputsResult {
  sessionId: string;
  outputs: SessionOutput[];
  syncInfo: SessionSyncInfo;
}

export interface SessionConfig {
  model?: string;
  thinkingBudget?: number | null;
  maxTurns?: number;
  maxBudgetUsd?: number;
  allowedTools?: string[];
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions";
}

// ============================================================
// Prompt Execution
// ============================================================

export interface PromptParams {
  text: string;
  attachments?: Attachment[];
}

export interface PromptResult {
  success: boolean;
}

export interface Attachment {
  type: "file" | "image" | "url";
  content: string; // path, base64, or URL
  mimeType?: string;
}

// ============================================================
// Session Mode
// ============================================================

export type SessionMode = "default" | "plan" | "execute";

export interface SetModeParams {
  mode: SessionMode;
}

export interface SetModeResult {
  mode: SessionMode;
}

// ============================================================
// Cancel
// ============================================================

export interface CancelParams {
  reason?: string;
}

export interface CancelResult {
  cancelled: boolean;
}

// ============================================================
// File System (Agent → Client)
// ============================================================

export interface ReadTextFileParams {
  path: string;
  offset?: number;
  limit?: number;
}

export interface ReadTextFileResult {
  content: string;
  totalLines?: number;
}

export interface WriteTextFileParams {
  path: string;
  content: string;
  createDirectories?: boolean;
}

export interface WriteTextFileResult {
  bytesWritten: number;
}

// ============================================================
// Terminal (Agent → Client)
// ============================================================

export interface TerminalCreateParams {
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
}

export interface TerminalCreateResult {
  terminalId: string;
  pid?: number;
}

export interface TerminalOutputParams {
  terminalId: string;
}

export interface TerminalOutputResult {
  output: string;
  exitCode?: number;
  running: boolean;
}

export interface TerminalWaitParams {
  terminalId: string;
  timeout?: number;
}

export interface TerminalWaitResult {
  exitCode: number;
  output: string;
}

export interface TerminalKillParams {
  terminalId: string;
  signal?: string;
}

export interface TerminalKillResult {
  killed: boolean;
}

export interface TerminalReleaseParams {
  terminalId: string;
}

export interface TerminalReleaseResult {
  released: boolean;
}

// ============================================================
// Permission Request (Agent → Client)
// ============================================================

export interface RequestPermissionParams {
  operation: string;
  resource?: string;
  description?: string;
  options?: PermissionOption[];
}

export interface PermissionOption {
  id: string;
  label: string;
  description?: string;
}

export interface RequestPermissionResult {
  granted: boolean;
  selectedOption?: string;
  remember?: boolean;
}

// ============================================================
// Session Notifications (Agent → Client)
// ============================================================

export type SessionNotificationType =
  | "content_chunk"
  | "tool_call"
  | "tool_result"
  | "thinking"
  | "mode_update"
  | "plan_update"
  | "cost_update"
  | "completed"
  | "failed"
  | "cancelled"
  | "permission_request"
  | "available_commands";

export interface SessionNotificationParams {
  sessionId: string;
  type: SessionNotificationType;
  data: SessionNotificationData;
}

export type SessionNotificationData =
  | ContentChunkData
  | ToolCallData
  | ToolResultData
  | ThinkingData
  | ModeUpdateData
  | PlanUpdateData
  | CostUpdateData
  | CompletedData
  | FailedData
  | CancelledData
  | PermissionRequestData
  | AvailableCommandsData;

export interface ContentChunkData {
  type: "content_chunk";
  text: string;
  final?: boolean;
}

export interface ToolCallData {
  type: "tool_call";
  toolId: string;
  toolCallId?: string;  // Alias for toolId for compatibility
  toolName: string;
  input: Record<string, unknown>;
  // Rich display fields
  title?: string;       // Human-readable title like "Read(file.ts)"
  kind?: string;        // Tool category: read, edit, search, execute, etc.
  status?: string;      // Status: pending, in_progress, completed, failed
  locations?: Array<{ path?: string; file?: string; line?: number; endLine?: number }>;  // File locations
  content?: Array<{ type: string; text?: string; data?: string }> | unknown[];  // Rich content
}

export interface ToolResultData {
  type: "tool_result";
  toolId: string;
  toolCallId?: string;  // Alias for toolId for compatibility
  success: boolean;
  output?: unknown;
  error?: string;
  status?: string;      // Status string: completed, failed, etc.
  content?: string;     // Result content preview
}

export interface ThinkingData {
  type: "thinking";
  text: string;
}

export interface ModeUpdateData {
  type: "mode_update";
  mode: SessionMode;
}

export interface PlanUpdateData {
  type: "plan_update";
  entries: PlanEntry[];
}

export interface PlanEntry {
  id: string;
  description: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  priority?: number;
}

export interface CostUpdateData {
  type: "cost_update";
  totalCostUsd: number;
  inputTokens: number;
  outputTokens: number;
}

export interface CompletedData {
  type: "completed";
  durationMs: number;
  totalCostUsd: number;
  numTurns: number;
  inputTokens: number;
  outputTokens: number;
}

export interface FailedData {
  type: "failed";
  error: string;
}

export interface CancelledData {
  type: "cancelled";
  reason?: string;
}

export interface PermissionRequestData {
  type: "permission_request";
  requestId: string;
  toolCall: {
    toolCallId: string;
    title?: string;
    kind?: string;
    status?: string;
    locations?: Array<{ path: string; line?: number }>;
    content?: unknown[];
  };
  options: Array<{
    optionId: string;
    kind: string;
    name: string;
  }>;
}

export interface AvailableCommandData {
  name: string;
  description: string;
  input?: { hint: string };
}

export interface AvailableCommandsData {
  type: "available_commands";
  commands: AvailableCommandData[];
}

// ============================================================
// ACP Method Names
// ============================================================

export const AcpMethod = {
  // Client → Agent
  Initialize: "initialize",
  Authenticate: "authenticate",
  SessionNew: "session/new",
  SessionLoad: "session/load",
  SessionList: "session/list",
  SessionOutputs: "session/outputs",
  SessionSync: "session/sync",
  SessionPrompt: "session/prompt",
  SessionCancel: "session/cancel",
  SessionSetMode: "session/set_mode",
  SessionReloadDocs: "session/reload_docs",
  SessionGetDocs: "session/get_docs",
  SessionSetDocs: "session/set_docs",

  // File system (bidirectional - client can request from agent for remote access)
  FsReadTextFile: "fs/read_text_file",
  FsWriteTextFile: "fs/write_text_file",
  FsListDirectory: "fs/list_directory",
  RequestPermission: "session/request_permission",
  TerminalCreate: "terminal/create",
  TerminalOutput: "terminal/output",
  TerminalWait: "terminal/wait_for_exit",
  TerminalKill: "terminal/kill",
  TerminalRelease: "terminal/release",

  // Notifications (Agent → Client)
  SessionNotification: "session/notification",

  // MCP Server Management
  McpList: "mcp/list",
  McpAdd: "mcp/add",
  McpRemove: "mcp/remove",

  // Plan Management
  SessionGetMode: "session/get_mode",
  SessionGetPlan: "session/get_plan",
  SessionSetPlan: "session/set_plan",
  SessionClearPlan: "session/clear_plan",

  // Queue Management
  QueueEnqueue: "queue/enqueue",
  QueueDequeue: "queue/dequeue",
  QueuePeek: "queue/peek",
  QueueList: "queue/list",
  QueueRemove: "queue/remove",
  QueueClear: "queue/clear",

  // Bash Execution (for remote CLI)
  BashExecute: "bash/execute",
  GetCwd: "system/cwd",

  // Agent Management
  AgentList: "agent/list",
  AgentSelect: "agent/select",
  AgentStatus: "agent/status",

  // Permission Management
  PermissionRespond: "permission/respond",
  PermissionCancel: "permission/cancel",
} as const;

// ============================================================
// Queue Management Types
// ============================================================

export interface QueuedPromptInfo {
  id: string;
  text: string;
  attachments?: Attachment[];
  queuedAt: string;
  mode?: SessionMode;
}

export interface QueueEnqueueParams {
  text: string;
  attachments?: Attachment[];
  mode?: SessionMode;
}

export interface QueueEnqueueResult {
  id: string;
  position: number;
}

export interface QueueDequeueResult {
  prompt: QueuedPromptInfo | null;
  remaining: number;
}

export interface QueuePeekResult {
  prompt: QueuedPromptInfo | null;
  queueLength: number;
}

export interface QueueListResult {
  prompts: QueuedPromptInfo[];
  processing: boolean;
}

export interface QueueRemoveParams {
  ids: string[];
}

export interface QueueRemoveResult {
  removed: number;
  remaining: number;
}

export interface QueueClearResult {
  cleared: number;
}

// ============================================================
// Bash Execution (Client → Agent for remote execution)
// ============================================================

export interface BashExecuteParams {
  command: string;
  cwd?: string;
  timeout?: number;
}

export interface BashExecuteResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface GetCwdResult {
  cwd: string;
}

// ============================================================
// Agent Management Types
// ============================================================

export interface AgentInfo {
  identity: string;
  name: string;
  shortName: string;
  description: string;
  protocol: "acp" | "claude-sdk";
  type: "coding" | "chat";
  active: boolean;
}

export interface AgentListResult {
  agents: AgentInfo[];
  currentAgent: string | null;
}

export interface AgentSelectParams {
  agentId: string;
}

export interface AgentSelectResult {
  success: boolean;
  agentId: string;
  message?: string;
}

export interface AgentStatusResult {
  currentAgent: string | null;
  isRunning: boolean;
  protocol: "acp" | "claude-sdk" | null;
}
