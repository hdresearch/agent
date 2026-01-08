// Agent Manager - manages agent lifecycle and prompt execution
// Uses ACP subprocess runner instead of Claude Agent SDK

import { createAgentRunner, type SubprocessAgentRunner } from "../agents/agent-runner";
import { initializeRegistry } from "../agents/registry";
import type { AgentRunner, PromptEvent, RunPromptOptions } from "../agents/types";
import { getConfig } from "../utils/config";
import { taskStore } from "./tasks";
import { logStream } from "../utils/log-stream";

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

/**
 * Initialize the agent manager with an agent
 */
export async function initializeAgent(agentId?: string, cwd?: string): Promise<void> {
  const targetAgent = agentId || currentAgentId;
  const targetCwd = cwd || process.cwd();

  info("Initializing agent", { agentId: targetAgent, cwd: targetCwd });

  // Ensure registry is loaded
  await initializeRegistry();

  // Stop existing runner if switching agents
  if (currentRunner && currentAgentId !== targetAgent) {
    await stopAgent();
  }

  // Reuse existing runner if same agent is already running
  if (currentRunner && currentAgentId === targetAgent) {
    debug("Reusing existing agent runner", { agentId: targetAgent });
    return;
  }

  // Create and start new runner
  try {
    currentRunner = createAgentRunner(targetAgent, targetCwd);
    await currentRunner.start();
    currentAgentId = targetAgent;
    info("Agent initialized", { agentId: targetAgent });
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
 * Check if agent is running
 */
export function isAgentRunning(): boolean {
  return currentRunner?.isRunning() ?? false;
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

    // If we have accumulated text but no text_complete event, add it now
    if (currentText) {
      taskStore.addEvent(taskId, "assistant_message", { text: currentText });
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
      // Accumulate text, will emit assistant_message on text_complete
      break;

    case "text_complete":
      taskStore.addEvent(taskId, "assistant_message", {
        text: (event.data as { text: string }).text
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
