// HTTP + SSE server for ACP
// POST /rpc - JSON-RPC requests
// GET /events - SSE stream for notifications

import {
  type JsonRpcRequest,
  type JsonRpcResponse,
  createResponse,
  createErrorResponse,
  ErrorCode,
  parseMessage,
} from "../protocol/jsonrpc";
import {
  AcpMethod,
  type InitializeParams,
  type InitializeResult,
  type AuthenticateParams,
  type AuthenticateResult,
  type NewSessionParams,
  type LoadSessionParams,
  type PromptParams,
  type SetModeParams,
  type CancelParams,
  type SessionNotificationParams,
  type AgentCapabilities,
  type QueueEnqueueParams,
  type QueueRemoveParams,
  type GetSessionOutputsParams,
  type AgentSelectParams,
  type SkillGetParams,
  type SkillSaveParams,
  type SkillDeleteParams,
  type SkillInvokeParams,
  type VmCreateParams,
  type VmBranchParams,
  type VmDeleteParams,
  type VmConnectParams,
  type VmRunParams,
  type VmExecuteParams,
  type VmUploadParams,
  type VmEventsParams,
  type VmOutputsParams,
  type VmOutputsAllParams,
  type VmWaitParams,
  type VmEvalParams,
} from "../protocol/acp-types";
import {
  subscribeToVmEvents,
  getConnectionStatus,
} from "./vm-event-aggregator";
import {
  initializeRegistry,
  getAgent,
} from "../agents";
import { promptQueue, type QueuedPrompt } from "../core/prompt-queue";
import {
  runTask,
  getCurrentAgentId,
  setCurrentAgentId,
  getAgentCommands,
  onAgentCommandsUpdated,
  onAgentStderr,
  onAgentSessionIdUpdated,
} from "../core/agent-manager";
import { taskStore } from "../core/tasks";
import { sessionManager } from "../core/session-manager";
import { getConfig, setSessionMode, setPlan, type PlanEntry } from "../utils/config";
import { sessionStore, sessionOutputStore } from "../utils/session-store";
import { saveKeys, computeKeysHash, type KeysState } from "../utils/keys";
import { expandPrompt, hasPathReferences } from "../utils/path-expansion";
import { metrics, MetricNames } from "../utils/metrics";
import { logStream, shouldIncludeLevel, type LogLevel } from "../utils/log-stream";
import { authStore, hasAuth, verifyApiKey, setVersApiKey, getVersApiKey } from "../utils/auth-store";
import { cleanTitle } from "../utils/string-utils";
import {
  serverState,
  setInitialized,
  getCurrentSessionId,
  setCurrentSessionId,
  getRunningTaskId,
  setRunningTaskId,
  appendAssistantText,
  getAccumulatedAssistantText,
  resetAccumulatedAssistantText,
  getCurrentVmId,
  setCurrentVmId,
  getCurrentVmAgentUrl,
  setCurrentVmAgentUrl,
  clearVmConnection,
} from "./server-state";

// Extracted handlers
import {
  handleQueueEnqueue,
  handleQueueDequeue,
  handleQueuePeek,
  handleQueueList,
  handleQueueRemove,
  handleQueueClear,
  handleFsReadTextFile,
  handleFsListDirectory,
  handlePermissionRespond,
  handlePermissionCancel,
  handleBashExecute,
  handleGetCwd,
  handleAgentList,
  handleAgentSelect,
  handleAgentStatus,
  type AgentHandlerContext,
  handleSkillList,
  handleSkillGet,
  handleSkillSave,
  handleSkillDelete,
  handleSkillInvoke,
  type SkillInvokeContext,
  handleConfigGet,
  handleConfigSet,
  handleMcpList,
  handleMcpAdd,
  handleMcpRemove,
  type ConfigSetParams,
  type McpAddParams,
  type McpRemoveParams,
  handleSessionReloadDocs,
  handleSessionGetDocs,
  handleSessionSetDocs,
  type SessionSetDocsParams,
  handleVmList,
  handleVmCreate,
  handleVmBranch,
  handleVmDelete,
  handleVmConnect,
  handleVmStatus,
  handleVmContext,
  handleVmRun,
  handleVmExecute,
  handleVmUpload,
  handleVmEvents,
  handleVmOutputs,
  handleVmWait,
  handleVmOutputsAll,
  handleVmEval,
  type VmHandlerContext,
  handleSessionList,
  handleSessionOutputs,
  handleSessionSync,
  handleSessionCancel,
  handleSessionGetMode,
  handleSessionSetMode,
  handleSessionGetPlan,
  handleSessionSetPlan,
  handleSessionClearPlan,
  handleSessionNew,
  handleSessionLoad,
  handleSessionPrompt,
  type SessionHandlerContext,
} from "./handlers";

// VM metadata sync - keep local cache in sync with Vers infrastructure
import { listVms } from "../vm/index";
import { loadMetadata, updateVmMetadata, removeVmMetadata, type VmMetadata } from "../orchestrator/index";

// SSE management
import { addSseClient, removeSseClient, broadcastEvent } from "./sse-manager";

const AGENT_INFO = {
  name: "vers-agent",
  version: "1.0.0",
};

// Logging via logStream (supports streaming to /logs endpoint)
function debug(message: string, data?: unknown): void {
  logStream.debug(message, data);
}

function info(message: string, data?: unknown): void {
  logStream.info(message, data);
}

function error(message: string, data?: unknown): void {
  logStream.error(message, data);
  metrics.incCounter(MetricNames.ERRORS_TOTAL);
}

// Authentication helpers
function getAuthToken(req: Request): string | null {
  // Check Authorization header (Bearer token)
  const authHeader = req.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }

  // Check X-Auth-Token header
  const tokenHeader = req.headers.get("X-Auth-Token");
  if (tokenHeader) {
    return tokenHeader;
  }

  // Check query parameter (for SSE connections)
  const url = new URL(req.url);
  const tokenParam = url.searchParams.get("token");
  if (tokenParam) {
    return tokenParam;
  }

  return null;
}

// Check if request is from localhost
function isLocalhostRequest(req: Request): boolean {
  // Check the Host header
  const host = req.headers.get("Host") || "";
  const hostLower = host.toLowerCase().split(":")[0]; // Remove port
  if (hostLower === "localhost" || hostLower === "127.0.0.1" || hostLower === "::1") {
    return true;
  }

  // Also check the URL
  try {
    const url = new URL(req.url);
    const urlHost = url.hostname.toLowerCase();
    return urlHost === "localhost" || urlHost === "127.0.0.1" || urlHost === "::1";
  } catch {
    return false;
  }
}

const AGENT_CAPABILITIES: AgentCapabilities = {
  session: {
    modes: ["default", "plan"],
    streaming: true,
  },
  fileSystem: {
    read: true,
    write: true,
  },
  terminal: {
    create: true,
    interactive: false,
  },
  mcp: {
    tools: true,
  },
};

// Server state (managed via ./server-state.ts)
const AUTO_PROCESS_QUEUE = true; // Auto-process queued prompts after task completion

// Process next queued prompt if available
async function processNextQueuedPrompt(): Promise<void> {
  if (!AUTO_PROCESS_QUEUE || getRunningTaskId() || promptQueue.isEmpty) {
    return;
  }

  const queued = promptQueue.dequeue();
  if (!queued) return;

  debug("Processing queued prompt", { text: queued.text.slice(0, 50) });

  // Notify that we're processing a queued command
  sendSessionNotification("queued_command", {
    type: "queued_command",
    promptId: queued.id,
    text: queued.text,
  });

  // Execute the queued prompt
  await executePrompt(queued.text, queued.attachments);
}

// Execute a prompt (extracted from handleSessionPrompt for reuse)
async function executePrompt(text: string, attachments?: import("../protocol/acp-types").Attachment[]): Promise<void> {
  info("executePrompt called", { textLength: text.length, hasAttachments: !!attachments?.length });
  debug("Prompt text:", text.slice(0, 200));

  // Log Claude Code executable path
  const claudeCodePath = process.env.CLAUDE_CODE_EXECUTABLE;
  info("Claude Code executable:", claudeCodePath || "(not set - will auto-detect)");

  // Expand @path references in the prompt
  let promptText = text;
  if (hasPathReferences(promptText)) {
    debug("Expanding @path references...");
    const { expandedPrompt, refs } = await expandPrompt(promptText);
    promptText = expandedPrompt;

    if (refs.length > 0) {
      info(`Expanded ${refs.length} @path reference(s)`);
    }
  }

  // Convert ACP attachments to TaskAttachments
  const taskAttachments = attachments?.map((a) => ({
    type: a.type,
    content: a.content,
    mimeType: a.mimeType,
  }));

  const task = taskStore.create(promptText, {}, taskAttachments);
  info("Task created", { taskId: task.id, status: task.status });
  setRunningTaskId(task.id);
  promptQueue.setProcessing(true);
  metrics.setGauge(MetricNames.RUNNING_TASKS, 1);

  // Subscribe to task events and broadcast via SSE
  const unsubscribe = taskStore.subscribe(task.id, (event) => {
    debug("Task event", { type: event.type, data: event.data });
    sendSessionNotification(event.type, event.data);

    if (event.type === "completed" || event.type === "failed" || event.type === "cancelled") {
      info("Task finished", { taskId: task.id, status: event.type });
      setRunningTaskId(null);
      promptQueue.setProcessing(false);
      metrics.setGauge(MetricNames.RUNNING_TASKS, 0);
      metrics.setGauge(MetricNames.QUEUE_LENGTH, promptQueue.length);

      // Process next queued prompt if available
      if (AUTO_PROCESS_QUEUE && !promptQueue.isEmpty) {
        // Use setImmediate to avoid blocking
        setTimeout(() => processNextQueuedPrompt(), 0);
      }
    }
  });

  // Start task execution (don't await)
  info("Starting task execution", { taskId: task.id });
  runTask(task.id).catch((err) => {
    error(`Task ${task.id} failed`, { error: err instanceof Error ? err.message : String(err) });
    setRunningTaskId(null);
    promptQueue.setProcessing(false);
    metrics.setGauge(MetricNames.RUNNING_TASKS, 0);
    unsubscribe();

    // Still try to process next queued prompt
    if (AUTO_PROCESS_QUEUE && !promptQueue.isEmpty) {
      setTimeout(() => processNextQueuedPrompt(), 0);
    }
  });
}

// SSE management has been extracted to ./sse-manager.ts

// Agent commands - delegate to agent-manager which gets them from the runner
import type { AvailableCommandData } from "../protocol/acp-types";

function getAvailableAgentCommands(): AvailableCommandData[] {
  return getAgentCommands() as AvailableCommandData[];
}

// Broadcast commands to all SSE clients when they update
function broadcastAgentCommands(commands: AvailableCommandData[]): void {
  broadcastEvent("notification", {
    type: "available_commands",
    data: { type: "available_commands", commands },
  });
}

// Map internal task events to ACP notification types
function mapEventToAcp(type: string, data: unknown): { type: string; data: unknown } | null {
  const d = data as Record<string, unknown>;

  switch (type) {
    case "started":
      return {
        type: "mode_update",
        data: { type: "mode_update", mode: "default" },
      };

    case "text_delta":
      return {
        type: "content_chunk",
        data: { type: "content_chunk", text: d.text || "", final: d.final === true },
      };

    case "assistant_message":
      return {
        type: "content_chunk",
        data: { type: "content_chunk", text: d.text || "", final: true },
      };

    case "tool_use": {
      // Use title, toolName, or toolCallId as fallback - never show "undefined"
      const toolDisplayName = cleanTitle(d.title) || cleanTitle(d.toolName) || cleanTitle(d.toolCallId) || "Tool";
      // Track tool call metrics
      metrics.incCounter(MetricNames.TOOL_CALLS_TOTAL, { tool: toolDisplayName });
      return {
        type: "tool_call",
        data: {
          type: "tool_call",
          toolId: d.toolCallId || `tool-${Date.now()}`,
          toolCallId: d.toolCallId || `tool-${Date.now()}`,
          toolName: toolDisplayName,
          input: (d.toolInput || {}) as Record<string, unknown>,
          // Rich ACP tool information
          title: toolDisplayName,
          kind: d.kind || "other",
          status: d.status || "in_progress",
          locations: d.locations,
          content: d.content,
        },
      };
    }

    case "tool_result":
      return {
        type: "tool_result",
        data: {
          type: "tool_result",
          toolId: d.toolCallId || d.toolUseId || `tool-${Date.now()}`,
          toolCallId: d.toolCallId || d.toolUseId,
          success: d.status === "completed" || d.status === undefined,
          status: d.status || "completed",
          output: d.content,
          content: d.content,
          locations: d.locations,
          richContent: d.richContent,
        },
      };

    case "completed":
      // Record completion stats in SQLite session store
      if (getCurrentSessionId()) {
        sessionStore.recordCompletion(getCurrentSessionId()!, (d.totalCostUsd as number) || 0);
      }
      // Track metrics
      metrics.incCounter(MetricNames.TOKENS_INPUT, undefined, (d.inputTokens as number) || 0);
      metrics.incCounter(MetricNames.TOKENS_OUTPUT, undefined, (d.outputTokens as number) || 0);
      metrics.incGauge(MetricNames.COST_USD, (d.totalCostUsd as number) || 0);
      metrics.observeHistogram(MetricNames.PROMPT_DURATION_MS, (d.durationMs as number) || 0);
      return {
        type: "completed",
        data: {
          type: "completed",
          durationMs: d.durationMs || 0,
          totalCostUsd: d.totalCostUsd || 0,
          numTurns: d.numTurns || 0,
          inputTokens: d.inputTokens || 0,
          outputTokens: d.outputTokens || 0,
        },
      };

    case "failed":
      return {
        type: "failed",
        data: { type: "failed", error: d.error || "Unknown error" },
      };

    case "cancelled":
      return {
        type: "cancelled",
        data: { type: "cancelled", reason: d.reason },
      };

    case "permission_request":
      return {
        type: "permission_request",
        data: {
          type: "permission_request",
          requestId: d.requestId,
          toolCall: d.toolCall,
          options: d.options,
        },
      };

    case "plan_update":
      // Plan update from agent - store in config and forward
      if (d.entries && Array.isArray(d.entries)) {
        setPlan(d.entries as PlanEntry[]);
      }
      return {
        type: "plan_update",
        data: { type: "plan_update", entries: d.entries || [] },
      };

    case "mode_update":
      // Mode update from agent
      if (d.mode === "plan" || d.mode === "default") {
        setSessionMode(d.mode);
        // Persist mode to SQLite session store
        if (getCurrentSessionId()) {
          sessionStore.setMode(getCurrentSessionId()!, d.mode);
        }
      }
      return {
        type: "mode_update",
        data: { type: "mode_update", mode: d.mode },
      };

    case "available_commands":
      // Available commands from agent - forward to clients
      // (commands are stored in the runner, accessed via getAgentCommands)
      return {
        type: "available_commands",
        data: { type: "available_commands", commands: d.commands || [] },
      };

    default:
      return { type, data };
  }
}

// Send session notification to all SSE clients
// Store output to SQLite and broadcast to SSE clients
function storeAndBroadcastOutput(
  outputType: string,
  content: string,
  extra?: { color?: string; toolName?: string }
): void {
  // Skip storing if content is null/undefined (defensive check)
  if (!content) {
    debug("[OUTPUT_STORE] Skipping empty content", { outputType });
    return;
  }
  const sessionId = getCurrentSessionId();
  if (sessionId) {
    sessionOutputStore.append(sessionId, {
      type: outputType,
      content,
      color: extra?.color,
      toolName: extra?.toolName,
    });
  }
}

function sendSessionNotification(type: string, data: unknown): void {
  const mapped = mapEventToAcp(type, data);
  if (!mapped) return;

  const notification: SessionNotificationParams = {
    sessionId: getCurrentSessionId() || "",
    type: mapped.type as SessionNotificationParams["type"],
    data: mapped.data as SessionNotificationParams["data"],
  };

  // Store certain notification types as outputs for history sync
  const d = data as Record<string, unknown>;
  debug("[OUTPUT_STORE] Event", { type, sessionId: getCurrentSessionId(), dataKeys: Object.keys(d) });

  if (getCurrentSessionId()) {
    switch (type) {
      case "text_delta":
        // Accumulate streaming text
        const deltaText = (d.text as string) || "";
        appendAssistantText(deltaText);
        // If this is the final chunk, store the accumulated text
        const accumulated = getAccumulatedAssistantText();
        if (d.final === true && accumulated) {
          debug("[OUTPUT_STORE] Storing accumulated text", { preview: accumulated.slice(0, 50), length: accumulated.length });
          storeAndBroadcastOutput("text", accumulated);
          resetAccumulatedAssistantText();
        }
        break;
      case "assistant_message":
        const textContent = (d.text as string) || "";
        debug("[OUTPUT_STORE] Storing assistant_message", { preview: textContent.slice(0, 50) });
        storeAndBroadcastOutput("text", textContent);
        break;
      case "started":
        // Reset accumulator when a new task starts
        resetAccumulatedAssistantText();
        break;
      case "tool_use":
        debug("[OUTPUT_STORE] Storing tool_use", { toolName: d.toolName });
        storeAndBroadcastOutput(
          "tool",
          JSON.stringify({ name: d.toolName, input: d.toolInput }),
          { toolName: d.toolName as string }
        );
        break;
      case "tool_result":
        debug("[OUTPUT_STORE] Storing tool_result");
        storeAndBroadcastOutput(
          "tool-result",
          typeof d.content === "string" ? d.content : (d.content !== undefined ? JSON.stringify(d.content) : ""),
          { toolName: d.toolUseId as string }
        );
        break;
    }
  } else {
    logStream.warn("[OUTPUT_STORE] No currentSessionId, skipping storage", { type });
  }

  broadcastEvent("notification", notification);
}

// JSON-RPC method handlers
async function handleInitialize(params: InitializeParams): Promise<InitializeResult> {
  info("Server initialized");
  setInitialized(true);

  // Initialize agent registry and set default agent from config
  await initializeRegistry();
  const config = getConfig();
  if (config.defaultAgent && config.defaultAgent !== getCurrentAgentId()) {
    const agent = getAgent(config.defaultAgent);
    if (agent) {
      setCurrentAgentId(agent.identity);
      info("Default agent loaded from config", { agentId: getCurrentAgentId() });
    }
  }

  return {
    agentInfo: AGENT_INFO,
    capabilities: AGENT_CAPABILITIES,
  };
}

// Auto-initialize if needed (for resilience after server restart)
async function ensureInitialized(): Promise<void> {
  if (!serverState.initialized) {
    info("Auto-initializing server (client reconnected after restart)");
    setInitialized(true);
    // Also load the agent registry
    await initializeRegistry();
    const config = getConfig();
    if (config.defaultAgent && config.defaultAgent !== getCurrentAgentId()) {
      const agent = getAgent(config.defaultAgent);
      if (agent) {
        setCurrentAgentId(agent.identity);
        info("Default agent loaded from config", { agentId: getCurrentAgentId() });
      }
    }
  }
}

async function handleAuthenticate(params: AuthenticateParams): Promise<AuthenticateResult> {
  if (params.method === "api_key" && params.credentials) {
    const state: KeysState = {
      keys: params.credentials,
      hash: computeKeysHash(params.credentials),
      detectedAt: new Date().toISOString(),
    };
    await saveKeys(state);

    if (params.credentials.ANTHROPIC_API_KEY) {
      process.env.ANTHROPIC_API_KEY = params.credentials.ANTHROPIC_API_KEY;
    }
  }

  return { success: true };
}

// Session, VM, file system, and agent handlers have been extracted to ./handlers/
// See: handlers/session.ts, handlers/filesystem.ts, handlers/agent.ts, handlers/vm.ts

// Handle incoming JSON-RPC request
async function handleRpcRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
  const { id, method, params } = request;

  debug("RPC request:", { id, method, paramsKeys: params ? Object.keys(params as object) : [] });

  // Context for agent handlers (provides access to module-level state)
  const agentHandlerContext: AgentHandlerContext = {
    getCurrentAgentId,
    setCurrentAgentId,
    getRunningTaskId,
  };

  // Context for session handlers
  const sessionHandlerContext: SessionHandlerContext = {
    getCurrentSessionId,
    setCurrentSessionId,
    getRunningTaskId,
    setRunningTaskId,
    sendSessionNotification,
    storeAndBroadcastOutput,
    executePrompt,
  };

  try {
    let result: unknown;

    switch (method) {
      case AcpMethod.Initialize:
        result = await handleInitialize(params as InitializeParams);
        break;

      case AcpMethod.Authenticate:
        result = await handleAuthenticate(params as AuthenticateParams);
        break;

      case AcpMethod.SessionNew:
        await ensureInitialized();
        result = await handleSessionNew(params as NewSessionParams, sessionHandlerContext);
        break;

      case AcpMethod.SessionLoad:
        await ensureInitialized();
        result = await handleSessionLoad(params as LoadSessionParams, sessionHandlerContext);
        break;

      case AcpMethod.SessionList:
        await ensureInitialized();
        result = await handleSessionList(sessionHandlerContext);
        break;

      case AcpMethod.SessionOutputs:
        await ensureInitialized();
        result = handleSessionOutputs(params as GetSessionOutputsParams, sessionHandlerContext);
        break;

      case AcpMethod.SessionSync:
        await ensureInitialized();
        result = handleSessionSync(params as { sessionId?: string }, sessionHandlerContext);
        break;

      case AcpMethod.SessionPrompt:
        await ensureInitialized();
        result = await handleSessionPrompt(
          params as PromptParams,
          sessionHandlerContext,
          (p) => handleSessionNew(p, sessionHandlerContext)
        );
        break;

      case AcpMethod.SessionCancel:
        await ensureInitialized();
        result = await handleSessionCancel(params as CancelParams, sessionHandlerContext);
        break;

      case AcpMethod.SessionSetMode:
        await ensureInitialized();
        result = await handleSessionSetMode(params as SetModeParams, sessionHandlerContext);
        break;

      case AcpMethod.SessionReloadDocs:
        await ensureInitialized();
        result = handleSessionReloadDocs();
        break;

      case AcpMethod.SessionGetDocs:
        await ensureInitialized();
        result = handleSessionGetDocs();
        break;

      case AcpMethod.SessionSetDocs:
        await ensureInitialized();
        result = await handleSessionSetDocs(params as SessionSetDocsParams);
        break;

      case AcpMethod.FsReadTextFile:
        // Read a file from the server's filesystem (for remote @path expansion)
        {
          const fsParams = params as { path: string; cwd?: string };
          if (!fsParams.path) {
            throw new Error("Missing path parameter");
          }
          result = await handleFsReadTextFile(fsParams.path, fsParams.cwd);
        }
        break;

      case AcpMethod.FsListDirectory:
        // List directory contents (for remote path autocomplete)
        {
          const fsParams = params as { path: string; cwd?: string };
          if (!fsParams.path) {
            throw new Error("Missing path parameter");
          }
          result = await handleFsListDirectory(fsParams.path, fsParams.cwd);
        }
        break;

      case AcpMethod.McpList:
        result = handleMcpList();
        break;

      case AcpMethod.McpAdd:
        result = await handleMcpAdd(params as McpAddParams);
        break;

      case AcpMethod.McpRemove:
        result = await handleMcpRemove(params as McpRemoveParams);
        break;

      case AcpMethod.SessionGetMode:
        result = handleSessionGetMode();
        break;

      case AcpMethod.SessionGetPlan:
        result = handleSessionGetPlan();
        break;

      case AcpMethod.SessionSetPlan:
        result = handleSessionSetPlan(params as { plan: import("../utils/config").PlanEntry[] }, sessionHandlerContext);
        break;

      case AcpMethod.SessionClearPlan:
        result = handleSessionClearPlan(sessionHandlerContext);
        break;

      // Queue Management (handlers extracted to ./handlers/queue.ts)
      case AcpMethod.QueueEnqueue:
        result = handleQueueEnqueue(params as QueueEnqueueParams);
        break;

      case AcpMethod.QueueDequeue:
        result = handleQueueDequeue();
        break;

      case AcpMethod.QueuePeek:
        result = handleQueuePeek();
        break;

      case AcpMethod.QueueList:
        result = handleQueueList();
        break;

      case AcpMethod.QueueRemove:
        result = handleQueueRemove(params as QueueRemoveParams);
        break;

      case AcpMethod.QueueClear:
        result = handleQueueClear();
        break;

      // Bash Execution (handlers extracted to ./handlers/bash.ts)
      case AcpMethod.BashExecute:
        result = await handleBashExecute(params as { command: string; cwd?: string; timeout?: number });
        break;

      case AcpMethod.GetCwd:
        result = handleGetCwd();
        break;

      // Agent Management (handlers extracted to ./handlers/agent.ts)
      case AcpMethod.AgentList:
        result = await handleAgentList(agentHandlerContext);
        break;

      case AcpMethod.AgentSelect:
        result = await handleAgentSelect(params as AgentSelectParams, agentHandlerContext);
        break;

      case AcpMethod.AgentStatus:
        result = handleAgentStatus(agentHandlerContext);
        break;

      // Permission Management (handlers extracted to ./handlers/permission.ts)
      case AcpMethod.PermissionRespond:
        result = handlePermissionRespond(params as { requestId: string; optionId: string });
        break;

      case AcpMethod.PermissionCancel:
        result = handlePermissionCancel(params as { requestId: string });
        break;

      // Skill Management
      case AcpMethod.SkillList:
        result = await handleSkillList();
        break;

      case AcpMethod.SkillGet:
        result = await handleSkillGet(params as SkillGetParams);
        break;

      case AcpMethod.SkillSave:
        result = await handleSkillSave(params as SkillSaveParams);
        break;

      case AcpMethod.SkillDelete:
        result = await handleSkillDelete(params as SkillDeleteParams);
        break;

      case AcpMethod.SkillInvoke: {
        const skillContext: SkillInvokeContext = {
          executeSessionPrompt: async (text: string) => {
            await handleSessionPrompt(
              { text },
              sessionHandlerContext,
              (p) => handleSessionNew(p, sessionHandlerContext)
            );
          },
        };
        result = await handleSkillInvoke(params as SkillInvokeParams, skillContext);
        break;
      }

      // VM Management (orchestrator)
      case AcpMethod.VmList: {
        const vmCtx: VmHandlerContext = {
          getCurrentVmId,
          setCurrentVmId,
          getCurrentVmAgentUrl,
          setCurrentVmAgentUrl,
          clearVmConnection,
        };
        result = await handleVmList(vmCtx);
        break;
      }

      case AcpMethod.VmCreate:
        result = await handleVmCreate(params as VmCreateParams);
        break;

      case AcpMethod.VmBranch:
        result = await handleVmBranch(params as VmBranchParams);
        break;

      case AcpMethod.VmDelete: {
        const vmCtx: VmHandlerContext = {
          getCurrentVmId,
          setCurrentVmId,
          getCurrentVmAgentUrl,
          setCurrentVmAgentUrl,
          clearVmConnection,
        };
        result = await handleVmDelete(params as VmDeleteParams, vmCtx);
        break;
      }

      case AcpMethod.VmConnect: {
        const vmCtx: VmHandlerContext = {
          getCurrentVmId,
          setCurrentVmId,
          getCurrentVmAgentUrl,
          setCurrentVmAgentUrl,
          clearVmConnection,
        };
        result = await handleVmConnect(params as VmConnectParams, vmCtx);
        break;
      }

      case AcpMethod.VmStatus: {
        const vmCtx: VmHandlerContext = {
          getCurrentVmId,
          setCurrentVmId,
          getCurrentVmAgentUrl,
          setCurrentVmAgentUrl,
          clearVmConnection,
        };
        result = handleVmStatus(vmCtx);
        break;
      }

      case AcpMethod.VmContext:
        result = await handleVmContext();
        break;

      case AcpMethod.VmRun:
        result = await handleVmRun(params as VmRunParams);
        break;

      case AcpMethod.VmExecute:
        result = await handleVmExecute(params as VmExecuteParams);
        break;

      case AcpMethod.VmUpload:
        result = await handleVmUpload(params as VmUploadParams);
        break;

      case AcpMethod.VmEvents:
        result = handleVmEvents(params as VmEventsParams);
        break;

      case AcpMethod.VmOutputs:
        result = await handleVmOutputs(params as VmOutputsParams);
        break;

      case AcpMethod.VmOutputsAll:
        result = await handleVmOutputsAll(params as VmOutputsAllParams);
        break;

      case AcpMethod.VmWait:
        result = await handleVmWait(params as VmWaitParams);
        break;

      case AcpMethod.VmEval:
        result = await handleVmEval(params as VmEvalParams);
        break;

      // Config Management
      case AcpMethod.ConfigGet:
        result = handleConfigGet();
        break;

      case AcpMethod.ConfigSet:
        result = await handleConfigSet(params as ConfigSetParams);
        break;

      default:
        return createErrorResponse(id, ErrorCode.MethodNotFound, `Unknown method: ${method}`);
    }

    return createResponse(id, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return createErrorResponse(id, ErrorCode.InternalError, message);
  }
}

// Try to create server on port, returns null if port is in use
function tryCreateServer(port: number): ReturnType<typeof Bun.serve> | null {
  try {
    return Bun.serve({
      port,
      idleTimeout: 255,
      async fetch(req) {
        return handleRequest(req);
      },
    });
  } catch (err: unknown) {
    // Check for EADDRINUSE error (port in use)
    const errWithCode = err as { code?: string };
    if (errWithCode.code === "EADDRINUSE") {
      return null;
    }
    // Also check message for broader compatibility
    if (err instanceof Error && err.message.includes("EADDRINUSE")) {
      return null;
    }
    throw err;
  }
}

// Route classification
// PUBLIC: Open to everyone (customers, public)
// PROTECTED: Requires VERS_API_KEY (engineers with full control)
const PUBLIC_ROUTES = new Set(["/", "/health"]);

// Shared request handler
async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);

  // CORS headers
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Auth-Token, X-Client-Id, X-Admin-Token",
  };

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const isLocal = isLocalhostRequest(req);
  const pathname = url.pathname;

  // === PUBLIC ROUTES (no auth required) ===
  if (PUBLIC_ROUTES.has(pathname)) {
    if (pathname === "/health") {
      const claimState = authStore.getClaimState();
      return Response.json({
        status: "ok",
        initialized: serverState.initialized,
        claimed: claimState.isClaimed,
      }, { headers: corsHeaders });
    }

    // Root endpoint
    if (pathname === "/") {
      return Response.json({
        service: "vers-agent",
        version: "0.1.0",
        endpoints: {
          public: ["/", "/health"],
          protected: ["/shell", "/rpc", "/events", "/claim", "/logs", "/metrics", "/commands", "/events/vms"],
        },
      }, { headers: corsHeaders });
    }
  }

  // === PROTECTED ROUTES (require VERS_API_KEY unless localhost) ===
  if (!PUBLIC_ROUTES.has(pathname)) {
    // Claim endpoint has special handling
    // Returns ClaimResponse: { claimed: boolean, isOwner: boolean, token?: string, error?: string }
    if (pathname === "/claim" && req.method === "POST") {
      const providedKey = getAuthToken(req);

      // If API key provided in auth header
      if (providedKey) {
        if (hasAuth()) {
          // Already have a key - verify it matches
          if (verifyApiKey(providedKey)) {
            return Response.json({
              claimed: true,
              isOwner: true,
              message: "API key verified",
            }, { headers: corsHeaders });
          }
          return Response.json({
            claimed: true,
            isOwner: false,
            error: "Invalid API key",
          }, { status: 403, headers: corsHeaders });
        }

        // No key yet - store this one
        await setVersApiKey(providedKey);
        info("VERS API key set via /claim endpoint");
        return Response.json({
          claimed: true,
          isOwner: true,
          message: "API key stored successfully",
        }, { headers: corsHeaders });
      }

      // No key provided - localhost gets automatic access regardless of auth config
      if (isLocal) {
        return Response.json({
          claimed: hasAuth(),
          isOwner: true,
          message: "Localhost access allowed without API key",
        }, { headers: corsHeaders });
      }

      // Remote access - check if auth is configured
      if (hasAuth()) {
        return Response.json({
          claimed: true,
          isOwner: false,
          error: "API key required. Provide via Authorization: Bearer <key>",
        }, { status: 401, headers: corsHeaders });
      }

      // Remote access without auth configured - deny
      return Response.json({
        claimed: false,
        isOwner: false,
        error: "API key required. Provide via Authorization: Bearer <key>",
      }, { status: 401, headers: corsHeaders });
    }

    // All protected routes require VERS_API_KEY (unless localhost)
    if (hasAuth() && !isLocal) {
      const providedKey = getAuthToken(req);
      if (!providedKey) {
        return Response.json({
          error: "Authentication required",
          message: "Provide API key via Authorization: Bearer <key>",
        }, { status: 401, headers: corsHeaders });
      }
      if (!verifyApiKey(providedKey)) {
        return Response.json({
          error: "Invalid API key",
          message: "The provided API key is invalid",
        }, { status: 403, headers: corsHeaders });
      }
    }
  }

  // JSON-RPC endpoint
  if (url.pathname === "/rpc" && req.method === "POST") {
    try {
      const body = await req.text();
      const message = parseMessage(body);

      if (!message || !("method" in message)) {
        return Response.json(
          createErrorResponse(null, ErrorCode.InvalidRequest, "Invalid JSON-RPC request"),
          { headers: corsHeaders }
        );
      }

      const response = await handleRpcRequest(message as JsonRpcRequest);
      return Response.json(response, { headers: corsHeaders });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return Response.json(
        createErrorResponse(null, ErrorCode.ParseError, message),
        { headers: corsHeaders }
      );
    }
  }

  // SSE endpoint for notifications
  if (url.pathname === "/events" && req.method === "GET") {
    let clientSend: ((event: string, data: unknown) => void) | null = null;

    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();

        // Send initial connection event
        controller.enqueue(encoder.encode("event: connected\ndata: {}\n\n"));

        // Register this client
        clientSend = (event: string, data: unknown) => {
          const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
          try {
            controller.enqueue(encoder.encode(payload));
          } catch {
            // Client disconnected
            if (clientSend) removeSseClient(clientSend);
          }
        };

        addSseClient(clientSend);
      },
      cancel() {
        // Client disconnected
        if (clientSend) removeSseClient(clientSend);
      },
    });

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  }

  // VM Events SSE endpoint - multiplexed stream from all managed VMs
  if (url.pathname === "/events/vms" && req.method === "GET") {
    // Parse optional vmIds filter from query params
    const vmIdsParam = url.searchParams.get("vmIds");
    const vmIds = vmIdsParam ? vmIdsParam.split(",").filter(Boolean) : undefined;
    const vmIdSet = vmIds ? new Set(vmIds) : null;

    let unsubscribe: (() => void) | null = null;

    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();

        // Send initial connection event with status
        const status = getConnectionStatus();
        const connectedData = {
          vmCount: status.size,
          vmIds: Array.from(status.keys()),
          connectionStatus: Object.fromEntries(status),
        };
        controller.enqueue(encoder.encode(`event: connected\ndata: ${JSON.stringify(connectedData)}\n\n`));

        // Subscribe to VM events
        unsubscribe = subscribeToVmEvents((vmEvent) => {
          // Filter by vmIds if specified
          if (vmIdSet && !vmIdSet.has(vmEvent.vmId)) return;

          const payload = `event: vm_event\ndata: ${JSON.stringify(vmEvent)}\n\n`;
          try {
            controller.enqueue(encoder.encode(payload));
          } catch {
            // Client disconnected
            if (unsubscribe) unsubscribe();
          }
        });
      },
      cancel() {
        // Client disconnected
        if (unsubscribe) unsubscribe();
      },
    });

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  }

  // Prometheus metrics endpoint
  if (url.pathname === "/metrics" && req.method === "GET") {
    const format = url.searchParams.get("format");
    if (format === "json") {
      return Response.json(metrics.toJSON(), { headers: corsHeaders });
    }
    return new Response(metrics.toPrometheus(), {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
      },
    });
  }

  // Agent commands endpoint - returns available commands from agent subprocess
  if (url.pathname === "/commands" && req.method === "GET") {
    return Response.json({ commands: getAvailableAgentCommands() }, { headers: corsHeaders });
  }

  // Log streaming endpoint (SSE)
  if (url.pathname === "/logs" && req.method === "GET") {
    const minLevel = (url.searchParams.get("level") || "info") as LogLevel;
    const includeRecent = url.searchParams.get("recent") !== "false";

    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();

        // Send recent logs first if requested
        if (includeRecent) {
          const recent = logStream.getRecent(50);
          for (const entry of recent) {
            if (shouldIncludeLevel(entry.level, minLevel)) {
              const payload = `data: ${logStream.formatForSSE(entry)}\n\n`;
              controller.enqueue(encoder.encode(payload));
            }
          }
        }

        // Subscribe to new logs
        const unsubscribe = logStream.subscribe((entry) => {
          if (shouldIncludeLevel(entry.level, minLevel)) {
            const payload = `data: ${logStream.formatForSSE(entry)}\n\n`;
            try {
              controller.enqueue(encoder.encode(payload));
            } catch {
              unsubscribe();
            }
          }
        });

        // Store unsubscribe for cleanup
        (controller as any)._unsubscribe = unsubscribe;
      },
      cancel(controller) {
        const unsubscribe = (controller as any)._unsubscribe;
        if (unsubscribe) unsubscribe();
      },
    });

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  }

  // Shell UI - web interface for vers-agent
  if (url.pathname === "/shell" && req.method === "GET") {
    const shellPath = new URL("./static/shell.html", import.meta.url).pathname;
    const shellHtml = await Bun.file(shellPath).text();
    return new Response(shellHtml, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/html; charset=utf-8",
      },
    });
  }

  return Response.json({ error: "Not Found" }, { status: 404, headers: corsHeaders });
}

// VM metadata sync interval (10 seconds)
const VM_SYNC_INTERVAL_MS = 10_000;

/**
 * Sync local VM metadata with Vers infrastructure (source of truth)
 * - Removes stale entries for VMs that no longer exist in Vers
 * - Updates duration_ms for running VMs
 */
async function syncVmMetadata(): Promise<void> {
  try {
    // Get VMs from Vers SDK (source of truth)
    const versVms = await listVms();
    const versVmIds = new Set(versVms.map(vm => vm.vm_id));

    // Load local metadata
    const localMetadata = loadMetadata();
    const localVmIds = Object.keys(localMetadata);

    let removedCount = 0;
    let updatedCount = 0;

    // Remove stale entries (VMs in local metadata but not in Vers)
    for (const vmId of localVmIds) {
      if (!versVmIds.has(vmId)) {
        debug(`[vm-sync] Removing stale VM metadata: ${vmId.slice(0, 8)}`);
        removeVmMetadata(vmId);
        removedCount++;
      }
    }

    // Update duration_ms for running VMs
    const now = Date.now();
    for (const vmId of localVmIds) {
      if (versVmIds.has(vmId)) {
        const meta = localMetadata[vmId];
        if (meta && (meta.status === "starting" || meta.status === "ready" || meta.status === "busy")) {
          const createdAt = new Date(meta.createdAt).getTime();
          const durationMs = now - createdAt;
          // Only update if status is still active (not completed/failed)
          updateVmMetadata(vmId, { lastHealthCheckAt: new Date().toISOString() });
          updatedCount++;
        }
      }
    }

    if (removedCount > 0 || updatedCount > 0) {
      debug(`[vm-sync] Sync complete: removed=${removedCount}, updated=${updatedCount}`);
    }
  } catch (err) {
    // Don't crash the server if sync fails - just log and continue
    const message = err instanceof Error ? err.message : String(err);
    debug(`[vm-sync] Sync failed: ${message}`);
  }
}

// Create the HTTP server with automatic port finding
export function createHttpServer(requestedPort: number, maxAttempts = 10): { close: () => void; port: number } {
  let server: ReturnType<typeof Bun.serve> | null = null;
  let actualPort = requestedPort;
  let vmSyncInterval: ReturnType<typeof setInterval> | null = null;

  // Set up callback for agent commands - broadcast to all SSE clients
  onAgentCommandsUpdated((commands) => {
    broadcastAgentCommands(commands as AvailableCommandData[]);
  });

  // Set up callback for agent stderr output - broadcast to all SSE clients
  onAgentStderr((text) => {
    broadcastEvent("notification", {
      type: "agent_output",
      data: { type: "agent_output", text },
    });
  });

  // Set up callback for session ID updates - update SessionManager when agent sends session ID
  onAgentSessionIdUpdated((sessionId) => {
    const currentId = sessionManager.getCurrentId();
    // Update SessionManager with the notification (captures Claude internal ID)
    sessionManager.updateFromNotification(sessionId);

    // Broadcast session ID update to SSE clients if changed
    if (currentId !== sessionManager.getCurrentId()) {
      info("Session ID updated from agent notification", {
        old: currentId,
        new: sessionManager.getCurrentId(),
        claudeInternalId: sessionManager.getClaudeInternalId()
      });
      broadcastEvent("notification", {
        type: "session_id_updated",
        data: { type: "session_id_updated", sessionId: sessionManager.getCurrentId() },
      });
    }
  });

  // Try the requested port first, then increment
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const tryPort = requestedPort + attempt;
    server = tryCreateServer(tryPort);
    if (server) {
      actualPort = tryPort;
      break;
    }
    if (attempt === 0) {
      info("Port is in use, trying alternate ports", { port: tryPort });
    }
  }

  if (!server) {
    throw new Error(`Could not find an available port after ${maxAttempts} attempts (tried ${requestedPort}-${requestedPort + maxAttempts - 1})`);
  }

  info("ACP HTTP server listening", { url: `http://localhost:${actualPort}` });

  // Start VM metadata sync (every 10 seconds)
  vmSyncInterval = setInterval(() => {
    syncVmMetadata().catch(err => {
      debug(`[vm-sync] Background sync error: ${err instanceof Error ? err.message : String(err)}`);
    });
  }, VM_SYNC_INTERVAL_MS);

  // Run initial sync immediately
  syncVmMetadata().catch(err => {
    debug(`[vm-sync] Initial sync error: ${err instanceof Error ? err.message : String(err)}`);
  });

  info("[vm-sync] Background VM sync started", { intervalMs: VM_SYNC_INTERVAL_MS });

  return {
    close: () => {
      // Stop VM sync interval
      if (vmSyncInterval) {
        clearInterval(vmSyncInterval);
        vmSyncInterval = null;
        info("[vm-sync] Background VM sync stopped");
      }
      server!.stop();
    },
    port: actualPort,
  };
}

