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
} from "../protocol/acp-types";
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
  selectAgent,
  getCurrentAgentId,
  isAgentRunning,
  listAgents as getAgentsList,
  clearProjectDocsCache,
  markDocsForReinjection,
  respondToPermission,
  cancelPermission,
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
import { randomUUID } from "crypto";

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

// SSE clients waiting for events
const sseClients: Set<(event: string, data: unknown) => void> = new Set();

function addSseClient(send: (event: string, data: unknown) => void): void {
  sseClients.add(send);
  metrics.setGauge(MetricNames.SSE_CLIENTS, sseClients.size);
}

function removeSseClient(send: (event: string, data: unknown) => void): void {
  sseClients.delete(send);
  metrics.setGauge(MetricNames.SSE_CLIENTS, sseClients.size);
}

function broadcastEvent(type: string, data: unknown): void {
  for (const send of sseClients) {
    send(type, data);
  }
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

    case "assistant_message":
      return {
        type: "content_chunk",
        data: { type: "content_chunk", text: d.text || "", final: true },
      };

    case "tool_use": {
      // Filter out invalid titles (undefined, empty, or literal "undefined" strings)
      const isValidTitle = (s: unknown): s is string =>
        typeof s === "string" && s !== "undefined" && s !== '"undefined"' && s.trim() !== "";
      // Use title, toolName, or toolCallId as fallback - never show "undefined"
      const toolDisplayName = isValidTitle(d.title) ? d.title
        : isValidTitle(d.toolName) ? d.toolName
        : isValidTitle(d.toolCallId) ? d.toolCallId
        : "Tool";
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
      case "assistant_message":
        const textContent = (d.text as string) || "";
        debug("[OUTPUT_STORE] Storing assistant_message", { preview: textContent.slice(0, 50) });
        storeAndBroadcastOutput("text", textContent);
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
    if (params.config.thinkingBudget !== undefined) {
      await setConfig({ thinkingBudget: params.config.thinkingBudget });
    }
  }

  currentSessionId = randomUUID();
  updateSession({ sessionId: currentSessionId });

  // Register this session in SQLite storage
  sessionStore.create(currentSessionId);

  // Get the current mode (should be "default" after reset)
  const mode = getSessionMode();
  info("New session created:", { sessionId: currentSessionId, mode });

  // Broadcast mode update to ensure all clients know the mode
  sendSessionNotification("mode_update", { type: "mode_update", mode });

  return { sessionId: currentSessionId, mode };
}

async function handleSessionLoad(params: LoadSessionParams): Promise<LoadSessionResult> {
  currentSessionId = params.sessionId;
  updateSession({ sessionId: params.sessionId });

  // Touch session in SQLite to update lastUsedAt
  sessionStore.touch(params.sessionId);

  // Get session mode from store and sync it
  const storedSession = sessionStore.get(params.sessionId);
  if (storedSession) {
    setSessionMode(storedSession.mode);
    sendSessionNotification("mode_update", { type: "mode_update", mode: storedSession.mode });
  }

  return {
    sessionId: params.sessionId,
    resumed: true,
  };
}

async function handleSessionList(): Promise<ListSessionsResult> {
  const sessions = sessionStore.list(50);

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

// File system handlers for remote @path expansion
async function handleFsReadTextFile(
  filePath: string,
  cwd?: string
): Promise<{ content: string | null; error?: string; path: string }> {
  const { resolve, isAbsolute } = await import("path");
  const absolutePath = isAbsolute(filePath) ? filePath : resolve(cwd || process.cwd(), filePath);

  try {
    const file = Bun.file(absolutePath);
    if (!(await file.exists())) {
      return { content: null, error: `File not found: ${absolutePath}`, path: absolutePath };
    }

    const content = await file.text();

    // Limit file size to prevent massive responses (1MB limit)
    if (content.length > 1024 * 1024) {
      return {
        content: content.slice(0, 1024 * 1024),
        error: `File truncated (>1MB)`,
        path: absolutePath,
      };
    }

    return { content, path: absolutePath };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: null, error: `Failed to read: ${msg}`, path: absolutePath };
  }
}

async function handleFsListDirectory(
  dirPath: string,
  cwd?: string
): Promise<{ entries: Array<{ name: string; type: "file" | "directory" }>; error?: string; path: string }> {
  const { resolve, isAbsolute, join } = await import("path");
  const { readdirSync, statSync } = await import("fs");
  const absolutePath = isAbsolute(dirPath) ? dirPath : resolve(cwd || process.cwd(), dirPath);

  try {
    const entries = readdirSync(absolutePath);
    const result = entries
      .filter((name) => !name.startsWith(".")) // Skip hidden files
      .slice(0, 100) // Limit to 100 entries
      .map((name) => {
        try {
          const stat = statSync(join(absolutePath, name));
          return { name, type: stat.isDirectory() ? "directory" as const : "file" as const };
        } catch {
          return { name, type: "file" as const };
        }
      });

    return { entries: result, path: absolutePath };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { entries: [], error: `Failed to list: ${msg}`, path: absolutePath };
  }
}

// ============================================================
// Agent Management Handlers
// ============================================================

async function handleAgentList(): Promise<AgentListResult> {
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
    currentAgent: currentAgentId,
  };
}

async function handleAgentSelect(params: AgentSelectParams): Promise<AgentSelectResult> {
  const { agentId } = params;

  // Check if there's a running task
  if (runningTaskId) {
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

  currentAgentId = agent.identity;
  info("Agent selected", { agentId: currentAgentId, protocol: agent.protocol });

  return {
    success: true,
    agentId: currentAgentId,
  };
}

function handleAgentStatus(): AgentStatusResult {
  const agent = getAgent(currentAgentId);

  return {
    currentAgent: currentAgentId,
    isRunning: runningTaskId !== null,
    protocol: agent?.protocol || "acp",
  };
}

// Handle incoming JSON-RPC request
async function handleRpcRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
  const { id, method, params } = request;

  debug("RPC request:", { id, method, paramsKeys: params ? Object.keys(params as object) : [] });

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

      // Queue Management
      case AcpMethod.QueueEnqueue:
        {
          const queueParams = params as QueueEnqueueParams;
          if (!queueParams.text) {
            throw new Error("Missing text parameter");
          }
          // Filter mode to only valid queue modes (execute is not valid for queue)
          const queueMode = queueParams.mode === "execute" ? undefined : queueParams.mode;
          const queued = promptQueue.enqueue(
            queueParams.text,
            queueParams.attachments,
            queueMode
          );
          result = {
            id: queued.id,
            position: promptQueue.length,
          } as QueueEnqueueResult;
        }
        break;

      case AcpMethod.QueueDequeue:
        {
          const dequeued = promptQueue.dequeue();
          result = {
            prompt: dequeued ? toQueuedPromptInfo(dequeued) : null,
            remaining: promptQueue.length,
          } as QueueDequeueResult;
        }
        break;

      case AcpMethod.QueuePeek:
        {
          const peeked = promptQueue.peek();
          result = {
            prompt: peeked ? toQueuedPromptInfo(peeked) : null,
            queueLength: promptQueue.length,
          } as QueuePeekResult;
        }
        break;

      case AcpMethod.QueueList:
        {
          const all = promptQueue.getAll();
          result = {
            prompts: all.map(toQueuedPromptInfo),
            processing: promptQueue.isProcessing,
          } as QueueListResult;
        }
        break;

      case AcpMethod.QueueRemove:
        {
          const removeParams = params as QueueRemoveParams;
          if (!removeParams.ids || !Array.isArray(removeParams.ids)) {
            throw new Error("Missing or invalid ids parameter");
          }
          const removed = promptQueue.remove(removeParams.ids);
          result = {
            removed: removed.length,
            remaining: promptQueue.length,
          } as QueueRemoveResult;
        }
        break;

      case AcpMethod.QueueClear:
        {
          const count = promptQueue.length;
          promptQueue.clear();
          result = {
            cleared: count,
          } as QueueClearResult;
        }
        break;

      // Bash Execution (for remote CLI)
      case AcpMethod.BashExecute:
        {
          const bashParams = params as { command: string; cwd?: string; timeout?: number };
          if (!bashParams.command) {
            throw new Error("Missing command parameter");
          }
          const cwd = bashParams.cwd || process.cwd();
          const timeout = bashParams.timeout || 30000;

          try {
            const proc = Bun.spawn(["bash", "-c", bashParams.command], {
              stdout: "pipe",
              stderr: "pipe",
              cwd,
            });

            const timeoutPromise = new Promise<never>((_, reject) => {
              setTimeout(() => {
                proc.kill();
                reject(new Error(`Command timed out after ${timeout}ms`));
              }, timeout);
            });

            const [stdout, stderr] = await Promise.race([
              Promise.all([
                new Response(proc.stdout).text(),
                new Response(proc.stderr).text(),
              ]),
              timeoutPromise,
            ]);

            const exitCode = await proc.exited;

            result = {
              stdout,
              stderr,
              exitCode,
            };
          } catch (err) {
            result = {
              stdout: "",
              stderr: err instanceof Error ? err.message : String(err),
              exitCode: 1,
            };
          }
        }
        break;

      case AcpMethod.GetCwd:
        result = { cwd: process.cwd() };
        break;

      // Agent Management
      case AcpMethod.AgentList:
        result = await handleAgentList();
        break;

      case AcpMethod.AgentSelect:
        result = await handleAgentSelect(params as AgentSelectParams);
        break;

      case AcpMethod.AgentStatus:
        result = handleAgentStatus();
        break;

      // Permission Management
      case AcpMethod.PermissionRespond:
        {
          const permParams = params as { requestId: string; optionId: string };
          if (!permParams.requestId || !permParams.optionId) {
            throw new Error("Missing requestId or optionId parameter");
          }
          const success = respondToPermission(permParams.requestId, permParams.optionId);
          result = { success };
        }
        break;

      case AcpMethod.PermissionCancel:
        {
          const permParams = params as { requestId: string };
          if (!permParams.requestId) {
            throw new Error("Missing requestId parameter");
          }
          const success = cancelPermission(permParams.requestId);
          result = { success };
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

