// Session management handlers

import { sessionStore, sessionOutputStore } from "../../utils/session-store";
import { sessionManager } from "../../core/session-manager";
import {
  getSessionMode,
  setSessionMode,
  getPlan,
  setPlan,
  clearPlan,
  setConfig,
  type PlanEntry,
} from "../../utils/config";
import {
  initializeAgent,
  isAgentRunning,
  getAgentSessionId,
  cancelTask,
  clearProjectDocsCache,
} from "../../core/agent-manager";
import { promptQueue } from "../../core/prompt-queue";
import { metrics, MetricNames } from "../../utils/metrics";
import { logStream } from "../../utils/log-stream";
import type {
  NewSessionParams,
  NewSessionResult,
  LoadSessionParams,
  LoadSessionResult,
  ListSessionsResult,
  PromptParams,
  PromptResult,
  CancelParams,
  CancelResult,
  SetModeParams,
  SetModeResult,
  GetSessionOutputsParams,
  GetSessionOutputsResult,
  SessionSyncInfo,
  Attachment,
} from "../../protocol/acp-types";

// ============================================================
// Session Handler Context
// ============================================================

export interface SessionHandlerContext {
  getCurrentSessionId: () => string | null;
  setCurrentSessionId: (id: string | null) => void;
  getRunningTaskId: () => string | null;
  setRunningTaskId: (id: string | null) => void;
  sendSessionNotification: (type: string, data: unknown) => void;
  storeAndBroadcastOutput: (
    outputType: string,
    content: string,
    extra?: { color?: string; toolName?: string }
  ) => void;
  executePrompt: (text: string, attachments?: Attachment[]) => Promise<void>;
}

// ============================================================
// Session List Handler
// ============================================================

export async function handleSessionList(ctx: SessionHandlerContext): Promise<ListSessionsResult> {
  const sessions = sessionStore.list(50);

  logStream.info("handleSessionList - returning currentSessionId:", {
    currentSessionId: ctx.getCurrentSessionId(),
    sessionCount: sessions.length,
  });

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
    currentSessionId: ctx.getCurrentSessionId(),
  };
}

// ============================================================
// Session Outputs Handler
// ============================================================

export interface SessionOutputsParams {
  sessionId?: string;
  afterSeq?: number;
}

export function handleSessionOutputs(
  params: SessionOutputsParams,
  ctx: SessionHandlerContext
): GetSessionOutputsResult {
  const sessionId = params.sessionId || ctx.getCurrentSessionId();
  if (!sessionId) {
    throw new Error("No session active");
  }

  const outputs =
    params.afterSeq !== undefined
      ? sessionOutputStore.getAfter(sessionId, params.afterSeq)
      : sessionOutputStore.getAll(sessionId);
  const syncInfo = sessionOutputStore.getSyncInfo(sessionId);

  return {
    sessionId,
    outputs: outputs.map((o) => ({
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
  };
}

// ============================================================
// Session Sync Handler
// ============================================================

export interface SessionSyncParams {
  sessionId?: string;
}

export function handleSessionSync(
  params: SessionSyncParams,
  ctx: SessionHandlerContext
): SessionSyncInfo {
  const sessionId = params.sessionId || ctx.getCurrentSessionId();
  if (!sessionId) {
    throw new Error("No session active");
  }

  const syncInfo = sessionOutputStore.getSyncInfo(sessionId);
  return {
    sessionId,
    count: syncInfo.count,
    lastSeq: syncInfo.lastSeq,
  };
}

// ============================================================
// Session Cancel Handler
// ============================================================

export async function handleSessionCancel(
  _params: CancelParams,
  ctx: SessionHandlerContext
): Promise<CancelResult> {
  const taskId = ctx.getRunningTaskId();
  if (!taskId) {
    return { cancelled: false };
  }

  const cancelled = await cancelTask(taskId);
  if (cancelled) {
    ctx.setRunningTaskId(null);
  }
  return { cancelled };
}

// ============================================================
// Session Mode Handlers
// ============================================================

export interface GetModeResult {
  mode: string;
}

export function handleSessionGetMode(): GetModeResult {
  return { mode: getSessionMode() };
}

export async function handleSessionSetMode(
  params: SetModeParams,
  ctx: SessionHandlerContext
): Promise<SetModeResult> {
  // Only support default and plan modes
  if (params.mode !== "default" && params.mode !== "plan") {
    throw new Error(`Unsupported mode: ${params.mode}. Supported modes: default, plan`);
  }

  setSessionMode(params.mode);

  // Broadcast mode change to SSE clients
  ctx.sendSessionNotification("mode_update", { type: "mode_update", mode: params.mode });

  return { mode: params.mode };
}

// ============================================================
// Session Plan Handlers
// ============================================================

export interface GetPlanResult {
  plan: PlanEntry[];
  mode: string;
}

export function handleSessionGetPlan(): GetPlanResult {
  return { plan: getPlan(), mode: getSessionMode() };
}

export interface SetPlanParams {
  plan: PlanEntry[];
}

export interface SetPlanResult {
  success: boolean;
  plan: PlanEntry[];
}

export function handleSessionSetPlan(
  params: SetPlanParams,
  ctx: SessionHandlerContext
): SetPlanResult {
  if (!params.plan || !Array.isArray(params.plan)) {
    throw new Error("Missing or invalid plan parameter");
  }
  const plan = setPlan(params.plan);
  // Broadcast plan update
  ctx.sendSessionNotification("plan_update", { type: "plan_update", entries: plan });
  return { success: true, plan };
}

export interface ClearPlanResult {
  success: boolean;
}

export function handleSessionClearPlan(ctx: SessionHandlerContext): ClearPlanResult {
  clearPlan();
  ctx.sendSessionNotification("plan_update", { type: "plan_update", entries: [] });
  return { success: true };
}

// ============================================================
// Session New Handler
// ============================================================

export async function handleSessionNew(
  params: NewSessionParams,
  ctx: SessionHandlerContext
): Promise<NewSessionResult & { mode?: string }> {
  logStream.info("Creating new session");
  metrics.incCounter(MetricNames.SESSIONS_CREATED);
  metrics.incGauge(MetricNames.ACTIVE_SESSIONS);

  // Reset session state via SessionManager
  sessionManager.resetForNewSession();
  clearProjectDocsCache(); // Force re-read of CLAUDE.md, AGENT.md, etc.

  if (params.config) {
    if (params.config.model) {
      await setConfig({ model: params.config.model });
    }
  }

  // Only start agent if not already running
  // Don't restart - Claude subprocess restarts are flaky and the existing session works fine
  if (!isAgentRunning()) {
    logStream.info("Agent not running, starting fresh");
    await initializeAgent();
  } else {
    logStream.info("Agent already running, reusing existing subprocess");
  }

  // Wait briefly for Claude's session ID from notifications (up to 3 seconds)
  // The onAgentSessionIdUpdated callback will update sessionManager.updateFromNotification()
  // which captures the Claude internal ID automatically
  let claudeId = sessionManager.getClaudeInternalId();
  if (!claudeId) {
    for (let i = 0; i < 30 && !claudeId; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      claudeId = sessionManager.getClaudeInternalId();
    }
  }

  // If we got a Claude ID, use it; otherwise create a new UUID
  // SessionManager handles storage synchronization automatically
  const newSessionId = claudeId || getAgentSessionId() || sessionManager.createSession();
  if (claudeId) {
    sessionManager.setSession(claudeId);
  }

  logStream.info("handleSessionNew - Session ID details:", {
    claudeInternalId: sessionManager.getClaudeInternalId(),
    currentSessionId: sessionManager.getCurrentId(),
  });

  // Get the current mode (should be "default" after reset)
  const mode = getSessionMode();
  logStream.info("New session created:", { sessionId: newSessionId, mode });

  // Broadcast mode update to ensure all clients know the mode
  ctx.sendSessionNotification("mode_update", { type: "mode_update", mode });

  return { sessionId: sessionManager.getCurrentId() || newSessionId, mode };
}

// ============================================================
// Session Load Handler
// ============================================================

export async function handleSessionLoad(
  params: LoadSessionParams,
  ctx: SessionHandlerContext
): Promise<LoadSessionResult> {
  // Load session via SessionManager - handles SQLite touch and persistence
  const sessionExists = sessionManager.loadSession(params.sessionId);

  // Get session mode from store and sync it
  const storedSession = sessionStore.get(params.sessionId);
  if (storedSession) {
    setSessionMode(storedSession.mode);
    ctx.sendSessionNotification("mode_update", { type: "mode_update", mode: storedSession.mode });
  }

  // Check if agent is already running
  const agentAlreadyRunning = isAgentRunning();

  if (agentAlreadyRunning) {
    // Agent already running - just use its current session
    // Don't restart as that would lose any in-progress context
    logStream.info("handleSessionLoad - agent already running, using current session");
  } else {
    // Agent not running - start it with resume option
    logStream.info("handleSessionLoad - starting agent with resume", {
      sessionId: params.sessionId,
    });
    await initializeAgent(undefined, undefined, { resumeSessionId: params.sessionId });
  }

  // Wait briefly for Claude's session ID from notifications (up to 3 seconds)
  let claudeId = sessionManager.getClaudeInternalId();
  if (!claudeId) {
    for (let i = 0; i < 30 && !claudeId; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      claudeId = sessionManager.getClaudeInternalId();
    }
  }

  // Check if resume succeeded using SessionManager
  const resumeSucceeded = claudeId ? sessionManager.verifyResume(params.sessionId) : false;

  if (!resumeSucceeded && claudeId) {
    // Resume failed - Claude created a new session instead
    logStream.warn("Session resume failed - Claude created new session", {
      requested: params.sessionId,
      received: claudeId,
    });
    // Update to the new session ID
    sessionManager.setSession(claudeId);
  }

  const displaySessionId = sessionManager.getCurrentId() || params.sessionId;

  logStream.info("handleSessionLoad - session loaded", {
    requestedSessionId: params.sessionId,
    claudeInternalId: sessionManager.getClaudeInternalId(),
    displaySessionId,
    resumeSucceeded,
    agentWasRunning: agentAlreadyRunning,
  });

  return {
    sessionId: displaySessionId,
    resumed: resumeSucceeded,
  };
}

// ============================================================
// Session Prompt Handler
// ============================================================

export async function handleSessionPrompt(
  params: PromptParams,
  ctx: SessionHandlerContext,
  handleSessionNewFn: (params: NewSessionParams) => Promise<NewSessionResult & { mode?: string }>
): Promise<PromptResult & { queued?: boolean; queuePosition?: number }> {
  metrics.incCounter(MetricNames.PROMPTS_TOTAL);

  // Auto-create session if needed
  if (!ctx.getCurrentSessionId()) {
    logStream.info("Auto-creating session for incoming prompt");
    await handleSessionNewFn({});
  }

  // Validate required params
  if (!params.text) {
    throw new Error("Missing required parameter: text");
  }

  // Store user message in output history
  if (ctx.getCurrentSessionId()) {
    const hasAttachments = params.attachments && params.attachments.length > 0;
    const displayText = hasAttachments
      ? `[${params.attachments!.length} attachment(s)]\n${params.text}`
      : params.text;
    ctx.storeAndBroadcastOutput("user", displayText);
  }

  // If a task is already running, queue this prompt
  if (ctx.getRunningTaskId()) {
    const queued = promptQueue.enqueue(params.text, params.attachments);
    metrics.incCounter(MetricNames.PROMPTS_QUEUED);
    metrics.setGauge(MetricNames.QUEUE_LENGTH, promptQueue.length);
    logStream.info(`Queued prompt (position ${promptQueue.length}): ${params.text.slice(0, 50)}...`);

    // Notify that the prompt was queued
    ctx.sendSessionNotification("prompt_queued", {
      type: "prompt_queued",
      promptId: queued.id,
      position: promptQueue.length,
      text: params.text.slice(0, 100),
    });

    return { success: true, queued: true, queuePosition: promptQueue.length };
  }

  // Execute immediately
  await ctx.executePrompt(params.text, params.attachments);
  return { success: true };
}
