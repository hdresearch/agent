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
  type NewSessionResult,
  type LoadSessionParams,
  type LoadSessionResult,
  type PromptParams,
  type PromptResult,
  type SetModeParams,
  type SetModeResult,
  type CancelParams,
  type CancelResult,
  type SessionNotificationParams,
  type AgentCapabilities,
  type QueueEnqueueParams,
  type QueueEnqueueResult,
  type QueueDequeueResult,
  type QueuePeekResult,
  type QueueListResult,
  type QueueRemoveParams,
  type QueueRemoveResult,
  type QueueClearResult,
  type QueuedPromptInfo,
  type SessionInfo,
  type ListSessionsResult,
  type GetSessionOutputsParams,
  type GetSessionOutputsResult,
  type SessionSyncInfo,
  type AgentInfo,
  type AgentListResult,
  type AgentSelectParams,
  type AgentSelectResult,
  type AgentStatusResult,
  type SkillListResult,
  type SkillGetParams,
  type SkillGetResult,
  type SkillSaveParams,
  type SkillSaveResult,
  type SkillDeleteParams,
  type SkillDeleteResult,
  type SkillInvokeParams,
  type SkillInvokeResult,
  type VmListResult,
  type VmCreateParams,
  type VmCreateResult,
  type VmBranchParams,
  type VmBranchResult,
  type VmDeleteParams,
  type VmDeleteResult,
  type VmConnectParams,
  type VmConnectResult,
  type VmStatusResult,
  type VmRunParams,
  type VmRunResult,
  type VmExecuteParams,
  type VmExecuteResult,
  type VmUploadParams,
  type VmUploadResult,
  type VmEventsParams,
  type VmEventsResult,
  type VmOutputsParams,
  type VmOutputsResult,
  type VmOutputsAllParams,
  type VmOutputsAllResult,
  type VmWaitParams,
  type VmWaitResult,
  type VmEvalParams,
  type VmEvalResult,
} from "../protocol/acp-types";
import {
  subscribeToVmEvents,
  getEventsSince,
  getLastSeq,
  getConnectionStatus,
  getConnectionStatusObject,
} from "./vm-event-aggregator";
import {
  initializeRegistry,
  listAgents,
  getAgent,
  type AgentDefinition,
} from "../agents";
import { promptQueue, type QueuedPrompt } from "../core/prompt-queue";
import {
  runTask,
  cancelTask,
  initializeAgent,
  stopAgent,
  selectAgent,
  getCurrentAgentId,
  isAgentRunning,
  getAgentSessionId,
  getClaudeSessionId,
  clearClaudeSessionId,
  listAgents as getAgentsList,
  clearProjectDocsCache,
  markDocsForReinjection,
  respondToPermission,
  cancelPermission,
  getAgentCommands,
  onAgentCommandsUpdated,
  onAgentStderr,
  onAgentSessionIdUpdated,
} from "../core/agent-manager";
import { getDocs, setDocs, setDoc, getDocsStore, loadDocsStore, type StoredDoc } from "../utils/docs-store";
import { taskStore } from "../core/tasks";
import { getConfig, setConfig, getSession, resetSession, updateSession, loadConfig, getMcpServers, addMcpServer, removeMcpServer, type McpServerConfig, setSessionMode, getSessionMode, getPlan, setPlan, clearPlan, type PlanEntry } from "../utils/config";
import { sessionStore, sessionOutputStore } from "../utils/session-store";
import { loadStoredKeys, saveKeys, computeKeysHash, type KeysState } from "../utils/keys";
import { expandPrompt, hasPathReferences } from "../utils/path-expansion";
import { metrics, MetricNames } from "../utils/metrics";
import { logStream, shouldIncludeLevel, type LogLevel } from "../utils/log-stream";
import { authStore } from "../utils/auth-store";
import { cleanTitle } from "../utils/string-utils";
import { listSkills, getSkill, saveSkill, deleteSkill, buildSkillPrompt } from "../utils/skill-store";
import { randomUUID } from "crypto";

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
} from "./handlers";

// SSE management
import { addSseClient, removeSseClient, broadcastEvent, sseManager } from "./sse-manager";

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

function warn(message: string, data?: unknown): void {
  logStream.warn(message, data);
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

interface AuthResult {
  authorized: boolean;
  error?: string;
  claimToken?: string; // Only set when claiming
}

function checkAuth(req: Request, clientId?: string): AuthResult {
  const claimState = authStore.getClaimState();

  // If server is unclaimed, allow and initiate claim
  if (!claimState.isClaimed) {
    const claimResult = authStore.claim(clientId || "unknown-client");
    if (claimResult.success) {
      info("Server claimed by client", { clientId });
      return { authorized: true, claimToken: claimResult.token };
    }
    // Race condition - someone else claimed it
    return { authorized: false, error: "Server was just claimed by another client" };
  }

  // Server is claimed, check token
  const token = getAuthToken(req);
  if (!token) {
    return { authorized: false, error: "Authentication required. Server is claimed." };
  }

  if (!authStore.verifyToken(token)) {
    return { authorized: false, error: "Invalid authentication token" };
  }

  return { authorized: true };
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

// Server state
let initialized = false;
let authenticated = false;
let currentSessionId: string | null = null;
let runningTaskId: string | null = null;
let autoProcessQueue = true; // Auto-process queued prompts after task completion
let currentAgentId: string = "claude.com"; // Default to Claude Code ACP
let accumulatedAssistantText: string = ""; // Buffer for streaming text chunks

// Helper to convert QueuedPrompt to QueuedPromptInfo
function toQueuedPromptInfo(prompt: QueuedPrompt): QueuedPromptInfo {
  return {
    id: prompt.id,
    text: prompt.text,
    attachments: prompt.attachments,
    queuedAt: prompt.queuedAt.toISOString(),
    mode: prompt.mode,
  };
}

// Process next queued prompt if available
async function processNextQueuedPrompt(): Promise<void> {
  if (!autoProcessQueue || runningTaskId || promptQueue.isEmpty) {
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
  runningTaskId = task.id;
  promptQueue.setProcessing(true);
  metrics.setGauge(MetricNames.RUNNING_TASKS, 1);

  // Subscribe to task events and broadcast via SSE
  const unsubscribe = taskStore.subscribe(task.id, (event) => {
    debug("Task event", { type: event.type, data: event.data });
    sendSessionNotification(event.type, event.data);

    if (event.type === "completed" || event.type === "failed" || event.type === "cancelled") {
      info("Task finished", { taskId: task.id, status: event.type });
      runningTaskId = null;
      promptQueue.setProcessing(false);
      metrics.setGauge(MetricNames.RUNNING_TASKS, 0);
      metrics.setGauge(MetricNames.QUEUE_LENGTH, promptQueue.length);

      // Process next queued prompt if available
      if (autoProcessQueue && !promptQueue.isEmpty) {
        // Use setImmediate to avoid blocking
        setTimeout(() => processNextQueuedPrompt(), 0);
      }
    }
  });

  // Start task execution (don't await)
  info("Starting task execution", { taskId: task.id });
  runTask(task.id).catch((err) => {
    error(`Task ${task.id} failed`, { error: err instanceof Error ? err.message : String(err) });
    runningTaskId = null;
    promptQueue.setProcessing(false);
    metrics.setGauge(MetricNames.RUNNING_TASKS, 0);
    unsubscribe();

    // Still try to process next queued prompt
    if (autoProcessQueue && !promptQueue.isEmpty) {
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
      if (currentSessionId) {
        sessionStore.recordCompletion(currentSessionId, (d.totalCostUsd as number) || 0);
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
        if (currentSessionId) {
          sessionStore.setMode(currentSessionId, d.mode);
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
  if (currentSessionId) {
    sessionOutputStore.append(currentSessionId, {
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
    sessionId: currentSessionId || "",
    type: mapped.type as SessionNotificationParams["type"],
    data: mapped.data as SessionNotificationParams["data"],
  };

  // Store certain notification types as outputs for history sync
  const d = data as Record<string, unknown>;
  debug("[OUTPUT_STORE] Event", { type, sessionId: currentSessionId, dataKeys: Object.keys(d) });

  if (currentSessionId) {
    switch (type) {
      case "text_delta":
        // Accumulate streaming text
        const deltaText = (d.text as string) || "";
        accumulatedAssistantText += deltaText;
        // If this is the final chunk, store the accumulated text
        if (d.final === true && accumulatedAssistantText) {
          debug("[OUTPUT_STORE] Storing accumulated text", { preview: accumulatedAssistantText.slice(0, 50), length: accumulatedAssistantText.length });
          storeAndBroadcastOutput("text", accumulatedAssistantText);
          accumulatedAssistantText = ""; // Reset buffer
        }
        break;
      case "assistant_message":
        const textContent = (d.text as string) || "";
        debug("[OUTPUT_STORE] Storing assistant_message", { preview: textContent.slice(0, 50) });
        storeAndBroadcastOutput("text", textContent);
        break;
      case "started":
        // Reset accumulator when a new task starts
        accumulatedAssistantText = "";
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
  initialized = true;

  // Initialize agent registry and set default agent from config
  await initializeRegistry();
  const config = getConfig();
  if (config.defaultAgent && config.defaultAgent !== currentAgentId) {
    const agent = getAgent(config.defaultAgent);
    if (agent) {
      currentAgentId = agent.identity;
      info("Default agent loaded from config", { agentId: currentAgentId });
    }
  }

  return {
    agentInfo: AGENT_INFO,
    capabilities: AGENT_CAPABILITIES,
  };
}

// Auto-initialize if needed (for resilience after server restart)
async function ensureInitialized(): Promise<void> {
  if (!initialized) {
    info("Auto-initializing server (client reconnected after restart)");
    initialized = true;
    // Also load the agent registry
    await initializeRegistry();
    const config = getConfig();
    if (config.defaultAgent && config.defaultAgent !== currentAgentId) {
      const agent = getAgent(config.defaultAgent);
      if (agent) {
        currentAgentId = agent.identity;
        info("Default agent loaded from config", { agentId: currentAgentId });
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

  authenticated = true;
  return { success: true };
}

async function handleSessionNew(params: NewSessionParams): Promise<NewSessionResult & { mode?: string }> {
  info("Creating new session");
  metrics.incCounter(MetricNames.SESSIONS_CREATED);
  metrics.incGauge(MetricNames.ACTIVE_SESSIONS);
  resetSession();
  clearProjectDocsCache(); // Force re-read of CLAUDE.md, AGENT.md, etc.

  if (params.config) {
    if (params.config.model) {
      await setConfig({ model: params.config.model });
    }
  }

  // Only start agent if not already running
  // Don't restart - Claude subprocess restarts are flaky and the existing session works fine
  if (!isAgentRunning()) {
    info("Agent not running, starting fresh");
    await initializeAgent();
  } else {
    info("Agent already running, reusing existing subprocess");
  }

  // Wait for Claude's session ID with timeout (up to 3 seconds)
  // Claude's session ID is the 8-char format that Claude CLI uses internally
  // This is the ID we need to store for session resume to work
  let claudeSessionId = getClaudeSessionId();
  if (!claudeSessionId) {
    for (let i = 0; i < 30 && !claudeSessionId; i++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      claudeSessionId = getClaudeSessionId();
    }
  }

  if (!claudeSessionId) {
    warn("Claude did not provide session ID within timeout, falling back to agent session ID");
  }

  // Use Claude's session ID (preferred) or fall back to agent's or random UUID
  const previousSessionId = currentSessionId;
  currentSessionId = claudeSessionId || getAgentSessionId() || randomUUID();

  info("handleSessionNew - Session ID details:", {
    previousSessionId,
    claudeSessionId,
    agentSessionId: getAgentSessionId(),
    newCurrentSessionId: currentSessionId,
    usingClaude: !!claudeSessionId,
  });

  updateSession({ sessionId: currentSessionId });

  // Register this session in SQLite storage with Claude's session ID
  // This is critical for resume - we need to store the ID Claude recognizes
  // Use getOrCreate in case we somehow get a duplicate ID
  sessionStore.getOrCreate(currentSessionId);

  // Get the current mode (should be "default" after reset)
  const mode = getSessionMode();
  info("New session created:", { sessionId: currentSessionId, mode });

  // Broadcast mode update to ensure all clients know the mode
  sendSessionNotification("mode_update", { type: "mode_update", mode });

  return { sessionId: currentSessionId, mode };
}

async function handleSessionLoad(params: LoadSessionParams): Promise<LoadSessionResult> {
  // Touch session in SQLite to update lastUsedAt
  sessionStore.touch(params.sessionId);

  // Get session mode from store and sync it
  const storedSession = sessionStore.get(params.sessionId);
  if (storedSession) {
    setSessionMode(storedSession.mode);
    sendSessionNotification("mode_update", { type: "mode_update", mode: storedSession.mode });
  }

  // Check if agent is already running
  const agentAlreadyRunning = isAgentRunning();

  if (agentAlreadyRunning) {
    // Agent already running - just use its current session
    // Don't restart as that would lose any in-progress context
    info("handleSessionLoad - agent already running, using current session");
  } else {
    // Agent not running - start it with resume option
    // The session ID in SQLite should be Claude's actual session ID (8-char format)
    // This was stored during handleSessionNew when we captured Claude's session ID
    info("handleSessionLoad - starting agent with resume", { sessionId: params.sessionId });
    await initializeAgent(undefined, undefined, { resumeSessionId: params.sessionId });
  }

  // Wait for Claude's session ID (up to 3 seconds)
  let claudeSessionId = getClaudeSessionId();
  if (!claudeSessionId) {
    for (let i = 0; i < 30 && !claudeSessionId; i++) {
      await new Promise(resolve => setTimeout(resolve, 100));
      claudeSessionId = getClaudeSessionId();
    }
  }

  // Check if resume actually succeeded by comparing session IDs
  const resumeSucceeded = claudeSessionId === params.sessionId;

  if (!resumeSucceeded && claudeSessionId) {
    // Resume failed - Claude created a new session instead of resuming
    warn("Session resume failed - Claude created new session", {
      requested: params.sessionId,
      received: claudeSessionId
    });
    // Store the new session ID so future restarts don't keep trying to resume the old one
    sessionStore.create(claudeSessionId);
  }

  // Use Claude's session ID (either resumed or new)
  const displaySessionId = claudeSessionId || params.sessionId;

  currentSessionId = displaySessionId;
  updateSession({ sessionId: displaySessionId });

  info("handleSessionLoad - session loaded", {
    requestedSessionId: params.sessionId,
    claudeSessionId,
    displaySessionId,
    resumeSucceeded,
    agentWasRunning: agentAlreadyRunning
  });

  return {
    sessionId: displaySessionId,
    resumed: resumeSucceeded,
  };
}

async function handleSessionList(): Promise<ListSessionsResult> {
  const sessions = sessionStore.list(50);

  info("handleSessionList - returning currentSessionId:", { currentSessionId, sessionCount: sessions.length });

  return {
    sessions: sessions.map((s) => ({
      id: s.id,
      name: s.name || undefined,
      createdAt: s.createdAt,
      lastUsedAt: s.lastUsedAt,
      turns: s.turns,
      totalCost: s.totalCost,
      mode: s.mode,
    })),
    currentSessionId,
  };
}

async function handleSessionPrompt(params: PromptParams): Promise<PromptResult & { queued?: boolean; queuePosition?: number }> {
  metrics.incCounter(MetricNames.PROMPTS_TOTAL);

  // Auto-create session if needed
  if (!currentSessionId) {
    info("Auto-creating session for incoming prompt");
    await handleSessionNew({});
  }

  // Validate required params
  if (!params.text) {
    throw new Error("Missing required parameter: text");
  }

  // Store user message in output history
  if (currentSessionId) {
    const hasAttachments = params.attachments && params.attachments.length > 0;
    const displayText = hasAttachments
      ? `[${params.attachments!.length} attachment(s)]\n${params.text}`
      : params.text;
    storeAndBroadcastOutput("user", displayText);
  }

  // If a task is already running, queue this prompt
  if (runningTaskId) {
    const queued = promptQueue.enqueue(params.text, params.attachments);
    metrics.incCounter(MetricNames.PROMPTS_QUEUED);
    metrics.setGauge(MetricNames.QUEUE_LENGTH, promptQueue.length);
    info(`Queued prompt (position ${promptQueue.length}): ${params.text.slice(0, 50)}...`);

    // Notify that the prompt was queued
    sendSessionNotification("prompt_queued", {
      type: "prompt_queued",
      promptId: queued.id,
      position: promptQueue.length,
      text: params.text.slice(0, 100),
    });

    return { success: true, queued: true, queuePosition: promptQueue.length };
  }

  // Execute immediately
  await executePrompt(params.text, params.attachments);
  return { success: true };
}

async function handleSessionCancel(params: CancelParams): Promise<CancelResult> {
  if (!runningTaskId) {
    return { cancelled: false };
  }

  const cancelled = await cancelTask(runningTaskId);
  if (cancelled) {
    runningTaskId = null;
  }
  return { cancelled };
}

async function handleSessionSetMode(params: SetModeParams): Promise<SetModeResult> {
  // Only support default and plan modes
  if (params.mode !== "default" && params.mode !== "plan") {
    throw new Error(`Unsupported mode: ${params.mode}. Supported modes: default, plan`);
  }

  setSessionMode(params.mode);

  // Broadcast mode change to SSE clients
  sendSessionNotification("mode_update", { type: "mode_update", mode: params.mode });

  return { mode: params.mode };
}

// ============================================================
// Skill Handlers
// ============================================================

async function handleSkillList(): Promise<SkillListResult> {
  const skills = await listSkills();
  return { skills };
}

async function handleSkillGet(params: SkillGetParams): Promise<SkillGetResult> {
  const skill = await getSkill(params.name);
  return { skill };
}

async function handleSkillSave(params: SkillSaveParams): Promise<SkillSaveResult> {
  const skill = await saveSkill({
    name: params.name,
    description: params.description,
    prompt: params.prompt,
    argsHint: params.argsHint,
  });
  return { skill };
}

async function handleSkillDelete(params: SkillDeleteParams): Promise<SkillDeleteResult> {
  const deleted = await deleteSkill(params.name);
  return { deleted };
}

async function handleSkillInvoke(params: SkillInvokeParams): Promise<SkillInvokeResult> {
  const skill = await getSkill(params.name);
  if (!skill) {
    return { success: false, message: `Skill not found: ${params.name}` };
  }

  // Build the full prompt with skill instructions + user args
  const fullPrompt = buildSkillPrompt(skill, params.args);

  // Execute via session/prompt
  await handleSessionPrompt({ text: fullPrompt });

  return { success: true };
}

// ============================================================
// VM Management Handlers (orchestrator)
// ============================================================

// Track current VM connection
let currentVmId: string | null = null;
let currentVmAgentUrl: string | null = null;

async function handleVmList(): Promise<VmListResult> {
  try {
    const { listManagedVms } = await import("../orchestrator");
    const vms = await listManagedVms();

    return {
      vms: vms.map(vm => ({
        vmId: vm.vmId,
        parent: vm.parent,
        status: vm.metadata?.status || "ready",
        task: vm.metadata?.task,
        approach: vm.metadata?.approach,
        createdAt: vm.metadata?.createdAt || new Date().toISOString(),
      })),
      currentVmId: currentVmId || undefined,
    };
  } catch (err) {
    error("Failed to list VMs", { error: err instanceof Error ? err.message : String(err) });
    return { vms: [] };
  }
}

async function handleVmCreate(params: VmCreateParams): Promise<VmCreateResult> {
  const { createManagedVm } = await import("../orchestrator");
  const { getAgentUrl } = await import("../vm");

  const vm = await createManagedVm({}, params.task);
  const agentUrl = getAgentUrl(vm.vmId);

  info("Created VM", { vmId: vm.vmId, agentUrl });

  return {
    vmId: vm.vmId,
    agentUrl,
  };
}

async function handleVmBranch(params: VmBranchParams): Promise<VmBranchResult> {
  const { branchVm } = await import("../orchestrator");
  const { getAgentUrl } = await import("../vm");

  try {
    const vm = await branchVm(params.vmId, params.task, params.approach);
    const agentUrl = getAgentUrl(vm.vmId);

    info("Branched VM", { vmId: vm.vmId, parentId: params.vmId, agentUrl });

    return {
      vmId: vm.vmId,
      parentId: params.vmId,
      agentUrl,
    };
  } catch (err) {
    error("Failed to branch VM", { parentId: params.vmId, error: err instanceof Error ? err.message : String(err) });
    throw new Error(`Failed to branch VM ${params.vmId}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function handleVmDelete(params: VmDeleteParams): Promise<VmDeleteResult> {
  const { deleteManagedVm } = await import("../orchestrator");

  try {
    await deleteManagedVm(params.vmId);
    info("Deleted VM", { vmId: params.vmId });

    // Clear current VM if it was deleted
    if (currentVmId === params.vmId) {
      currentVmId = null;
      currentVmAgentUrl = null;
    }

    return { deleted: true };
  } catch (err) {
    error("Failed to delete VM", { vmId: params.vmId, error: err instanceof Error ? err.message : String(err) });
    return { deleted: false };
  }
}

async function handleVmConnect(params: VmConnectParams): Promise<VmConnectResult> {
  const { getManagedVm } = await import("../orchestrator");
  const { getAgentUrl } = await import("../vm");

  try {
    const vm = await getManagedVm(params.vmId);
    if (!vm) {
      return {
        success: false,
        vmId: params.vmId,
        agentUrl: "",
        error: "VM not found or not connected",
      };
    }

    const agentUrl = getAgentUrl(params.vmId);
    currentVmId = params.vmId;
    currentVmAgentUrl = agentUrl;

    info("Connected to VM", { vmId: params.vmId, agentUrl });

    return {
      success: true,
      vmId: params.vmId,
      agentUrl,
    };
  } catch (err) {
    return {
      success: false,
      vmId: params.vmId,
      agentUrl: "",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function handleVmStatus(): VmStatusResult {
  return {
    currentVmId: currentVmId || undefined,
    currentAgentUrl: currentVmAgentUrl || undefined,
    isLocal: currentVmId === null,
  };
}

async function handleVmRun(params: VmRunParams): Promise<VmRunResult> {
  const { listManagedVms, getManagedVm } = await import("../orchestrator");

  // Get list of VMs to run on
  const allVms = await listManagedVms();
  const targetVmIds = params.vmIds && params.vmIds.length > 0
    ? params.vmIds
    : allVms.map(v => v.vmId);

  info("Dispatching prompt to VMs", { count: targetVmIds.length, prompt: params.prompt.slice(0, 50) });

  const dispatched: string[] = [];

  // Fire prompts to all VMs without waiting for completion
  for (const vmId of targetVmIds) {
    try {
      // Use getManagedVm to get/reconnect client (this also registers with event aggregator)
      const managed = await getManagedVm(vmId);

      if (managed) {
        // Initialize and send prompt without waiting
        managed.client.initialize("vers-agent").then(() => {
          managed.client.newSession().then((session) => {
            managed.sessionId = session.sessionId;
            managed.client.prompt(params.prompt).catch(err => {
              warn(`Prompt failed on VM ${vmId}`, { error: err.message });
            });
          });
        }).catch(err => {
          warn(`Failed to initialize VM ${vmId}`, { error: err.message });
        });

        dispatched.push(vmId);
        info(`Dispatched prompt to VM ${vmId.slice(0, 8)}`);
      } else {
        warn(`Failed to get managed VM ${vmId}`);
      }
    } catch (err) {
      warn(`Failed to dispatch to VM ${vmId}`, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  return {
    dispatched: dispatched.length,
    vmIds: dispatched,
  };
}

async function handleVmExecute(params: VmExecuteParams): Promise<VmExecuteResult> {
  const { execute } = await import("../vm");

  info("Executing command on VM", { vmId: params.vmId, command: params.command.slice(0, 50) });

  try {
    const result = await execute(params.vmId, params.command);
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  } catch (err) {
    warn("VM execute failed", { vmId: params.vmId, error: err instanceof Error ? err.message : String(err) });
    return {
      stdout: "",
      stderr: err instanceof Error ? err.message : String(err),
      exitCode: 1,
    };
  }
}

async function handleVmUpload(params: VmUploadParams): Promise<VmUploadResult> {
  const { upload, execute } = await import("../vm");
  const { statSync } = await import("fs");
  const { join } = await import("path");
  const { randomUUID } = await import("crypto");

  info("Uploading to VM", { vmId: params.vmId, localPath: params.localPath, remotePath: params.remotePath });

  try {
    const stat = statSync(params.localPath);

    if (stat.isDirectory()) {
      // For directories: zip locally, upload, unzip remotely
      const tempZip = `/tmp/vers-upload-${randomUUID()}.tar.gz`;
      const remoteZip = `/tmp/vers-upload-${randomUUID()}.tar.gz`;

      info("Uploading directory via tar", { localPath: params.localPath, tempZip });

      // Create tar.gz locally
      const tarResult = Bun.spawnSync(["tar", "-czf", tempZip, "-C", params.localPath, "."]);
      if (tarResult.exitCode !== 0) {
        throw new Error(`Failed to create tar: ${tarResult.stderr.toString()}`);
      }

      // Upload the tar
      await upload(params.vmId, tempZip, remoteZip);

      // Create target directory and extract on remote
      await execute(params.vmId, `mkdir -p ${params.remotePath} && tar -xzf ${remoteZip} -C ${params.remotePath} && rm ${remoteZip}`);

      // Clean up local temp file
      Bun.spawnSync(["rm", tempZip]);

      return { success: true };
    } else {
      // Single file upload
      await upload(params.vmId, params.localPath, params.remotePath);
      return { success: true };
    }
  } catch (err) {
    warn("VM upload failed", { vmId: params.vmId, error: err instanceof Error ? err.message : String(err) });
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function handleVmEvents(params: VmEventsParams): VmEventsResult {
  const events = getEventsSince(params.afterSeq ?? 0, params.vmIds, params.limit ?? 100);
  const lastEvent = events[events.length - 1];
  const lastSeq = lastEvent ? lastEvent.seq : getLastSeq();

  return {
    events,
    lastSeq,
    connectionStatus: getConnectionStatusObject(),
  };
}

async function handleVmOutputs(params: VmOutputsParams): Promise<VmOutputsResult> {
  const { getManagedVm } = await import("../orchestrator");

  const vm = await getManagedVm(params.vmId);
  if (!vm) {
    return {
      vmId: params.vmId,
      outputs: [],
    };
  }

  try {
    // Get session outputs from the VM
    // Note: limit is passed but getSessionOutputs may not support it - filtering done below
    const result = await vm.client.getSessionOutputs({});

    // Transform outputs to simpler format
    // SessionOutput types: "user", "text" (assistant), "tool", "tool-result", "system", "error"
    const outputs: VmOutputsResult["outputs"] = [];
    for (const output of result.outputs || []) {
      if (output.type === "text") {
        // "text" type is assistant/Claude output
        outputs.push({
          type: "assistant",
          content: output.content,
        });
      } else if (output.type === "tool-result" || output.type === "tool_result") {
        outputs.push({
          type: "tool_result",
          content: output.content,
          toolName: output.toolName,
        });
      } else if (output.type === "user") {
        outputs.push({
          type: "user",
          content: output.content,
        });
      }
      // Skip "system", "error", "tool", "stats" types
    }

    return {
      vmId: params.vmId,
      sessionId: vm.sessionId,
      outputs,
    };
  } catch (err) {
    warn("Failed to get VM outputs", { vmId: params.vmId, error: err instanceof Error ? err.message : String(err) });
    return {
      vmId: params.vmId,
      outputs: [],
    };
  }
}

async function handleVmWait(params: VmWaitParams): Promise<VmWaitResult> {
  const { getManagedVm } = await import("../orchestrator");
  const timeout = params.timeout ?? 300000; // 5 min default
  const startTime = Date.now();

  const vm = await getManagedVm(params.vmId);
  if (!vm) {
    return {
      vmId: params.vmId,
      status: "failed",
      error: "VM not found",
    };
  }

  return new Promise((resolve) => {
    let resolved = false;
    let timeoutId: Timer | null = null;

    // Subscribe to VM events
    const unsubscribe = subscribeToVmEvents((event) => {
      if (resolved) return;
      if (event.vmId !== params.vmId) return;

      const eventType = event.event.type;

      if (eventType === "completed") {
        resolved = true;
        if (timeoutId) clearTimeout(timeoutId);
        unsubscribe();

        const durationMs = Date.now() - startTime;

        // Get outputs after completion
        handleVmOutputs({ vmId: params.vmId, limit: 10 }).then((outputsResult) => {
          resolve({
            vmId: params.vmId,
            status: "completed",
            durationMs,
            outputs: outputsResult.outputs,
          });
        });
      } else if (eventType === "failed") {
        resolved = true;
        if (timeoutId) clearTimeout(timeoutId);
        unsubscribe();

        const errorData = event.event.data as { error?: string };
        resolve({
          vmId: params.vmId,
          status: "failed",
          durationMs: Date.now() - startTime,
          error: errorData?.error || "Task failed",
        });
      }
    });

    // Set timeout
    timeoutId = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      unsubscribe();

      resolve({
        vmId: params.vmId,
        status: "timeout",
        durationMs: timeout,
        error: `Timeout after ${timeout}ms`,
      });
    }, timeout);
  });
}

async function handleVmOutputsAll(params: VmOutputsAllParams): Promise<VmOutputsAllResult> {
  const { listManagedVms, getManagedVm } = await import("../orchestrator");
  const limit = params.limit ?? 1;

  // Get all VMs with their metadata
  const vmList = await listManagedVms();

  const result: VmOutputsAllResult = { vms: {} };

  // Fetch outputs from each VM in parallel
  await Promise.all(
    vmList.map(async (vm) => {
      const vmId = vm.vmId;
      const metadata = vm.metadata;

      // Try to get outputs from this VM
      let outputs: VmOutputsResult["outputs"] = [];
      let lastMessage: string | undefined;
      let lastMessageType: "assistant" | "tool_result" | "user" | undefined;

      try {
        const managed = await getManagedVm(vmId);
        if (managed) {
          const outputsResult = await handleVmOutputs({ vmId, limit });
          outputs = outputsResult.outputs;

          // Find the last assistant message
          for (let i = outputs.length - 1; i >= 0; i--) {
            const output = outputs[i];
            if (!output) continue;
            if (output.type === "assistant") {
              lastMessage = output.content;
              lastMessageType = "assistant";
              break;
            } else if (output.type === "tool_result" && !lastMessage) {
              lastMessage = output.content.slice(0, 200); // Truncate tool results
              lastMessageType = "tool_result";
            }
          }
        }
      } catch {
        // VM not reachable, still include it with empty outputs
      }

      result.vms[vmId] = {
        vmId,
        status: metadata?.status || "unknown",
        task: metadata?.task,
        lastMessage,
        lastMessageType,
        outputs,
      };
    })
  );

  return result;
}

async function handleVmEval(params: VmEvalParams): Promise<VmEvalResult> {
  const { getManagedVm } = await import("../orchestrator");
  const { vmId, cwd, commands, skip, timeout } = params;

  const managed = await getManagedVm(vmId);
  if (!managed) {
    throw new Error(`VM not found: ${vmId}`);
  }

  // Run evaluation commands on the VM via SSH
  const evalTimeout = timeout ?? 60000;
  const skipSet = new Set(skip ?? []);

  // First detect project type by checking for common files
  const detectCmd = `
    if [ -f bun.lock ] || [ -f bun.lockb ]; then echo "bun";
    elif [ -f package.json ]; then echo "node";
    elif [ -f Cargo.toml ]; then echo "rust";
    elif [ -f go.mod ]; then echo "go";
    elif [ -f pyproject.toml ] || [ -f requirements.txt ]; then echo "python";
    else echo "unknown"; fi
  `.trim().replace(/\n\s*/g, ' ');

  const workDir = cwd ?? "/root/vers-agent";
  const { execute: executeOnVm } = await import("../vm");

  const detectResult = await executeOnVm(vmId, `cd ${workDir} && ${detectCmd}`);
  const projectType = detectResult.stdout.trim() || "unknown";

  // Get default commands based on project type
  const defaultCommands: Record<string, { build?: string; test?: string; lint?: string; typecheck?: string }> = {
    bun: { build: "bun run build", test: "bun test", lint: "bun run lint", typecheck: "bun run tsc --noEmit" },
    node: { build: "npm run build", test: "npm test", lint: "npm run lint", typecheck: "npm run typecheck" },
    rust: { build: "cargo build", test: "cargo test", lint: "cargo clippy -- -D warnings", typecheck: "cargo check" },
    go: { build: "go build ./...", test: "go test ./...", lint: "golangci-lint run", typecheck: "go vet ./..." },
    python: { test: "pytest", lint: "ruff check .", typecheck: "mypy ." },
    unknown: {},
  };

  const cmds = { ...defaultCommands[projectType], ...commands };

  const results: VmEvalResult["results"] = {};
  const scoreBreakdown = { build: 0, test: 0, lint: 0, typecheck: 0 };

  // Helper to run a command on the VM
  async function runCmd(cmd: string): Promise<{ success: boolean; exitCode: number; stdout: string; stderr: string; durationMs: number }> {
    const start = Date.now();
    try {
      const result = await executeOnVm(vmId, `cd ${workDir} && timeout ${Math.floor(evalTimeout / 1000)} ${cmd}`);
      return {
        success: result.exitCode === 0,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs: Date.now() - start,
      };
    } catch (error) {
      return {
        success: false,
        exitCode: -1,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - start,
      };
    }
  }

  const startTime = Date.now();

  // Run build
  if (cmds.build && !skipSet.has("build")) {
    const buildResult = await runCmd(cmds.build);
    results.build = buildResult;
    scoreBreakdown.build = buildResult.success ? 25 : 0;
  } else {
    scoreBreakdown.build = 25; // No build = assume success
  }

  // Run typecheck
  if (cmds.typecheck && !skipSet.has("typecheck")) {
    const typecheckResult = await runCmd(cmds.typecheck);
    results.typecheck = typecheckResult;
    scoreBreakdown.typecheck = typecheckResult.success ? 15 : 0;
  } else {
    scoreBreakdown.typecheck = 10;
  }

  // Run lint
  if (cmds.lint && !skipSet.has("lint")) {
    const lintResult = await runCmd(cmds.lint);
    results.lint = lintResult;
    scoreBreakdown.lint = lintResult.success ? 20 : 0;
  } else {
    scoreBreakdown.lint = 15;
  }

  // Run tests
  if (cmds.test && !skipSet.has("test")) {
    const testResult = await runCmd(cmds.test);
    const metrics = parseTestMetrics(testResult.stdout + testResult.stderr, projectType);
    results.test = {
      ...testResult,
      metrics,
    };

    if (testResult.success) {
      scoreBreakdown.test = 40;
    } else if (metrics?.total && metrics.passed) {
      // Partial credit based on pass rate
      const passRate = metrics.passed / metrics.total;
      scoreBreakdown.test = Math.round(passRate * 30);
    } else {
      scoreBreakdown.test = 0;
    }
  } else {
    scoreBreakdown.test = 30;
  }

  const score = scoreBreakdown.build + scoreBreakdown.test + scoreBreakdown.lint + scoreBreakdown.typecheck;
  const success = (!results.build || results.build.success) && (!results.test || results.test.success);

  return {
    vmId,
    success,
    projectType,
    score,
    scoreBreakdown,
    results,
    totalDurationMs: Date.now() - startTime,
  };
}

// Parse test output metrics based on project type
function parseTestMetrics(output: string, _projectType: string): { passed?: number; failed?: number; skipped?: number; total?: number } | undefined {
  // Bun: "560 pass" / "0 fail"
  const bunPassMatch = output.match(/(\d+)\s+pass\b/i);
  const bunFailMatch = output.match(/(\d+)\s+fail\b/i);
  if (bunPassMatch || bunFailMatch) {
    const passed = bunPassMatch?.[1] ? parseInt(bunPassMatch[1], 10) : 0;
    const failed = bunFailMatch?.[1] ? parseInt(bunFailMatch[1], 10) : 0;
    return { passed, failed, total: passed + failed };
  }

  // Jest/Vitest: "Tests: 5 passed, 2 failed"
  const jestMatch = output.match(/Tests:\s*(\d+)\s+passed(?:,\s*(\d+)\s+failed)?/i);
  if (jestMatch?.[1]) {
    const passed = parseInt(jestMatch[1], 10);
    const failed = jestMatch[2] ? parseInt(jestMatch[2], 10) : 0;
    return { passed, failed, total: passed + failed };
  }

  // pytest: "5 passed, 2 failed"
  const pytestMatch = output.match(/(\d+)\s+passed(?:,\s*(\d+)\s+failed)?/i);
  if (pytestMatch?.[1]) {
    const passed = parseInt(pytestMatch[1], 10);
    const failed = pytestMatch[2] ? parseInt(pytestMatch[2], 10) : 0;
    return { passed, failed, total: passed + failed };
  }

  // Go: count "--- PASS:" and "--- FAIL:"
  const goPassed = (output.match(/---\s+PASS:/g) || []).length;
  const goFailed = (output.match(/---\s+FAIL:/g) || []).length;
  if (goPassed > 0 || goFailed > 0) {
    return { passed: goPassed, failed: goFailed, total: goPassed + goFailed };
  }

  // Rust: "test result: ok. 5 passed; 0 failed"
  const cargoMatch = output.match(/test result:.*?(\d+)\s+passed;\s*(\d+)\s+failed/i);
  if (cargoMatch?.[1] && cargoMatch?.[2]) {
    const passed = parseInt(cargoMatch[1], 10);
    const failed = parseInt(cargoMatch[2], 10);
    return { passed, failed, total: passed + failed };
  }

  return undefined;
}

// File system and agent handlers have been extracted to ./handlers/
// See: handlers/filesystem.ts, handlers/agent.ts

// Handle incoming JSON-RPC request
async function handleRpcRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
  const { id, method, params } = request;

  debug("RPC request:", { id, method, paramsKeys: params ? Object.keys(params as object) : [] });

  // Context for agent handlers (provides access to module-level state)
  const agentHandlerContext: AgentHandlerContext = {
    getCurrentAgentId: () => currentAgentId,
    setCurrentAgentId: (id: string) => { currentAgentId = id; },
    getRunningTaskId: () => runningTaskId,
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
        result = await handleSessionNew(params as NewSessionParams);
        break;

      case AcpMethod.SessionLoad:
        await ensureInitialized();
        result = await handleSessionLoad(params as LoadSessionParams);
        break;

      case AcpMethod.SessionList:
        await ensureInitialized();
        result = await handleSessionList();
        break;

      case AcpMethod.SessionOutputs:
        await ensureInitialized();
        {
          const outputParams = params as GetSessionOutputsParams;
          const sessionId = outputParams.sessionId || currentSessionId;
          if (!sessionId) {
            throw new Error("No session active");
          }
          const outputs = outputParams.afterSeq !== undefined
            ? sessionOutputStore.getAfter(sessionId, outputParams.afterSeq)
            : sessionOutputStore.getAll(sessionId);
          const syncInfo = sessionOutputStore.getSyncInfo(sessionId);
          result = {
            sessionId,
            outputs: outputs.map(o => ({
              seq: o.seq,
              type: o.type,
              content: o.content,
              color: o.color,
              toolName: o.toolName,
            })),
            syncInfo: {
              sessionId,
              count: syncInfo.count,
              lastSeq: syncInfo.lastSeq,
            },
          } as GetSessionOutputsResult;
        }
        break;

      case AcpMethod.SessionSync:
        await ensureInitialized();
        {
          const syncParams = params as { sessionId?: string };
          const sessionId = syncParams.sessionId || currentSessionId;
          if (!sessionId) {
            throw new Error("No session active");
          }
          const syncInfo = sessionOutputStore.getSyncInfo(sessionId);
          result = {
            sessionId,
            count: syncInfo.count,
            lastSeq: syncInfo.lastSeq,
          } as SessionSyncInfo;
        }
        break;

      case AcpMethod.SessionPrompt:
        await ensureInitialized();
        result = await handleSessionPrompt(params as PromptParams);
        break;

      case AcpMethod.SessionCancel:
        await ensureInitialized();
        result = await handleSessionCancel(params as CancelParams);
        break;

      case AcpMethod.SessionSetMode:
        await ensureInitialized();
        result = await handleSessionSetMode(params as SetModeParams);
        break;

      case AcpMethod.SessionReloadDocs:
        await ensureInitialized();
        markDocsForReinjection();
        result = { success: true, message: "Project docs will be re-injected on next message" };
        break;

      case AcpMethod.SessionGetDocs:
        await ensureInitialized();
        result = {
          docs: getDocs(),
          store: getDocsStore(),
        };
        break;

      case AcpMethod.SessionSetDocs:
        await ensureInitialized();
        {
          const docsParams = params as { docs: Array<{ name: string; content: string; path?: string }> };
          if (!docsParams.docs || !Array.isArray(docsParams.docs)) {
            throw new Error("Invalid docs parameter");
          }
          const updatedDocs = await setDocs(docsParams.docs);
          clearProjectDocsCache(); // Force agent to reload from store
          result = {
            success: true,
            docs: updatedDocs,
            message: `Updated ${updatedDocs.length} doc(s)`,
          };
        }
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
        // List configured MCP servers
        {
          const servers = getMcpServers();
          result = { servers };
        }
        break;

      case AcpMethod.McpAdd:
        // Add an MCP server
        {
          const mcpParams = params as { name: string; config: McpServerConfig };
          if (!mcpParams.name) {
            throw new Error("Missing name parameter");
          }
          if (!mcpParams.config) {
            throw new Error("Missing config parameter");
          }
          const servers = await addMcpServer(mcpParams.name, mcpParams.config);
          result = { success: true, servers };
        }
        break;

      case AcpMethod.McpRemove:
        // Remove an MCP server
        {
          const mcpParams = params as { name: string };
          if (!mcpParams.name) {
            throw new Error("Missing name parameter");
          }
          const removed = await removeMcpServer(mcpParams.name);
          result = { success: removed, servers: getMcpServers() };
        }
        break;

      case AcpMethod.SessionGetMode:
        // Get current session mode
        result = { mode: getSessionMode() };
        break;

      case AcpMethod.SessionGetPlan:
        // Get current plan entries
        result = { plan: getPlan(), mode: getSessionMode() };
        break;

      case AcpMethod.SessionSetPlan:
        // Set plan entries
        {
          const planParams = params as { plan: PlanEntry[] };
          if (!planParams.plan || !Array.isArray(planParams.plan)) {
            throw new Error("Missing or invalid plan parameter");
          }
          const plan = setPlan(planParams.plan);
          // Broadcast plan update
          sendSessionNotification("plan_update", { type: "plan_update", entries: plan });
          result = { success: true, plan };
        }
        break;

      case AcpMethod.SessionClearPlan:
        // Clear the current plan
        clearPlan();
        sendSessionNotification("plan_update", { type: "plan_update", entries: [] });
        result = { success: true };
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

      case AcpMethod.SkillInvoke:
        result = await handleSkillInvoke(params as SkillInvokeParams);
        break;

      // VM Management (orchestrator)
      case AcpMethod.VmList:
        result = await handleVmList();
        break;

      case AcpMethod.VmCreate:
        result = await handleVmCreate(params as VmCreateParams);
        break;

      case AcpMethod.VmBranch:
        result = await handleVmBranch(params as VmBranchParams);
        break;

      case AcpMethod.VmDelete:
        result = await handleVmDelete(params as VmDeleteParams);
        break;

      case AcpMethod.VmConnect:
        result = await handleVmConnect(params as VmConnectParams);
        break;

      case AcpMethod.VmStatus:
        result = handleVmStatus();
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
        result = { config: getConfig() };
        break;

      case AcpMethod.ConfigSet:
        {
          const configParams = params as { autoApprovePermissions?: boolean; model?: string; defaultAgent?: string };
          const updatedConfig = await setConfig(configParams);
          result = { success: true, config: updatedConfig };
        }
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

// Shared request handler
async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);

  // CORS headers
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Auth-Token, X-Client-Id",
  };

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Health check - allowed without auth, shows claim status
  if (url.pathname === "/health") {
    const claimState = authStore.getClaimState();
    return Response.json({
      status: "ok",
      initialized,
      sessionId: currentSessionId,
      claimed: claimState.isClaimed,
      claimedAt: claimState.claimedAt,
      metrics: {
        prompts: metrics.getCounter(MetricNames.PROMPTS_TOTAL),
        sessions: metrics.getCounter(MetricNames.SESSIONS_CREATED),
        queueLength: metrics.getGauge(MetricNames.QUEUE_LENGTH),
        sseClients: metrics.getGauge(MetricNames.SSE_CLIENTS),
      },
    }, { headers: corsHeaders });
  }

  // Claim endpoint - check/claim server
  if (url.pathname === "/claim" && req.method === "POST") {
    const clientId = req.headers.get("X-Client-Id") || "unknown-client";
    const claimState = authStore.getClaimState();

    if (claimState.isClaimed) {
      // Already claimed - check if this client has valid token
      const token = getAuthToken(req);
      if (token && authStore.verifyToken(token)) {
        return Response.json({
          claimed: true,
          isOwner: true,
          claimedAt: claimState.claimedAt,
        }, { headers: corsHeaders });
      }
      return Response.json({
        claimed: true,
        isOwner: false,
        error: "Server is already claimed by another client",
      }, { status: 403, headers: corsHeaders });
    }

    // Unclaimed - claim it
    const result = authStore.claim(clientId);
    if (result.success) {
      info("Server claimed via /claim endpoint", { clientId });
      return Response.json({
        claimed: true,
        isOwner: true,
        token: result.token,
        message: "Server claimed successfully. Save this token!",
      }, { headers: corsHeaders });
    }

    return Response.json({
      claimed: true,
      isOwner: false,
      error: result.error,
    }, { status: 403, headers: corsHeaders });
  }

  // All other endpoints require auth (if server is claimed)
  const claimState = authStore.getClaimState();
  if (claimState.isClaimed) {
    const token = getAuthToken(req);
    if (!token) {
      return Response.json({
        error: "Authentication required",
        message: "Server is claimed. Provide token via Authorization header or ?token= parameter",
      }, { status: 401, headers: corsHeaders });
    }
    if (!authStore.verifyToken(token)) {
      return Response.json({
        error: "Invalid token",
        message: "The provided authentication token is invalid",
      }, { status: 403, headers: corsHeaders });
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

  // Root endpoint - identify this as vers-agent
  if (url.pathname === "/" && req.method === "GET") {
    return Response.json({
      service: "vers-agent",
      version: "0.1.0",
      endpoints: ["/health", "/rpc", "/events", "/events/vms", "/logs"]
    }, { headers: corsHeaders });
  }

  // Health check endpoint
  if (url.pathname === "/health" && req.method === "GET") {
    return Response.json({ status: "ok" }, { headers: corsHeaders });
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

  return Response.json({ error: "Not Found" }, { status: 404, headers: corsHeaders });
}

// Create the HTTP server with automatic port finding
export function createHttpServer(requestedPort: number, maxAttempts = 10): { close: () => void; port: number } {
  let server: ReturnType<typeof Bun.serve> | null = null;
  let actualPort = requestedPort;

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

  // Set up callback for session ID updates - update currentSessionId when agent sends real session ID
  onAgentSessionIdUpdated((sessionId) => {
    if (currentSessionId !== sessionId) {
      info("Session ID updated from agent notification", { old: currentSessionId, new: sessionId });
      currentSessionId = sessionId;
      updateSession({ sessionId });
      // Broadcast session ID update to SSE clients
      broadcastEvent("notification", {
        type: "session_id_updated",
        data: { type: "session_id_updated", sessionId },
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

  return {
    close: () => server!.stop(),
    port: actualPort,
  };
}

