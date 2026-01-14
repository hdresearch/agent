// Subprocess manager for ACP agent processes
// Handles spawning, communication via stdin/stdout JSON-RPC, and lifecycle

import type { FileSink } from "bun";
import type {
  PendingRequest,
  RequestHandler,
  NotificationHandler,
  AcpAgentCapabilities,
} from "./types";

// Properly typed subprocess with pipe I/O
interface PipedSubprocess {
  stdin: FileSink;
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  pid: number;
  killed: boolean;
  exitCode: number | null;
  kill(signal?: number | NodeJS.Signals): void;
  unref(): void;
  ref(): void;
}

// Subprocess state with properly typed process
export interface SubprocessState {
  process: PipedSubprocess;
  agentId: string;
  sessionId: string | null;
  isReady: boolean;
  capabilities: AcpAgentCapabilities;
  pendingRequests: Map<number | string, PendingRequest>;
  requestId: number;
}

import {
  type JsonRpcRequest,
  type JsonRpcResponse,
  type JsonRpcNotification,
  JSONRPC_VERSION,
  isJsonRpcResponse,
  isJsonRpcRequest,
  isJsonRpcNotification,
  createRequest,
  createResponse,
  createErrorResponse,
  ErrorCode,
} from "../protocol/jsonrpc";
import { logStream } from "../utils/log-stream";

// ============================================================
// Subprocess Manager
// ============================================================

// Handler for stderr output from agents
export type StderrHandler = (agentId: string, text: string) => void;

export class SubprocessManager {
  private processes: Map<string, SubprocessState> = new Map();
  private requestHandler: RequestHandler | null = null;
  private notificationHandler: NotificationHandler | null = null;
  private stderrHandler: StderrHandler | null = null;
  private defaultTimeout: number;

  constructor(defaultTimeout = 60000) {
    this.defaultTimeout = defaultTimeout;
  }

  /**
   * Register a handler for incoming requests from agents
   */
  onRequest(handler: RequestHandler): void {
    this.requestHandler = handler;
  }

  /**
   * Register a handler for incoming notifications from agents
   */
  onNotification(handler: NotificationHandler): void {
    this.notificationHandler = handler;
  }

  /**
   * Register a handler for stderr output from agents
   */
  onStderr(handler: StderrHandler): void {
    this.stderrHandler = handler;
  }

  /**
   * Spawn a new agent subprocess
   */
  async spawn(
    agentId: string,
    command: string,
    env: Record<string, string>,
    cwd: string
  ): Promise<SubprocessState> {
    // Check if already running
    const existing = this.processes.get(agentId);
    if (existing) {
      throw new Error(`Agent ${agentId} is already running`);
    }

    // Parse command (handle "command arg1 arg2" format)
    const parts = command.split(/\s+/).filter(Boolean);
    if (parts.length === 0) {
      throw new Error(`Invalid command: "${command}"`);
    }
    const [cmd, ...args] = parts as [string, ...string[]];

    // Spawn the process with pipe I/O
    const bunProcess = Bun.spawn([cmd, ...args], {
      cwd,
      env,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    // Cast to PipedSubprocess since we know we're using pipe mode
    const process = bunProcess as unknown as PipedSubprocess;

    const state: SubprocessState = {
      process,
      agentId,
      sessionId: null,
      isReady: false,
      capabilities: {},
      pendingRequests: new Map(),
      requestId: 0,
    };

    this.processes.set(agentId, state);

    // Start read loops
    this.startReadLoop(state);
    this.startStderrLoop(state);

    return state;
  }

  /**
   * Stop an agent subprocess
   */
  async stop(agentId: string): Promise<void> {
    const state = this.processes.get(agentId);
    if (!state) return;

    // Cancel all pending requests
    for (const [id, pending] of state.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Agent stopped"));
    }
    state.pendingRequests.clear();

    // Terminate the process
    state.process.kill();
    this.processes.delete(agentId);
  }

  /**
   * Stop all agent subprocesses
   */
  async stopAll(): Promise<void> {
    const agentIds = Array.from(this.processes.keys());
    await Promise.all(agentIds.map(id => this.stop(id)));
  }

  /**
   * Check if an agent is running
   */
  isRunning(agentId: string): boolean {
    const state = this.processes.get(agentId);
    return state !== undefined && !state.process.killed;
  }

  /**
   * Get the state of a running agent (for testing/debugging)
   */
  getState(agentId: string): SubprocessState | undefined {
    return this.processes.get(agentId);
  }

  /**
   * Reset activity timeout for all pending requests of an agent
   * Called whenever we receive any message (response, notification, request) from the agent
   */
  private resetActivityTimeouts(state: SubprocessState): void {
    for (const [id, pending] of state.pendingRequests) {
      // Clear existing timeout
      clearTimeout(pending.timeout);

      // Set new timeout
      pending.timeout = setTimeout(() => {
        state.pendingRequests.delete(id);
        pending.reject(new Error(`Activity timeout for ${pending.method} - no response from agent for ${pending.timeoutMs / 1000}s`));
      }, pending.timeoutMs);
    }
  }

  /**
   * Send a JSON-RPC request and wait for response
   * Uses activity-based timeout - resets whenever we receive any message from the agent
   */
  async request<T>(
    agentId: string,
    method: string,
    params?: unknown,
    timeout?: number
  ): Promise<T> {
    const state = this.processes.get(agentId);
    if (!state) {
      throw new Error(`Agent ${agentId} is not running`);
    }

    // Generate request ID
    state.requestId++;
    const id = state.requestId;

    // Create the request
    const request = createRequest(id, method, params);
    const requestJson = JSON.stringify(request) + "\n";

    // Set up response tracking with activity-based timeout
    const responsePromise = new Promise<T>((resolve, reject) => {
      const timeoutMs = timeout ?? this.defaultTimeout;
      const timeoutHandle = setTimeout(() => {
        state.pendingRequests.delete(id);
        reject(new Error(`Activity timeout for ${method} - no response from agent for ${timeoutMs / 1000}s`));
      }, timeoutMs);

      state.pendingRequests.set(id, {
        resolve: resolve as (result: unknown) => void,
        reject,
        timeout: timeoutHandle,
        timeoutMs,
        method,
      });
    });

    // Send the request
    state.process.stdin.write(requestJson);
    state.process.stdin.flush();

    return responsePromise;
  }

  /**
   * Send a JSON-RPC notification (no response expected)
   */
  async notify(agentId: string, method: string, params?: unknown): Promise<void> {
    const state = this.processes.get(agentId);
    if (!state) {
      throw new Error(`Agent ${agentId} is not running`);
    }

    const notification: JsonRpcNotification = {
      jsonrpc: JSONRPC_VERSION,
      method,
      params,
    };
    const notificationJson = JSON.stringify(notification) + "\n";

    state.process.stdin.write(notificationJson);
    state.process.stdin.flush();
  }

  /**
   * Send a JSON-RPC response (for incoming requests from agent)
   */
  private sendResponse(
    state: SubprocessState,
    response: JsonRpcResponse
  ): void {
    const responseJson = JSON.stringify(response) + "\n";
    logStream.debug(`[subprocess] Sending response`, { 
      agentId: state.agentId, 
      id: response.id,
      hasResult: !!response.result,
      hasError: !!response.error,
      responseLen: responseJson.length
    });
    state.process.stdin.write(responseJson);
    state.process.stdin.flush();
  }

  /**
   * Start the stdout read loop for an agent
   */
  private async startReadLoop(state: SubprocessState): Promise<void> {
    const reader = state.process.stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete lines
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.trim()) continue;
          await this.handleMessage(state, line);
        }
      }
    } catch (error) {
      // Process ended or read error
      logStream.error(`[subprocess] Read loop error`, { agentId: state.agentId, error: error instanceof Error ? error.message : String(error) });
    } finally {
      reader.releaseLock();

      // Clean up pending requests on exit
      const errorMsg = "Agent process terminated unexpectedly";
      for (const [id, pending] of state.pendingRequests) {
        clearTimeout(pending.timeout);
        pending.reject(new Error(errorMsg));
      }
      state.pendingRequests.clear();

      // Remove from active processes
      this.processes.delete(state.agentId);

      logStream.info(`[subprocess] Agent ${state.agentId} read loop ended, cleaned up pending requests`);
    }
  }

  /**
   * Start the stderr read loop for an agent (for logging)
   */
  private async startStderrLoop(state: SubprocessState): Promise<void> {
    const reader = state.process.stderr.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        if (text.trim()) {
          logStream.debug(`[subprocess] stderr`, { agentId: state.agentId, text: text.trim() });
          // Forward to stderr handler if registered
          if (this.stderrHandler) {
            this.stderrHandler(state.agentId, text);
          }
        }
      }
    } catch {
      // Process ended
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Handle a message from the agent
   */
  private async handleMessage(state: SubprocessState, line: string): Promise<void> {
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch (error) {
      logStream.error(`[subprocess] Failed to parse JSON`, { agentId: state.agentId, line });
      return;
    }

    // Reset activity timeouts - agent is alive and communicating
    this.resetActivityTimeouts(state);

    // Check if it's a response to one of our requests
    if (isJsonRpcResponse(msg)) {
      this.handleResponse(state, msg);
      return;
    }

    // Check if it's a request from the agent (callback)
    if (isJsonRpcRequest(msg)) {
      await this.handleIncomingRequest(state, msg);
      return;
    }

    // Check if it's a notification (no id field)
    if (isJsonRpcNotification(msg)) {
      this.handleNotification(state, msg);
      return;
    }

    // Handle batch responses
    if (Array.isArray(msg)) {
      for (const item of msg) {
        if (isJsonRpcResponse(item)) {
          this.handleResponse(state, item);
        } else if (isJsonRpcRequest(item)) {
          await this.handleIncomingRequest(state, item);
        } else if (isJsonRpcNotification(item)) {
          this.handleNotification(state, item);
        }
      }
      return;
    }

    logStream.warn(`[subprocess] Unknown message format`, { agentId: state.agentId, msg });
  }

  /**
   * Handle a response from the agent
   */
  private handleResponse(state: SubprocessState, response: JsonRpcResponse): void {
    if (response.id === null) {
      // Parse error response - can't match to a pending request
      logStream.error(`[subprocess] Parse error response`, { agentId: state.agentId, error: response.error });
      return;
    }

    const pending = state.pendingRequests.get(response.id);
    if (!pending) {
      logStream.warn(`[subprocess] No pending request for id`, { agentId: state.agentId, id: response.id });
      return;
    }

    clearTimeout(pending.timeout);
    state.pendingRequests.delete(response.id);

    if (response.error) {
      pending.reject(new Error(response.error.message));
    } else {
      pending.resolve(response.result);
    }
  }

  /**
   * Handle an incoming request from the agent (callback)
   */
  private async handleIncomingRequest(
    state: SubprocessState,
    request: JsonRpcRequest
  ): Promise<void> {
    logStream.debug(`[subprocess] Incoming request`, { 
      agentId: state.agentId, 
      method: request.method, 
      id: request.id 
    });

    if (!this.requestHandler) {
      // No handler registered, send error response
      const response = createErrorResponse(
        request.id,
        ErrorCode.MethodNotFound,
        `No handler for ${request.method}`
      );
      this.sendResponse(state, response);
      return;
    }

    try {
      const result = await this.requestHandler(state.agentId, request);
      const response = createResponse(request.id, result);
      this.sendResponse(state, response);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logStream.error(`[subprocess] Request handler error`, { 
        agentId: state.agentId, 
        method: request.method, 
        error: errorMsg 
      });
      const response = createErrorResponse(
        request.id,
        ErrorCode.InternalError,
        errorMsg
      );
      this.sendResponse(state, response);
    }
  }

  /**
   * Handle a notification from the agent (no response expected)
   */
  private handleNotification(
    state: SubprocessState,
    notification: JsonRpcNotification
  ): void {
    if (this.notificationHandler) {
      this.notificationHandler(state.agentId, notification);
    } else {
      logStream.debug(`[subprocess] Unhandled notification`, {
        agentId: state.agentId,
        method: notification.method,
      });
    }
  }
}

// ============================================================
// Singleton Instance
// ============================================================

let subprocessManager: SubprocessManager | null = null;

export function getSubprocessManager(): SubprocessManager {
  if (!subprocessManager) {
    subprocessManager = new SubprocessManager();
  }
  return subprocessManager;
}
