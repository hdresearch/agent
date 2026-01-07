// ACP (Agent Client Protocol) type definitions
// Based on https://agentclientprotocol.com/

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
  | "cancelled";

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
  | CancelledData;

export interface ContentChunkData {
  type: "content_chunk";
  text: string;
  final?: boolean;
}

export interface ToolCallData {
  type: "tool_call";
  toolId: string;
  toolName: string;
  input: Record<string, unknown>;
}

export interface ToolResultData {
  type: "tool_result";
  toolId: string;
  success: boolean;
  output?: unknown;
  error?: string;
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

// ============================================================
// ACP Method Names
// ============================================================

export const AcpMethod = {
  // Client → Agent
  Initialize: "initialize",
  Authenticate: "authenticate",
  SessionNew: "session/new",
  SessionLoad: "session/load",
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
