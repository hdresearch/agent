// HTTP + SSE client for ACP
// Uses fetch() for requests and EventSource for notifications

import {
  type JsonRpcResponse,
  createRequest,
  ErrorCode,
} from "../protocol/jsonrpc";
import { tokenStore } from "../utils/token-store";
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
  type ListSessionsResult,
  type GetSessionOutputsParams,
  type GetSessionOutputsResult,
  type SessionSyncInfo,
  type PromptParams,
  type PromptResult,
  type SetModeParams,
  type SetModeResult,
  type CancelParams,
  type CancelResult,
  type SessionNotificationParams,
  type AgentCapabilities,
  type Attachment,
  type QueueEnqueueParams,
  type QueueEnqueueResult,
  type QueueDequeueResult,
  type QueuePeekResult,
  type QueueListResult,
  type QueueRemoveParams,
  type QueueRemoveResult,
  type QueueClearResult,
  type SessionMode,
} from "../protocol/acp-types";

export type NotificationHandler = (params: SessionNotificationParams) => void;

export interface ClaimResponse {
  claimed: boolean;
  isOwner: boolean;
  token?: string;
  error?: string;
  message?: string;
}

export class HttpAcpClient {
  private baseUrl: string;
  private eventSource: EventSource | null = null;
  private notificationHandler: NotificationHandler | null = null;
  private agentCapabilities: AgentCapabilities | null = null;
  private _sessionId: string | null = null;
  private _connected = false;
  private _authToken: string | null = null;
  private _isOwner = false;
  private requestId = 0;
  private clientId: string;

  constructor(baseUrl: string, clientId = "vers-cli") {
    // Normalize URL (remove trailing slash)
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.clientId = clientId;

    // Load stored token for this server
    this._authToken = tokenStore.getToken(baseUrl);
  }

  // Claim or verify ownership of the server
  async claim(): Promise<ClaimResponse> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Client-Id": this.clientId,
    };

    // Include token if we have one
    if (this._authToken) {
      headers["Authorization"] = `Bearer ${this._authToken}`;
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/claim`, {
        method: "POST",
        headers,
      });
    } catch (err) {
      throw new Error(`Failed to connect to server: ${err instanceof Error ? err.message : "Network error"}`);
    }

    // Check if response is JSON
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      const text = await response.text();
      throw new Error(`Server returned non-JSON response: ${text.slice(0, 100)}`);
    }

    let result: ClaimResponse;
    try {
      result = (await response.json()) as ClaimResponse;
    } catch {
      throw new Error("Failed to parse server response as JSON");
    }

    // If we got a new token, store it
    if (result.token) {
      this._authToken = result.token;
      tokenStore.setToken(this.baseUrl, result.token);
    }

    this._isOwner = result.isOwner;
    return result;
  }

  // Connect to SSE stream
  async connect(): Promise<void> {
    // First, try to claim or verify ownership
    const claimResult = await this.claim();

    if (!claimResult.isOwner) {
      throw new Error(claimResult.error || "Failed to authenticate with server");
    }

    return new Promise((resolve, reject) => {
      // Add token to events URL if we have one
      let eventsUrl = `${this.baseUrl}/events`;
      if (this._authToken) {
        eventsUrl += `?token=${encodeURIComponent(this._authToken)}`;
      }

      // Use fetch with streaming instead of EventSource for better Bun compatibility
      fetch(eventsUrl)
        .then(async (response) => {
          if (!response.ok) {
            if (response.status === 401 || response.status === 403) {
              // Token might be invalid, clear it
              tokenStore.removeToken(this.baseUrl);
              this._authToken = null;
              reject(new Error("Authentication failed. Token may be invalid."));
              return;
            }
            reject(new Error(`Failed to connect to ${eventsUrl}: ${response.status}`));
            return;
          }

          this._connected = true;
          resolve();

          const reader = response.body?.getReader();
          if (!reader) return;

          const decoder = new TextDecoder();
          let buffer = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              this._connected = false;
              break;
            }

            buffer += decoder.decode(value, { stream: true });

            // Parse SSE events from buffer
            const lines = buffer.split("\n");
            buffer = lines.pop() || ""; // Keep incomplete line

            let currentEvent = "";
            let currentData = "";

            for (const line of lines) {
              if (line.startsWith("event: ")) {
                currentEvent = line.slice(7);
              } else if (line.startsWith("data: ")) {
                currentData = line.slice(6);
              } else if (line === "" && currentEvent && currentData) {
                // End of event
                if (currentEvent === "notification" && this.notificationHandler) {
                  try {
                    const params = JSON.parse(currentData) as SessionNotificationParams;
                    this.notificationHandler(params);
                  } catch {
                    // Ignore parse errors
                  }
                }
                currentEvent = "";
                currentData = "";
              }
            }
          }
        })
        .catch((err) => {
          this._connected = false;
          reject(err);
        });
    });
  }

  // Make JSON-RPC request
  private async request<T>(method: string, params?: unknown): Promise<T> {
    const id = ++this.requestId;
    const request = createRequest(id, method, params);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    // Include auth token if we have one
    if (this._authToken) {
      headers["Authorization"] = `Bearer ${this._authToken}`;
    }

    const response = await fetch(`${this.baseUrl}/rpc`, {
      method: "POST",
      headers,
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error("Authentication failed. Server may be claimed by another client.");
      }
      throw new Error(`HTTP error: ${response.status}`);
    }

    const json = (await response.json()) as JsonRpcResponse;

    if ("error" in json && json.error) {
      throw new Error(json.error.message);
    }

    return json.result as T;
  }

  // ============================================================
  // Public API
  // ============================================================

  async initialize(clientName = "vers-cli"): Promise<InitializeResult> {
    const params: InitializeParams = {
      clientInfo: { name: clientName, version: "1.0.0" },
      capabilities: {
        fileSystem: { read: true, write: true },
        terminal: { create: true },
      },
    };

    const result = await this.request<InitializeResult>(AcpMethod.Initialize, params);
    this.agentCapabilities = result.capabilities;
    return result;
  }

  async authenticate(apiKeys: Record<string, string>): Promise<AuthenticateResult> {
    const params: AuthenticateParams = {
      method: "api_key",
      credentials: apiKeys,
    };
    return this.request<AuthenticateResult>(AcpMethod.Authenticate, params);
  }

  async newSession(config?: NewSessionParams["config"]): Promise<NewSessionResult> {
    const params: NewSessionParams = { config };
    const result = await this.request<NewSessionResult>(AcpMethod.SessionNew, params);
    this._sessionId = result.sessionId;
    return result;
  }

  async loadSession(sessionId: string): Promise<LoadSessionResult> {
    const params: LoadSessionParams = { sessionId };
    const result = await this.request<LoadSessionResult>(AcpMethod.SessionLoad, params);
    this._sessionId = result.sessionId;
    return result;
  }

  async listSessions(): Promise<ListSessionsResult> {
    return this.request<ListSessionsResult>(AcpMethod.SessionList, {});
  }

  async getSessionOutputs(params?: GetSessionOutputsParams): Promise<GetSessionOutputsResult> {
    return this.request<GetSessionOutputsResult>(AcpMethod.SessionOutputs, params || {});
  }

  async getSessionSync(sessionId?: string): Promise<SessionSyncInfo> {
    return this.request<SessionSyncInfo>(AcpMethod.SessionSync, { sessionId });
  }

  async prompt(text: string, attachments?: Attachment[]): Promise<PromptResult> {
    const params: PromptParams = { text, attachments };
    return this.request<PromptResult>(AcpMethod.SessionPrompt, params);
  }

  async cancel(reason?: string): Promise<CancelResult> {
    const params: CancelParams = { reason };
    return this.request<CancelResult>(AcpMethod.SessionCancel, params);
  }

  async setMode(mode: "default" | "plan" | "execute"): Promise<SetModeResult> {
    const params: SetModeParams = { mode };
    return this.request<SetModeResult>(AcpMethod.SessionSetMode, params);
  }

  async reloadDocs(): Promise<{ success: boolean; message: string }> {
    return this.request<{ success: boolean; message: string }>(AcpMethod.SessionReloadDocs, {});
  }

  async getDocs(): Promise<{
    docs: Array<{ name: string; path: string; content: string; updatedAt: string }>;
    store: { autoLoaded: boolean; loadedAt: string };
  }> {
    return this.request(AcpMethod.SessionGetDocs, {});
  }

  async setDocs(docs: Array<{ name: string; content: string; path?: string }>): Promise<{
    success: boolean;
    docs: Array<{ name: string; path: string; content: string; updatedAt: string }>;
    message: string;
  }> {
    return this.request(AcpMethod.SessionSetDocs, { docs });
  }

  // File system operations (for remote @path expansion)
  async readFile(path: string, cwd?: string): Promise<{
    content: string | null;
    error?: string;
    path: string;
  }> {
    return this.request(AcpMethod.FsReadTextFile, { path, cwd });
  }

  async listDirectory(path: string, cwd?: string): Promise<{
    entries: Array<{ name: string; type: "file" | "directory" }>;
    error?: string;
    path: string;
  }> {
    return this.request(AcpMethod.FsListDirectory, { path, cwd });
  }

  // MCP Server management
  async mcpList(): Promise<{
    servers: Record<string, unknown>;
  }> {
    return this.request(AcpMethod.McpList, {});
  }

  async mcpAdd(name: string, config: {
    type?: "stdio" | "sse" | "http";
    command?: string;
    args?: string[];
    url?: string;
    env?: Record<string, string>;
    headers?: Record<string, string>;
  }): Promise<{
    success: boolean;
    servers: Record<string, unknown>;
  }> {
    return this.request(AcpMethod.McpAdd, { name, config });
  }

  async mcpRemove(name: string): Promise<{
    success: boolean;
    servers: Record<string, unknown>;
  }> {
    return this.request(AcpMethod.McpRemove, { name });
  }

  // Plan mode management
  async getMode(): Promise<{ mode: "default" | "plan" }> {
    return this.request(AcpMethod.SessionGetMode, {});
  }

  async getPlan(): Promise<{
    plan: Array<{
      id: string;
      description: string;
      status: "pending" | "in_progress" | "completed" | "failed";
      priority?: number;
    }>;
    mode: "default" | "plan";
  }> {
    return this.request(AcpMethod.SessionGetPlan, {});
  }

  async setPlan(plan: Array<{
    id: string;
    description: string;
    status: "pending" | "in_progress" | "completed" | "failed";
    priority?: number;
  }>): Promise<{
    success: boolean;
    plan: Array<{
      id: string;
      description: string;
      status: "pending" | "in_progress" | "completed" | "failed";
      priority?: number;
    }>;
  }> {
    return this.request(AcpMethod.SessionSetPlan, { plan });
  }

  async clearPlan(): Promise<{ success: boolean }> {
    return this.request(AcpMethod.SessionClearPlan, {});
  }

  // Queue management
  async queueEnqueue(
    text: string,
    attachments?: Attachment[],
    mode?: SessionMode
  ): Promise<QueueEnqueueResult> {
    const params: QueueEnqueueParams = { text, attachments, mode };
    return this.request(AcpMethod.QueueEnqueue, params);
  }

  async queueDequeue(): Promise<QueueDequeueResult> {
    return this.request(AcpMethod.QueueDequeue, {});
  }

  async queuePeek(): Promise<QueuePeekResult> {
    return this.request(AcpMethod.QueuePeek, {});
  }

  async queueList(): Promise<QueueListResult> {
    return this.request(AcpMethod.QueueList, {});
  }

  async queueRemove(ids: string[]): Promise<QueueRemoveResult> {
    const params: QueueRemoveParams = { ids };
    return this.request(AcpMethod.QueueRemove, params);
  }

  async queueClear(): Promise<QueueClearResult> {
    return this.request(AcpMethod.QueueClear, {});
  }

  // Bash execution (for remote CLI)
  async bashExecute(command: string, cwd?: string, timeout?: number): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }> {
    return this.request(AcpMethod.BashExecute, { command, cwd, timeout });
  }

  async getCwd(): Promise<{ cwd: string }> {
    return this.request(AcpMethod.GetCwd, {});
  }

  onNotification(handler: NotificationHandler): void {
    this.notificationHandler = handler;
  }

  get sessionId(): string | null {
    return this._sessionId;
  }

  get capabilities(): AgentCapabilities | null {
    return this.agentCapabilities;
  }

  get isConnected(): boolean {
    return this._connected;
  }

  get authToken(): string | null {
    return this._authToken;
  }

  get isOwner(): boolean {
    return this._isOwner;
  }

  // Clear stored token (useful for logout/reset)
  clearToken(): void {
    tokenStore.removeToken(this.baseUrl);
    this._authToken = null;
    this._isOwner = false;
  }

  close(): void {
    this._connected = false;
    // The fetch stream will close on its own
  }
}

// Connect to ACP server and return client
export async function connectToAcpServer(baseUrl: string): Promise<HttpAcpClient> {
  const client = new HttpAcpClient(baseUrl);
  await client.connect();
  return client;
}
