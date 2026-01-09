// Agent registry and subprocess types for multi-agent ACP support
// Based on Toad's agent architecture

import type { JsonRpcRequest, JsonRpcResponse, JsonRpcNotification } from "../protocol/jsonrpc";
import type { AvailableCommandData } from "../protocol/acp-types";

// ============================================================
// OS and Platform Types
// ============================================================

export type OS = "macos" | "linux" | "windows" | "*";

export function getCurrentOS(): OS {
  switch (process.platform) {
    case "darwin":
      return "macos";
    case "linux":
      return "linux";
    case "win32":
      return "windows";
    default:
      return "*";
  }
}

export function getOSValue<T>(osMap: Record<string, T>): T | undefined {
  const os = getCurrentOS();
  return osMap[os] ?? osMap["*"];
}

// ============================================================
// Agent Registry Types
// ============================================================

export type AgentProtocol = "acp" | "claude-sdk";
export type AgentType = "coding" | "chat";

export interface AgentAction {
  command: string;
  description: string;
}

export interface AgentDefinition {
  identity: string; // e.g., "claude.com"
  name: string; // e.g., "Claude Code"
  shortName: string; // e.g., "claude"
  url: string;
  protocol: AgentProtocol;
  type: AgentType;
  authorName: string;
  authorUrl: string;
  publisherName: string;
  publisherUrl: string;
  description: string;
  tags: string[];
  help?: string;
  welcome?: string;
  runCommand: Record<string, string>; // OS -> command
  envVars?: Record<string, string>; // Extra env vars to inject
  actions?: Record<string, Record<string, AgentAction>>; // OS -> action name -> action
  active?: boolean; // Default true
}

// ============================================================
// Subprocess State Types
// ============================================================

export interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
  timeoutMs: number;
  method: string;
}

export interface SubprocessState {
  process: ReturnType<typeof Bun.spawn>;
  agentId: string;
  sessionId: string | null;
  isReady: boolean;
  capabilities: AcpAgentCapabilities;
  pendingRequests: Map<number | string, PendingRequest>;
  requestId: number;
}

// ============================================================
// ACP Protocol Types (for subprocess communication)
// These match Toad's protocol.py types
// ============================================================

// Client capabilities we expose to agents
export interface AcpClientCapabilities {
  fs?: {
    readTextFile?: boolean;
    writeTextFile?: boolean;
  };
  terminal?: boolean;
}

// Agent capabilities received during initialize
export interface AcpAgentCapabilities {
  loadSession?: boolean;
  promptCapabilities?: {
    audio?: boolean;
    embeddedContent?: boolean;
    image?: boolean;
  };
}

export interface AcpImplementation {
  name: string;
  version: string;
  title?: string;
}

export interface AcpAuthMethod {
  id: string;
  name: string;
  description?: string;
}

// ============================================================
// ACP Initialize
// ============================================================

export interface AcpInitializeParams {
  protocolVersion: number;
  clientCapabilities: AcpClientCapabilities;
  clientInfo: AcpImplementation;
}

export interface AcpInitializeResult {
  protocolVersion: number;
  agentCapabilities?: AcpAgentCapabilities;
  authMethods?: AcpAuthMethod[];
}

// ============================================================
// ACP Session Types
// ============================================================

export interface AcpMcpServer {
  name: string;
  command: string;
  args?: string[];
  env?: Array<{ name: string; value: string }>;
}

export interface AcpSessionNewParams {
  cwd: string;
  mcpServers?: AcpMcpServer[];
}

export interface AcpSessionMode {
  id: string;
  name: string;
  description?: string;
}

export interface AcpSessionModeState {
  currentModeId: string;
  availableModes: AcpSessionMode[];
}

export interface AcpSessionNewResult {
  sessionId: string;
  modes?: AcpSessionModeState;
}

// ============================================================
// ACP Content Types
// ============================================================

export interface AcpTextContent {
  type: "text";
  text: string;
}

export interface AcpImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

export interface AcpEmbeddedResourceContent {
  type: "embedded_resource";
  resource: {
    uri: string;
    text?: string;
    blob?: string;
    mimeType?: string;
  };
}

export type AcpContentBlock =
  | AcpTextContent
  | AcpImageContent
  | AcpEmbeddedResourceContent;

// ============================================================
// ACP Prompt Types
// ============================================================

export interface AcpSessionPromptParams {
  sessionId: string;
  prompt: AcpContentBlock[];
}

export type AcpStopReason =
  | "end_turn"
  | "max_tokens"
  | "max_turn_requests"
  | "refusal"
  | "cancelled";

export interface AcpSessionPromptResult {
  stopReason: AcpStopReason;
}

// ============================================================
// ACP Session Update Types (Agent → Client notifications)
// ============================================================

export type AcpSessionUpdateType =
  | "user_message_chunk"
  | "agent_message_chunk"
  | "agent_thought_chunk"
  | "tool_call"
  | "tool_call_update"
  | "plan"
  | "available_commands_update"
  | "current_mode_update";

export interface AcpAgentMessageChunk {
  sessionUpdate: "agent_message_chunk";
  content: AcpContentBlock;
}

export interface AcpAgentThoughtChunk {
  sessionUpdate: "agent_thought_chunk";
  content: AcpContentBlock;
}

export type AcpToolKind =
  | "read"
  | "edit"
  | "delete"
  | "move"
  | "search"
  | "execute"
  | "think"
  | "fetch"
  | "switch_mode"
  | "other";

export type AcpToolCallStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed";

export interface AcpToolCallLocation {
  path: string;
  line?: number;
}

export interface AcpToolCallContentDiff {
  type: "diff";
  path: string;
  oldText?: string;
  newText: string;
}

export interface AcpToolCallContentTerminal {
  type: "terminal";
  terminalId: string;
}

export interface AcpToolCallContentContent {
  type: "content";
  content: AcpContentBlock;
}

export type AcpToolCallContent =
  | AcpToolCallContentDiff
  | AcpToolCallContentTerminal
  | AcpToolCallContentContent;

export interface AcpToolCall {
  sessionUpdate: "tool_call";
  toolCallId: string;
  title: string;
  kind?: AcpToolKind;
  status?: AcpToolCallStatus;
  locations?: AcpToolCallLocation[];
  content?: AcpToolCallContent[];
  rawInput?: Record<string, unknown>;
  rawOutput?: Record<string, unknown>;
}

export interface AcpToolCallUpdate {
  sessionUpdate: "tool_call_update";
  toolCallId: string;
  title?: string;
  kind?: AcpToolKind;
  status?: AcpToolCallStatus;
  locations?: AcpToolCallLocation[];
  content?: AcpToolCallContent[];
  rawInput?: Record<string, unknown>;
  rawOutput?: Record<string, unknown>;
}

export interface AcpPlanEntry {
  content: string;
  status: "pending" | "in_progress" | "completed";
  priority?: "high" | "medium" | "low";
}

export interface AcpPlan {
  sessionUpdate: "plan";
  entries: AcpPlanEntry[];
}

export interface AcpCurrentModeUpdate {
  sessionUpdate: "current_mode_update";
  currentModeId: string;
}

export interface AcpAvailableCommand {
  name: string;
  description: string;
  input?: { hint: string };
}

export interface AcpAvailableCommandsUpdate {
  sessionUpdate: "available_commands_update";
  availableCommands: AcpAvailableCommand[];
}

export type AcpSessionUpdate =
  | AcpAgentMessageChunk
  | AcpAgentThoughtChunk
  | AcpToolCall
  | AcpToolCallUpdate
  | AcpPlan
  | AcpCurrentModeUpdate
  | AcpAvailableCommandsUpdate;

// ============================================================
// ACP Permission Types
// ============================================================

export type AcpPermissionOptionKind =
  | "allow_once"
  | "allow_always"
  | "reject_once"
  | "reject_always";

export interface AcpPermissionOption {
  optionId: string;
  kind: AcpPermissionOptionKind;
  name: string;
}

export interface AcpToolCallForPermission {
  toolCallId: string;
  title?: string;
  kind?: AcpToolKind;
  status?: AcpToolCallStatus;
  locations?: AcpToolCallLocation[];
  content?: AcpToolCallContent[];
  rawInput?: Record<string, unknown>;
}

export interface AcpRequestPermissionParams {
  sessionId: string;
  options: AcpPermissionOption[];
  toolCall: AcpToolCallForPermission;
}

export interface AcpRequestPermissionResult {
  outcome:
    | { outcome: "selected"; optionId: string }
    | { outcome: "cancelled" };
}

// ============================================================
// ACP File System Types (Agent → Client)
// ============================================================

export interface AcpFsReadTextFileParams {
  sessionId: string;
  path: string;
  line?: number;
  limit?: number;
}

export interface AcpFsReadTextFileResult {
  content: string;
}

export interface AcpFsWriteTextFileParams {
  sessionId: string;
  path: string;
  content: string;
}

// ============================================================
// ACP Terminal Types (Agent → Client)
// ============================================================

export interface AcpEnvVariable {
  name: string;
  value: string;
}

export interface AcpTerminalCreateParams {
  sessionId?: string;
  command: string;
  args?: string[];
  cwd?: string;
  env?: AcpEnvVariable[];
  outputByteLimit?: number;
}

export interface AcpTerminalCreateResult {
  terminalId: string;
}

export interface AcpTerminalOutputParams {
  sessionId: string;
  terminalId: string;
}

export interface AcpTerminalExitStatus {
  exitCode?: number;
  signal?: string;
}

export interface AcpTerminalOutputResult {
  output: string;
  truncated: boolean;
  exitStatus?: AcpTerminalExitStatus;
}

export interface AcpTerminalKillParams {
  sessionId: string;
  terminalId: string;
}

export interface AcpTerminalWaitForExitParams {
  sessionId: string;
  terminalId: string;
}

export interface AcpTerminalWaitForExitResult {
  exitCode: number;
  signal?: string;
}

export interface AcpTerminalReleaseParams {
  sessionId: string;
  terminalId: string;
}

// ============================================================
// Agent Runner Types
// ============================================================

export interface RunPromptOptions {
  prompt: string;
  sessionId?: string;
  images?: ProcessedImage[];
  attachments?: PromptAttachment[];
}

export interface ProcessedImage {
  id: number;
  path: string;
  mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  base64: string;
  error?: string;
}

export interface PromptAttachment {
  type: "file" | "image" | "url";
  content: string;
  mimeType?: string;
}

export interface PromptHandle {
  events: AsyncIterable<PromptEvent>;
  cancel: () => Promise<void>;
  isRunning: () => boolean;
}

// Unified event types for agent runner (works with both SDK and subprocess)
export type PromptEvent =
  | PromptInitEvent
  | PromptTextDeltaEvent
  | PromptTextCompleteEvent
  | PromptToolUseEvent
  | PromptToolResultEvent
  | PromptThinkingEvent
  | PromptResultEvent
  | PromptErrorEvent
  | PromptCancelledEvent
  | PromptPermissionRequestEvent
  | PromptAvailableCommandsEvent;

export interface PromptInitEvent {
  type: "init";
  data: { sessionId: string; resumed: boolean };
}

export interface PromptTextDeltaEvent {
  type: "text_delta";
  data: { text: string };
}

export interface PromptTextCompleteEvent {
  type: "text_complete";
  data: { text: string };
}

export interface PromptToolUseEvent {
  type: "tool_use";
  data: {
    toolCallId: string;
    name: string;
    input: Record<string, unknown>;
    title?: string;
    kind?: AcpToolKind;
    status?: AcpToolCallStatus;
    locations?: AcpToolCallLocation[];
    content?: AcpToolCallContent[];
  };
}

export interface PromptToolResultEvent {
  type: "tool_result";
  data: {
    toolCallId: string;
    status: AcpToolCallStatus;
    content?: unknown;
    locations?: AcpToolCallLocation[];
    richContent?: AcpToolCallContent[];
  };
}

export interface PromptThinkingEvent {
  type: "thinking";
  data: { thinking: string };
}

export interface PromptResultEvent {
  type: "result";
  data: {
    success: boolean;
    stopReason?: AcpStopReason;
    durationMs?: number;
    totalCostUsd?: number;
    numTurns?: number;
    inputTokens?: number;
    outputTokens?: number;
  };
}

export interface PromptErrorEvent {
  type: "error";
  data: { message: string; isAgentOutput?: boolean };
}

export interface PromptCancelledEvent {
  type: "cancelled";
  data: Record<string, never>;
}

export interface PromptPermissionRequestEvent {
  type: "permission_request";
  data: {
    requestId: string;
    toolCall: {
      toolCallId: string;
      title?: string;
      kind?: AcpToolKind;
      status?: AcpToolCallStatus;
      locations?: AcpToolCallLocation[];
      content?: AcpToolCallContent[];
    };
    options: Array<{
      optionId: string;
      kind: AcpPermissionOptionKind;
      name: string;
    }>;
  };
}

export interface PromptAvailableCommandsEvent {
  type: "available_commands";
  data: {
    commands: AcpAvailableCommand[];
  };
}

// ============================================================
// Agent Runner Interface
// ============================================================

export interface AgentRunner {
  readonly agentId: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  runPrompt(options: RunPromptOptions): PromptHandle;
  isRunning(): boolean;
  // Get the agent's internal session ID (from ACP session/new)
  getSessionId(): string | null;
  // Get Claude CLI's actual session ID (8-char format from notifications)
  // This is the ID needed for session resume
  getClaudeSessionId?(): string | null;
  // Permission handling (optional - for ACP agents with interactive permissions)
  respondToPermission?(requestId: string, optionId: string): boolean;
  cancelPermission?(requestId: string): boolean;
  // Command handling (optional - for agents that expose slash commands)
  getAvailableCommands?(): AvailableCommandData[];
  onCommandsUpdated?(callback: ((commands: AvailableCommandData[]) => void) | null): void;
  // Stderr output handling (optional - for capturing agent command output)
  onStderr?(callback: ((text: string) => void) | null): void;
  // Session ID update handling (optional - for agents that send session ID in notifications)
  onSessionIdUpdated?(callback: ((sessionId: string) => void) | null): void;
}

// ============================================================
// Subprocess Manager Callback Types
// ============================================================

export type RequestHandler = (
  agentId: string,
  request: JsonRpcRequest
) => Promise<unknown>;

export type ResponseHandler = (
  agentId: string,
  response: JsonRpcResponse
) => void;

export type NotificationHandler = (
  agentId: string,
  notification: JsonRpcNotification
) => void;
