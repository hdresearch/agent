// Agent Runner - unified interface for running agents
// Supports both direct SDK mode and subprocess ACP mode

import type {
  AgentRunner,
  AgentDefinition,
  PromptHandle,
  PromptEvent,
  RunPromptOptions,
  AcpSessionUpdate,
  AcpAgentMessageChunk,
  AcpAgentThoughtChunk,
  AcpToolCall,
  AcpToolCallUpdate,
  AcpPlan,
  AcpAvailableCommandsUpdate,
  AcpContentBlock,
  AcpRequestPermissionParams,
  AcpRequestPermissionResult,
} from "./types";
import type { AvailableCommandData } from "../protocol/acp-types";
import { getAgent, getRunCommand, getAgentEnv, ensureAgentInstalled } from "./registry";
import { SubprocessManager, getSubprocessManager } from "./subprocess-manager";
import { AcpClient, createContentBlocks } from "./acp-client";
import { AcpServer } from "./acp-server";
import { getAgentConfig } from "./configs";
import { logStream } from "../utils/log-stream";
import { cleanTitle } from "../utils/string-utils";
// Note: Claude Agent SDK has been removed. All agents use ACP subprocess mode.

// ============================================================
// Subprocess Agent Runner
// ============================================================

// Pending permission request awaiting user response
interface PendingPermissionRequest {
  resolve: (result: AcpRequestPermissionResult) => void;
  params: AcpRequestPermissionParams;
}

export interface AgentRunnerOptions {
  /** Session ID to resume (for Claude Code's --resume flag) */
  resumeSessionId?: string;
}

export class SubprocessAgentRunner implements AgentRunner {
  readonly agentId: string;
  private agent: AgentDefinition;
  private cwd: string;
  private subprocess: SubprocessManager;
  private client: AcpClient | null = null;
  private server: AcpServer;
  private config: import("../protocol/acp-types").AcpAgentConfig | null = null;
  private started = false;
  private running = false;
  private currentEventTarget: EventTarget | null = null;
  private currentAbortController: AbortController | null = null;
  private pendingPermissions: Map<string, PendingPermissionRequest> = new Map();
  private permissionRequestCounter = 0;
  private availableCommands: AvailableCommandData[] = [];
  private commandsCallback: ((commands: AvailableCommandData[]) => void) | null = null;
  private stderrCallback: ((text: string) => void) | null = null;
  private sessionIdCallback: ((sessionId: string) => void) | null = null;
  private options: AgentRunnerOptions;

  constructor(agent: AgentDefinition, cwd: string, options?: AgentRunnerOptions) {
    this.agentId = agent.identity;
    this.agent = agent;
    this.cwd = cwd;
    this.options = options || {};
    this.subprocess = getSubprocessManager();
    this.server = new AcpServer(cwd);

    // Set up request handler for subprocess
    this.subprocess.onRequest(this.handleAgentRequest.bind(this));

    // Set up notification handler for subprocess (for session/update notifications)
    this.subprocess.onNotification(this.handleAgentNotification.bind(this));

    // Set up stderr handler for agent output (like /usage command output)
    this.subprocess.onStderr(this.handleAgentStderr.bind(this));

    // Set up permission handler to emit events and wait for user response
    this.server.onPermissionRequest(this.handlePermissionRequest.bind(this));
  }

  /**
   * Handle stderr output from the agent subprocess.
   * This captures command output like /usage that goes to stderr.
   */
  private handleAgentStderr(agentId: string, text: string): void {
    if (agentId !== this.agentId) return;

    // Check if this stderr message should be filtered (agent-specific)
    if (this.config?.stderrFilter?.(text)) {
      // Log to file but don't show to user
      logStream.debug(`Filtered agent stderr: ${text.trim()}`);
      return;
    }

    // Emit as event if we have an active event target
    if (this.currentEventTarget) {
      const event: PromptEvent = {
        type: "error", // Use error type to carry stderr
        data: { message: text, isAgentOutput: true }
      };
      this.currentEventTarget.dispatchEvent(new CustomEvent("prompt-event", { detail: event }));
    }

    // Also notify via callback if registered (for when no prompt is running)
    if (this.stderrCallback) {
      this.stderrCallback(text);
    }
  }

  /**
   * Handle a permission request from the agent.
   * Emits an event and waits for respondToPermission to be called.
   */
  private async handlePermissionRequest(
    _agentId: string,
    params: AcpRequestPermissionParams
  ): Promise<AcpRequestPermissionResult> {
    // Generate unique request ID
    const requestId = `perm-${++this.permissionRequestCounter}`;

    // Create promise that will be resolved when respondToPermission is called
    return new Promise((resolve) => {
      // Store the pending request
      this.pendingPermissions.set(requestId, { resolve, params });

      // Emit permission request event
      if (this.currentEventTarget) {
        // Use title with fallback to toolCallId or "Tool" - never show "undefined"
        const permissionTitle = cleanTitle(params.toolCall.title) || params.toolCall.toolCallId || "Tool";
        const event: PromptEvent = {
          type: "permission_request",
          data: {
            requestId,
            toolCall: {
              toolCallId: params.toolCall.toolCallId,
              title: permissionTitle,
              kind: params.toolCall.kind,
              status: params.toolCall.status,
              locations: params.toolCall.locations,
              content: params.toolCall.content,
            },
            options: params.options.map((opt) => ({
              optionId: opt.optionId,
              kind: opt.kind,
              name: opt.name,
            })),
          },
        };
        this.currentEventTarget.dispatchEvent(
          new CustomEvent("prompt-event", { detail: event })
        );
      } else {
        // No event target - auto-approve (fallback behavior)
        const allowOption = params.options.find(
          (opt) => opt.kind === "allow_once" || opt.kind === "allow_always"
        );
        resolve({
          outcome: {
            outcome: "selected",
            optionId: allowOption?.optionId ?? params.options[0]?.optionId ?? "allow",
          },
        });
        this.pendingPermissions.delete(requestId);
      }
    });
  }

  /**
   * Respond to a pending permission request.
   * Called by external code (e.g., CLI) when user makes a selection.
   */
  respondToPermission(requestId: string, optionId: string): boolean {
    const pending = this.pendingPermissions.get(requestId);
    if (!pending) {
      return false;
    }

    // Resolve the promise with the selected option
    pending.resolve({
      outcome: {
        outcome: "selected",
        optionId,
      },
    });

    // Clean up
    this.pendingPermissions.delete(requestId);
    return true;
  }

  /**
   * Cancel a pending permission request.
   */
  cancelPermission(requestId: string): boolean {
    const pending = this.pendingPermissions.get(requestId);
    if (!pending) {
      return false;
    }

    // Resolve the promise with cancelled outcome
    pending.resolve({
      outcome: {
        outcome: "cancelled",
      },
    });

    // Clean up
    this.pendingPermissions.delete(requestId);
    return true;
  }

  async start(): Promise<void> {
    if (this.started) return;

    const command = getRunCommand(this.agent);
    if (!command) {
      throw new Error(
        `No run command for ${this.agent.identity} on ${process.platform}`
      );
    }

    // Ensure agent is installed (will auto-install if needed)
    const installResult = await ensureAgentInstalled(this.agent);
    if (!installResult.success) {
      throw new Error(installResult.message);
    }

    const env = getAgentEnv(this.agent);

    // Spawn the subprocess
    await this.subprocess.spawn(this.agentId, command, env, this.cwd);

    // Get agent-specific config
    this.config = getAgentConfig(this.agentId);

    // Create client with config
    this.client = new AcpClient(this.subprocess, this.agentId, this.config);

    // Initialize ACP connection
    await this.client.initialize();

    // Create session (with optional resume)
    if (this.options.resumeSessionId) {
      logStream.info(`Resuming session with ID: ${this.options.resumeSessionId}`);
    }
    await this.client.sessionNew(this.cwd, undefined, this.options.resumeSessionId);

    this.started = true;
  }

  async stop(): Promise<void> {
    if (!this.started) return;

    // Cancel any running prompt
    if (this.currentAbortController) {
      this.currentAbortController.abort();
    }

    // Clean up server resources
    this.server.cleanup();

    // Stop subprocess
    await this.subprocess.stop(this.agentId);

    this.started = false;
    this.client = null;
  }

  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get the agent's internal session ID (from ACP session/new)
   */
  getSessionId(): string | null {
    return this.client?.getSessionId() ?? null;
  }

  /**
   * Get Claude CLI's actual session ID (8-char format from notifications)
   * This is the ID needed for session resume
   */
  getClaudeSessionId(): string | null {
    return this.client?.getClaudeSessionId() ?? null;
  }

  /**
   * Get the available commands from the agent
   */
  getAvailableCommands(): AvailableCommandData[] {
    return this.availableCommands;
  }

  /**
   * Set a callback to be notified when commands are updated
   */
  onCommandsUpdated(callback: ((commands: AvailableCommandData[]) => void) | null): void {
    this.commandsCallback = callback;
  }

  onStderr(callback: ((text: string) => void) | null): void {
    this.stderrCallback = callback;
  }

  onSessionIdUpdated(callback: ((sessionId: string) => void) | null): void {
    this.sessionIdCallback = callback;
  }

  runPrompt(options: RunPromptOptions): PromptHandle {
    if (!this.started || !this.client) {
      throw new Error("Agent not started - call start() first");
    }

    this.running = true;
    const abortController = new AbortController();
    this.currentAbortController = abortController;

    // Create event target for streaming updates
    const eventTarget = new EventTarget();
    this.currentEventTarget = eventTarget;

    // Session updates are handled via handleAgentNotification (registered in constructor)
    // which forwards notifications to this.currentEventTarget

    // Create content blocks
    const contentBlocks = this.buildContentBlocks(options);

    // Start the prompt in background
    const promptPromise = this.executePrompt(contentBlocks, eventTarget, abortController);

    return {
      events: this.createEventIterator(eventTarget, promptPromise, abortController),
      cancel: async () => {
        abortController.abort();
        if (this.client) {
          await this.client.sessionCancel();
        }
      },
      isRunning: () => this.running,
    };
  }

  private buildContentBlocks(options: RunPromptOptions): AcpContentBlock[] {
    const blocks: AcpContentBlock[] = [];

    // Add text
    if (options.prompt) {
      blocks.push({ type: "text", text: options.prompt });
    }

    // Add images
    if (options.images) {
      for (const img of options.images) {
        if (img.base64 && !img.error) {
          blocks.push({
            type: "image",
            data: img.base64,
            mimeType: img.mediaType,
          });
        }
      }
    }

    // Add attachments
    if (options.attachments) {
      for (const att of options.attachments) {
        if (att.type === "image" && att.content) {
          blocks.push({
            type: "image",
            data: att.content,
            mimeType: att.mimeType || "image/png",
          });
        }
      }
    }

    return blocks;
  }

  private async executePrompt(
    contentBlocks: AcpContentBlock[],
    eventTarget: EventTarget,
    abortController: AbortController
  ): Promise<void> {
    try {
      // Send init event
      eventTarget.dispatchEvent(
        new CustomEvent("prompt-event", {
          detail: {
            type: "init",
            data: {
              sessionId: this.client!.getSessionId() || "",
              resumed: false,
            },
          } as PromptEvent,
        })
      );

      // Send prompt and wait for completion
      const result = await this.client!.sessionPrompt(contentBlocks);

      // Send result event
      eventTarget.dispatchEvent(
        new CustomEvent("prompt-event", {
          detail: {
            type: "result",
            data: {
              success: result.stopReason === "end_turn",
              stopReason: result.stopReason,
            },
          } as PromptEvent,
        })
      );
    } catch (error) {
      if (abortController.signal.aborted) {
        eventTarget.dispatchEvent(
          new CustomEvent("prompt-event", {
            detail: { type: "cancelled", data: {} } as PromptEvent,
          })
        );
      } else {
        eventTarget.dispatchEvent(
          new CustomEvent("prompt-event", {
            detail: {
              type: "error",
              data: {
                message: error instanceof Error ? error.message : String(error),
              },
            } as PromptEvent,
          })
        );
      }
    } finally {
      this.running = false;
      this.currentEventTarget = null;
      this.currentAbortController = null;

      // Dispatch done event
      eventTarget.dispatchEvent(new CustomEvent("done"));
    }
  }

  private async *createEventIterator(
    eventTarget: EventTarget,
    promptPromise: Promise<void>,
    abortController: AbortController
  ): AsyncIterable<PromptEvent> {
    const eventQueue: PromptEvent[] = [];
    let resolveNext: (() => void) | null = null;
    let done = false;

    // Listen for events
    const eventHandler = (e: Event) => {
      const event = (e as CustomEvent).detail as PromptEvent;
      eventQueue.push(event);
      if (resolveNext) {
        resolveNext();
        resolveNext = null;
      }
    };

    const doneHandler = () => {
      done = true;
      if (resolveNext) {
        resolveNext();
        resolveNext = null;
      }
    };

    eventTarget.addEventListener("prompt-event", eventHandler);
    eventTarget.addEventListener("done", doneHandler);

    try {
      while (!done || eventQueue.length > 0) {
        if (eventQueue.length > 0) {
          yield eventQueue.shift()!;
        } else if (!done) {
          await new Promise<void>(resolve => {
            resolveNext = resolve;
          });
        }
      }
    } finally {
      eventTarget.removeEventListener("prompt-event", eventHandler);
      eventTarget.removeEventListener("done", doneHandler);
    }
  }

  private mapSessionUpdateToPromptEvent(update: AcpSessionUpdate): PromptEvent | null {
    switch (update.sessionUpdate) {
      case "agent_message_chunk": {
        const chunk = update as AcpAgentMessageChunk;
        if (chunk.content.type === "text") {
          return {
            type: "text_delta",
            data: { text: chunk.content.text },
          };
        }
        return null;
      }

      case "agent_thought_chunk": {
        const thought = update as AcpAgentThoughtChunk;
        if (thought.content.type === "text") {
          return {
            type: "thinking",
            data: { thinking: thought.content.text },
          };
        }
        return null;
      }

      case "tool_call": {
        const toolCall = update as AcpToolCall;
        // Use cleaned title if valid, fallback to toolCallId or "Tool"
        const displayTitle = cleanTitle(toolCall.title) || toolCall.toolCallId || "Tool";
        return {
          type: "tool_use",
          data: {
            toolCallId: toolCall.toolCallId,
            name: displayTitle,
            input: toolCall.rawInput || {},
            title: displayTitle,
            kind: toolCall.kind,
            status: toolCall.status,
            locations: toolCall.locations,
            content: toolCall.content,
          },
        };
      }

      case "tool_call_update": {
        const toolUpdate = update as AcpToolCallUpdate;
        if (toolUpdate.status) {
          return {
            type: "tool_result",
            data: {
              toolCallId: toolUpdate.toolCallId,
              status: toolUpdate.status,
              content: toolUpdate.rawOutput,
              locations: toolUpdate.locations,
              richContent: toolUpdate.content,
            },
          };
        }
        return null;
      }

      case "plan": {
        // Plans are handled separately, not mapped to PromptEvent
        return null;
      }

      case "available_commands_update": {
        const commandsUpdate = update as AcpAvailableCommandsUpdate;
        return {
          type: "available_commands",
          data: { commands: commandsUpdate.availableCommands },
        };
      }

      default:
        return null;
    }
  }

  private async handleAgentRequest(
    agentId: string,
    request: import("../protocol/jsonrpc").JsonRpcRequest
  ): Promise<unknown> {
    return this.server.handleRequest(agentId, request);
  }

  private handleAgentNotification(
    agentId: string,
    notification: import("../protocol/jsonrpc").JsonRpcNotification
  ): void {
    // Debug: log all notifications
    logStream.debug(`Notification: ${notification.method}`, JSON.stringify(notification.params).slice(0, 200));

    // Handle session/update notifications
    if (notification.method === "session/update" && notification.params) {
      const params = notification.params as {
        sessionId: string;
        update: AcpSessionUpdate;
      };

      // Update session ID if it differs from what we have stored
      // Some agents (like Claude Code) send the real session ID in notifications
      // rather than in the session/new response
      if (params.sessionId && this.client) {
        // Capture Claude's actual session ID (the first one from notifications)
        // This is Claude CLI's 8-char session ID, which we need for resume
        if (!this.client.getClaudeSessionId()) {
          logStream.info(`Captured Claude session ID: ${params.sessionId}`);
          this.client.setClaudeSessionId(params.sessionId);
        }

        const currentSessionId = this.client.getSessionId();
        logStream.debug(`Session ID check: notification=${params.sessionId}, client=${currentSessionId}, callback=${!!this.sessionIdCallback}`);
        if (currentSessionId !== params.sessionId) {
          logStream.debug(`Updating session ID from notification: ${params.sessionId} (was: ${currentSessionId})`);
          this.client.setSessionId(params.sessionId);
          // Notify via callback so http-server can update its session ID
          if (this.sessionIdCallback) {
            logStream.debug(`Calling sessionIdCallback with: ${params.sessionId}`);
            this.sessionIdCallback(params.sessionId);
          }
        } else {
          logStream.debug(`Session ID already matches, no update needed`);
        }
      }

      logStream.debug(`Session update type: ${params.update.sessionUpdate}`);

      // Handle available_commands_update specially - store even without running prompt
      if (params.update.sessionUpdate === "available_commands_update") {
        const commandsUpdate = params.update as AcpAvailableCommandsUpdate;
        this.availableCommands = commandsUpdate.availableCommands || [];
        logStream.debug(`Got ${this.availableCommands.length} commands, callback: ${!!this.commandsCallback}`);
        if (this.commandsCallback) {
          this.commandsCallback(this.availableCommands);
        }
      }

      // Forward to the current event target if we're running a prompt
      if (this.currentEventTarget) {
        const event = this.mapSessionUpdateToPromptEvent(params.update);
        if (event) {
          this.currentEventTarget.dispatchEvent(
            new CustomEvent("prompt-event", { detail: event })
          );
        }
      }
    }
  }
}

// ============================================================
// Factory Function
// ============================================================

/**
 * Create an agent runner for the specified agent
 * @param agentId - Agent identity (must be an ACP agent)
 * @param cwd - Working directory for the agent
 * @param options - Optional configuration including resumeSessionId
 */
export function createAgentRunner(agentId: string, cwd: string, options?: AgentRunnerOptions): AgentRunner {
  // Look up agent in registry
  const agent = getAgent(agentId);
  if (!agent) {
    throw new Error(`Unknown agent: ${agentId}. Use /agent list to see available agents.`);
  }

  // All agents now use ACP subprocess mode
  if (agent.protocol !== "acp") {
    throw new Error(`Agent ${agentId} uses unsupported protocol: ${agent.protocol}. Only ACP agents are supported.`);
  }

  return new SubprocessAgentRunner(agent, cwd, options);
}
