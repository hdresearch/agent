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
  AcpContentBlock,
  AcpRequestPermissionParams,
  AcpRequestPermissionResult,
} from "./types";
import { getAgent, getRunCommand, getAgentEnv, ensureAgentInstalled } from "./registry";
import { SubprocessManager, getSubprocessManager } from "./subprocess-manager";
import { AcpClient, createContentBlocks } from "./acp-client";
import { AcpServer } from "./acp-server";
// Note: Claude Agent SDK has been removed. All agents use ACP subprocess mode.

// ============================================================
// Subprocess Agent Runner
// ============================================================

// Pending permission request awaiting user response
interface PendingPermissionRequest {
  resolve: (result: AcpRequestPermissionResult) => void;
  params: AcpRequestPermissionParams;
}

export class SubprocessAgentRunner implements AgentRunner {
  readonly agentId: string;
  private agent: AgentDefinition;
  private cwd: string;
  private subprocess: SubprocessManager;
  private client: AcpClient | null = null;
  private server: AcpServer;
  private started = false;
  private running = false;
  private currentEventTarget: EventTarget | null = null;
  private currentAbortController: AbortController | null = null;
  private pendingPermissions: Map<string, PendingPermissionRequest> = new Map();
  private permissionRequestCounter = 0;

  constructor(agent: AgentDefinition, cwd: string) {
    this.agentId = agent.identity;
    this.agent = agent;
    this.cwd = cwd;
    this.subprocess = getSubprocessManager();
    this.server = new AcpServer(cwd);

    // Set up request handler for subprocess
    this.subprocess.onRequest(this.handleAgentRequest.bind(this));

    // Set up notification handler for subprocess (for session/update notifications)
    this.subprocess.onNotification(this.handleAgentNotification.bind(this));

    // Set up permission handler to emit events and wait for user response
    this.server.onPermissionRequest(this.handlePermissionRequest.bind(this));
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
        // Filter out invalid titles (undefined, empty, or literal "undefined" strings)
        const isValidTitle = (s: string | undefined): boolean =>
          !!s && s !== "undefined" && s !== '"undefined"' && s.trim() !== "";
        // Use title with fallback to toolCallId or "Tool" - never show "undefined"
        const permissionTitle = isValidTitle(params.toolCall.title)
          ? params.toolCall.title!
          : (params.toolCall.toolCallId || "Tool");
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

    // Create client
    this.client = new AcpClient(this.subprocess, this.agentId);

    // Initialize ACP connection
    await this.client.initialize();

    // Create session
    await this.client.sessionNew(this.cwd);

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
        // Filter out invalid titles (undefined, empty, or literal "undefined" strings)
        const isValidTitle = (s: string | undefined): boolean =>
          !!s && s !== "undefined" && s !== '"undefined"' && s.trim() !== "";
        // Use title if valid, fallback to toolCallId or "Tool"
        const displayTitle = isValidTitle(toolCall.title) ? toolCall.title : (toolCall.toolCallId || "Tool");
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
    // Handle session/update notifications
    if (notification.method === "session/update" && notification.params) {
      const params = notification.params as {
        sessionId: string;
        update: AcpSessionUpdate;
      };

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
 */
export function createAgentRunner(agentId: string, cwd: string): AgentRunner {
  // Look up agent in registry
  const agent = getAgent(agentId);
  if (!agent) {
    throw new Error(`Unknown agent: ${agentId}. Use /agent list to see available agents.`);
  }

  // All agents now use ACP subprocess mode
  if (agent.protocol !== "acp") {
    throw new Error(`Agent ${agentId} uses unsupported protocol: ${agent.protocol}. Only ACP agents are supported.`);
  }

  return new SubprocessAgentRunner(agent, cwd);
}
