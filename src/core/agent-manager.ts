// Agent Manager - manages agent lifecycle and prompt execution
// Uses ACP subprocess runner instead of Claude Agent SDK

import { createAgentRunner, type SubprocessAgentRunner, type AgentRunnerOptions } from "../agents/agent-runner";
import { initializeRegistry } from "../agents/registry";
import type { AgentRunner, PromptEvent, RunPromptOptions } from "../agents/types";
import type { AvailableCommandData } from "../protocol/acp-types";
import { getConfig } from "../utils/config";
import { taskStore } from "./tasks";
import { logStream } from "../utils/log-stream";
import { snapshotBaseline, resetBaseline } from "../utils/claude-usage";

function debug(message: string, data?: unknown): void {
  logStream.debug(`[agent-manager] ${message}`, data);
}

function info(message: string, data?: unknown): void {
  logStream.info(`[agent-manager] ${message}`, data);
}

function error(message: string, data?: unknown): void {
  logStream.error(`[agent-manager] ${message}`, data);
}

// Current agent runner
let currentRunner: AgentRunner | null = null;
let currentAgentId: string = "claude.com"; // Default to Claude Code ACP

// Running prompt handles for cancellation
const runningPrompts: Map<string, { cancel: () => Promise<void> }> = new Map();

// Callback for when agent commands are updated
let commandsCallback: ((commands: AvailableCommandData[]) => void) | null = null;

// Callback for agent stderr output
let stderrCallback: ((text: string) => void) | null = null;

// Callback for session ID updates (from agent notifications)
let sessionIdCallback: ((sessionId: string) => void) | null = null;

export interface InitializeAgentOptions {
  /** Session ID to resume (for Claude Code's session resume via _meta) */
  resumeSessionId?: string;
}

/**
 * Initialize the agent manager with an agent
 */
export async function initializeAgent(agentId?: string, cwd?: string, options?: InitializeAgentOptions): Promise<void> {
  const targetAgent = agentId || currentAgentId;
  const targetCwd = cwd || process.cwd();

  info("Initializing agent", { agentId: targetAgent, cwd: targetCwd, resumeSessionId: options?.resumeSessionId });

  // Ensure registry is loaded
  await initializeRegistry();

  // Stop existing runner if switching agents OR if resumeSessionId is provided
  // When resumeSessionId is provided, we MUST restart the agent to pass --resume to Claude CLI
  if (currentRunner && (currentAgentId !== targetAgent || options?.resumeSessionId)) {
    if (options?.resumeSessionId) {
      info("Stopping agent to restart with resume option", { resumeSessionId: options.resumeSessionId });
    }
    await stopAgent();
  }

  // Reuse existing runner if same agent is already running (and no resume requested)
  if (currentRunner && currentAgentId === targetAgent) {
    debug("Reusing existing agent runner", { agentId: targetAgent });
    return;
  }

  // Create and start new runner with resume option if provided
  const runnerOptions: AgentRunnerOptions = {};
  if (options?.resumeSessionId) {
    runnerOptions.resumeSessionId = options.resumeSessionId;
    info("Will resume session", { sessionId: options.resumeSessionId });
  }

  try {
    currentRunner = createAgentRunner(targetAgent, targetCwd, runnerOptions);

    // Register commands callback before starting (commands may be sent during init)
    if (currentRunner.onCommandsUpdated && commandsCallback) {
      currentRunner.onCommandsUpdated(commandsCallback);
    }

    // Register stderr callback for agent output
    if (currentRunner.onStderr && stderrCallback) {
      currentRunner.onStderr(stderrCallback);
    }

    // Register session ID callback (for when agent sends real session ID in notifications)
    if (currentRunner.onSessionIdUpdated && sessionIdCallback) {
      currentRunner.onSessionIdUpdated(sessionIdCallback);
    }

    await currentRunner.start();
    currentAgentId = targetAgent;
    info("Agent initialized", { agentId: targetAgent });

    // Snapshot Claude Code usage baseline for usage tracking
    if (targetAgent === "claude.com") {
      await snapshotBaseline();
    }
  } catch (err) {
    error("Failed to initialize agent", { agentId: targetAgent, error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

/**
 * Stop the current agent
 */
export async function stopAgent(): Promise<void> {
  if (currentRunner) {
    info("Stopping agent", { agentId: currentAgentId });
    await currentRunner.stop();
    currentRunner = null;
  }
}

/**
 * Get current agent ID
 */
export function getCurrentAgentId(): string {
  return currentAgentId;
}

/**
 * Set current agent ID
 */
export function setCurrentAgentId(id: string): void {
  currentAgentId = id;
}

/**
 * Check if agent subprocess is started and alive
 */
export function isAgentRunning(): boolean {
  return currentRunner?.isStarted() ?? false;
}

/**
 * Get the agent's internal session ID (from ACP session/new)
 * This is the session ID that Claude Code uses internally
 */
export function getAgentSessionId(): string | null {
  return currentRunner?.getSessionId() ?? null;
}

/**
 * Get Claude CLI's actual session ID (8-char format from notifications)
 * This is the ID that Claude Code uses for session persistence and resume
 */
export function getClaudeSessionId(): string | null {
  return currentRunner?.getClaudeSessionId?.() ?? null;
}

/**
 * Clear Claude CLI's session ID (for /clear command to reset session)
 */
export function clearClaudeSessionId(): void {
  currentRunner?.clearClaudeSessionId?.();
}

/**
 * Run a task using the current agent
 */
export async function runTask(taskId: string): Promise<void> {
  info("runTask called", { taskId });

  const task = taskStore.get(taskId);
  if (!task) {
    error("Task not found", { taskId });
    throw new Error(`Task ${taskId} not found`);
  }

  // Ensure agent is initialized
  const cwd = task.config.cwd || process.cwd();
  if (!currentRunner) {
    await initializeAgent(currentAgentId, cwd);
  }

  if (!currentRunner) {
    throw new Error("Failed to initialize agent");
  }

  debug("Task prompt", { preview: task.prompt.slice(0, 100) });
  taskStore.updateStatus(taskId, "running");
  taskStore.addEvent(taskId, "started");

  try {
    // Build prompt options
    const options: RunPromptOptions = {
      prompt: task.prompt,
      images: task.attachments?.filter(a => a.type === "image").map((a, i) => ({
        id: i + 1,
        path: `attachment-${i + 1}`,
        mediaType: (a.mimeType || "image/png") as "image/png" | "image/jpeg" | "image/gif" | "image/webp",
        base64: a.content,
      })),
    };

    // Run prompt
    const handle = currentRunner.runPrompt(options);
    runningPrompts.set(taskId, handle);

    let currentText = "";
    const startTime = Date.now();

    // Process events
    for await (const event of handle.events) {
      await processPromptEvent(taskId, event, { currentText: currentText });

      // Track accumulated text
      if (event.type === "text_delta") {
        currentText += (event.data as { text: string }).text;
      } else if (event.type === "text_complete") {
        currentText = "";
      }
    }

    // If we have accumulated text but no text_complete event, emit a final marker
    if (currentText) {
      taskStore.addEvent(taskId, "text_delta", { text: "", final: true });
    }

    // Check final status
    const finalTask = taskStore.get(taskId);
    if (finalTask?.status !== "cancelled") {
      const durationMs = Date.now() - startTime;
      taskStore.setResult(taskId, {
        success: true,
        durationMs,
        totalCostUsd: 0, // ACP doesn't provide cost info directly
        numTurns: 1,
        usage: { inputTokens: 0, outputTokens: 0 },
      });
      taskStore.updateStatus(taskId, "completed");
      taskStore.addEvent(taskId, "completed", { durationMs });
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    if (errorMessage.includes("aborted") || errorMessage.includes("cancelled")) {
      taskStore.updateStatus(taskId, "cancelled");
      taskStore.addEvent(taskId, "cancelled");
    } else {
      taskStore.setError(taskId, errorMessage);
      taskStore.updateStatus(taskId, "failed");
      taskStore.addEvent(taskId, "failed", { error: errorMessage });
    }
  } finally {
    runningPrompts.delete(taskId);
  }
}

/**
 * Process a prompt event and emit corresponding task events
 */
async function processPromptEvent(
  taskId: string,
  event: PromptEvent,
  state: { currentText: string }
): Promise<void> {
  switch (event.type) {
    case "init":
      debug("Session initialized", event.data);
      break;

    case "text_delta":
      // Emit delta for incremental streaming display
      taskStore.addEvent(taskId, "text_delta", {
        text: (event.data as { text: string }).text
      });
      break;

    case "text_complete":
      // Just emit a marker to finalize the streaming text (no content since it was already streamed)
      taskStore.addEvent(taskId, "text_delta", {
        text: "",
        final: true
      });
      break;

    case "tool_use": {
      const data = event.data as {
        toolCallId: string;
        name: string;
        input: Record<string, unknown>;
        title?: string;
        kind?: string;
        status?: string;
        locations?: Array<{ path: string; line?: number }>;
        content?: unknown[];
      };
      taskStore.addEvent(taskId, "tool_use", {
        toolCallId: data.toolCallId,
        toolName: data.title || data.name,
        toolInput: data.input,
        kind: data.kind,
        status: data.status,
        locations: data.locations,
        content: data.content,
      });
      break;
    }

    case "tool_result": {
      const data = event.data as {
        toolCallId: string;
        status: string;
        content?: unknown;
        locations?: Array<{ path: string; line?: number }>;
        richContent?: unknown[];
      };
      taskStore.addEvent(taskId, "tool_result", {
        toolCallId: data.toolCallId,
        status: data.status,
        content: data.content,
        locations: data.locations,
        richContent: data.richContent,
      });
      break;
    }

    case "thinking":
      // Could emit as system_message or separate event type
      debug("Agent thinking", event.data);
      break;

    case "result": {
      const data = event.data as {
        success: boolean;
        stopReason?: string;
        durationMs?: number;
        totalCostUsd?: number;
        numTurns?: number;
        inputTokens?: number;
        outputTokens?: number;
      };
      if (data.durationMs !== undefined) {
        taskStore.setResult(taskId, {
          success: data.success,
          durationMs: data.durationMs,
          totalCostUsd: data.totalCostUsd || 0,
          numTurns: data.numTurns || 1,
          usage: {
            inputTokens: data.inputTokens || 0,
            outputTokens: data.outputTokens || 0,
          },
        });
      }
      break;
    }

    case "error": {
      const data = event.data as { message: string };
      taskStore.setError(taskId, data.message);
      taskStore.updateStatus(taskId, "failed");
      taskStore.addEvent(taskId, "failed", { error: data.message });
      break;
    }

    case "cancelled":
      taskStore.updateStatus(taskId, "cancelled");
      taskStore.addEvent(taskId, "cancelled");
      break;

    case "permission_request": {
      const data = event.data as {
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
      };
      taskStore.addEvent(taskId, "permission_request", {
        requestId: data.requestId,
        toolCall: data.toolCall,
        options: data.options,
      });
      break;
    }

    case "available_commands": {
      const data = event.data as {
        commands: AvailableCommandData[];
      };
      taskStore.addEvent(taskId, "available_commands", {
        commands: data.commands,
      });
      break;
    }
  }
}

/**
 * Cancel a running task
 */
export async function cancelTask(taskId: string): Promise<boolean> {
  const handle = runningPrompts.get(taskId);
  if (handle) {
    taskStore.updateStatus(taskId, "cancelled");
    await handle.cancel();
    return true;
  }
  return false;
}

/**
 * Check if a task is running
 */
export function isTaskRunning(taskId: string): boolean {
  return runningPrompts.has(taskId);
}

/**
 * Select a different agent
 */
export async function selectAgent(agentId: string, cwd?: string): Promise<void> {
  await initializeAgent(agentId, cwd);
}

/**
 * Get list of available agents
 */
export function listAgents(): Array<{
  identity: string;
  name: string;
  description: string;
  active: boolean;
}> {
  // Import registry functions
  const { listAgents: getRegistryAgents } = require("../agents/registry");
  const agents = getRegistryAgents();

  return agents.map((agent: { identity: string; name: string; description?: string; active?: boolean }) => ({
    identity: agent.identity,
    name: agent.name,
    description: agent.description || "",
    active: agent.identity === currentAgentId,
  }));
}

/**
 * Clear cached project docs (no-op for ACP subprocess mode)
 * In ACP mode, each session has its own context management
 */
export function clearProjectDocsCache(): void {
  // No-op - ACP subprocess handles its own session/context
  debug("clearProjectDocsCache called (no-op in ACP mode)");
}

/**
 * Mark docs for re-injection (no-op for ACP subprocess mode)
 * In ACP mode, the subprocess manages its own context
 */
export function markDocsForReinjection(): void {
  // No-op - ACP subprocess handles its own context
  debug("markDocsForReinjection called (no-op in ACP mode)");
}

/**
 * Respond to a pending permission request
 */
export function respondToPermission(requestId: string, optionId: string): boolean {
  if (currentRunner?.respondToPermission) {
    return currentRunner.respondToPermission(requestId, optionId);
  }
  return false;
}

/**
 * Cancel a pending permission request
 */
export function cancelPermission(requestId: string): boolean {
  if (currentRunner?.cancelPermission) {
    return currentRunner.cancelPermission(requestId);
  }
  return false;
}

/**
 * Get available commands from the current agent
 */
export function getAgentCommands(): AvailableCommandData[] {
  if (currentRunner?.getAvailableCommands) {
    return currentRunner.getAvailableCommands();
  }
  return [];
}

/**
 * Set a callback to be notified when agent commands are updated
 */
export function onAgentCommandsUpdated(callback: ((commands: AvailableCommandData[]) => void) | null): void {
  // Store the callback for future runners
  commandsCallback = callback;

  // Register on current runner if exists
  if (currentRunner?.onCommandsUpdated) {
    currentRunner.onCommandsUpdated(callback);
  }
}

/**
 * Set a callback to receive agent stderr output (for popup display)
 */
export function onAgentStderr(callback: ((text: string) => void) | null): void {
  // Store the callback for future runners
  stderrCallback = callback;

  // Register on current runner if exists
  if (currentRunner?.onStderr) {
    currentRunner.onStderr(callback);
  }
}

/**
 * Set a callback to be notified when the agent's session ID is updated.
 * This is needed because some agents (like Claude Code) send the real session ID
 * in notifications rather than in the session/new response.
 */
export function onAgentSessionIdUpdated(callback: ((sessionId: string) => void) | null): void {
  // Store the callback for future runners
  sessionIdCallback = callback;

  // Register on current runner if exists
  if (currentRunner?.onSessionIdUpdated) {
    currentRunner.onSessionIdUpdated(callback);
  }
}
