// Docker test utilities for integration testing
// Enhanced from tests/docker/docker-test-utils.ts
// Uses in-memory token management instead of file-based sharing

import { retry, waitUntil, getTestTimeout, type WaitUntilOptions } from "./sync";

// ============================================================================
// Types
// ============================================================================

export interface DockerTestContext {
  serverUrl: string;
  authToken: string | null;
}

export interface Session {
  id: string;
  name?: string;
}

export interface RpcResponse<T = unknown> {
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

// ============================================================================
// Configuration
// ============================================================================

/** Default test server URL (mapped from container's 9999 to host's 19999) */
export const TEST_SERVER_URL = process.env.DOCKER_SERVER_URL || "http://localhost:19999";

// ============================================================================
// Token Management (In-Memory Singleton)
// ============================================================================

/**
 * In-memory token manager replaces file-based token sharing
 * This avoids race conditions between test files
 */
class TokenManager {
  private static token: string | null = null;
  private static tokenPromise: Promise<string | null> | null = null;

  /**
   * Get or claim a token for the server
   * Uses singleton pattern to ensure only one claim per process
   */
  static async getOrClaim(serverUrl: string): Promise<string | null> {
    // Return cached token if available
    if (this.token) {
      return this.token;
    }

    // Deduplicate concurrent claim requests
    if (!this.tokenPromise) {
      this.tokenPromise = this.claimTokenInternal(serverUrl);
    }

    this.token = await this.tokenPromise;
    return this.token;
  }

  /**
   * Clear the cached token (for testing)
   */
  static clear(): void {
    this.token = null;
    this.tokenPromise = null;
  }

  private static async claimTokenInternal(serverUrl: string): Promise<string | null> {
    try {
      // Check if server is already claimed
      const healthResponse = await fetch(`${serverUrl}/health`);
      const healthData = await healthResponse.json();

      if (!healthData.claimed) {
        // Claim the server
        const response = await fetch(`${serverUrl}/claim`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Client-Id": `test-client-${Date.now()}`,
          },
        });

        const data = await response.json();
        if (data.token) {
          return data.token;
        }
      }
    } catch {
      // Claim failed
    }

    return null;
  }
}

// ============================================================================
// Server Health
// ============================================================================

/**
 * Wait for the server to be healthy with exponential backoff
 */
export async function waitForHealthy(
  url: string = TEST_SERVER_URL,
  maxWaitMs: number = 60000
): Promise<boolean> {
  const startTime = Date.now();
  let delay = 500;

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) {
        return true;
      }
    } catch {
      // Server not ready yet
    }

    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(delay * 1.5, 5000); // Cap at 5 seconds
  }

  return false;
}

/**
 * Check if the Docker server is running and healthy
 */
export async function isDockerServerRunning(url: string = TEST_SERVER_URL): Promise<boolean> {
  try {
    const response = await fetch(`${url}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

// ============================================================================
// Test Context
// ============================================================================

/**
 * Create a test context with server URL and auth token
 */
export async function createTestContext(url: string = TEST_SERVER_URL): Promise<DockerTestContext> {
  const healthy = await waitForHealthy(url, 30000);
  if (!healthy) {
    throw new Error(`Docker server at ${url} is not healthy`);
  }

  const authToken = await TokenManager.getOrClaim(url);

  return {
    serverUrl: url,
    authToken,
  };
}

// ============================================================================
// RPC Utilities
// ============================================================================

/**
 * Make a JSON-RPC call to the server
 */
export async function makeRpcCall<T = unknown>(
  ctx: DockerTestContext,
  method: string,
  params: Record<string, unknown> = {}
): Promise<RpcResponse<T>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (ctx.authToken) {
    headers["Authorization"] = `Bearer ${ctx.authToken}`;
  }

  const response = await fetch(`${ctx.serverUrl}/rpc`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      method,
      params,
      id: Date.now(),
    }),
  });

  return response.json();
}

/**
 * Make an RPC call with automatic retry on transient failures
 */
export async function makeRpcCallWithRetry<T = unknown>(
  ctx: DockerTestContext,
  method: string,
  params: Record<string, unknown> = {},
  options?: {
    maxRetries?: number;
    isRetryable?: (error: RpcResponse<T>) => boolean;
  }
): Promise<RpcResponse<T>> {
  const { maxRetries = 3, isRetryable } = options ?? {};

  return retry(
    async () => {
      const response = await makeRpcCall<T>(ctx, method, params);

      // Check if error is retryable
      if (response.error && isRetryable?.(response)) {
        throw new Error(response.error.message);
      }

      return response;
    },
    { maxRetries }
  );
}

// ============================================================================
// Session Management
// ============================================================================

/**
 * Initialize the ACP connection
 */
export async function initializeConnection(ctx: DockerTestContext): Promise<boolean> {
  const response = await makeRpcCall(ctx, "initialize", {
    clientInfo: {
      name: "docker-test-client",
      version: "1.0.0",
    },
    capabilities: {
      session: { streaming: true },
      fileSystem: { read: true, write: true },
    },
  });

  if (response.error) {
    console.error("[initializeConnection] error:", response.error);
  }

  return !response.error;
}

/**
 * Create a new session
 */
export async function createSession(
  ctx: DockerTestContext,
  workingDirectory: string = "/tmp"
): Promise<string | null> {
  // First ensure we're initialized
  const initResult = await initializeConnection(ctx);
  if (!initResult) {
    console.error("[createSession] initializeConnection failed");
    return null;
  }

  const response = await makeRpcCall<{ sessionId: string }>(ctx, "session/new", {
    workingDirectory,
  });

  if (response.error) {
    console.error("[createSession] session/new error:", response.error);
    return null;
  }

  return response.result?.sessionId || null;
}

/**
 * List all sessions
 */
export async function listSessions(ctx: DockerTestContext): Promise<Session[]> {
  const response = await makeRpcCall<{ sessions: Session[] }>(ctx, "session/list");
  return response.result?.sessions || [];
}

/**
 * Clean up test sessions
 */
export async function cleanupSessions(ctx: DockerTestContext): Promise<void> {
  const sessions = await listSessions(ctx);

  for (const session of sessions) {
    try {
      await makeRpcCall(ctx, "session/cancel", { sessionId: session.id });
    } catch {
      // Ignore errors during cleanup
    }
  }
}

// ============================================================================
// Event Stream
// ============================================================================

export interface EventStreamConnection {
  close: () => void;
}

/**
 * Connect to SSE event stream
 */
export function connectToEventStream(
  ctx: DockerTestContext,
  onEvent: (event: { type: string; data: unknown }) => void,
  onError?: (error: Error) => void
): EventStreamConnection {
  const url = `${ctx.serverUrl}/events`;
  const headers: Record<string, string> = {};

  if (ctx.authToken) {
    headers["Authorization"] = `Bearer ${ctx.authToken}`;
  }

  const controller = new AbortController();

  (async () => {
    try {
      const response = await fetch(url, {
        headers,
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`Failed to connect to event stream: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        let eventType = "";
        let eventData = "";

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7);
          } else if (line.startsWith("data: ")) {
            eventData = line.slice(6);
          } else if (line === "" && eventType && eventData) {
            try {
              const data = JSON.parse(eventData);
              onEvent({ type: eventType, data });
            } catch {
              // Invalid JSON, skip
            }
            eventType = "";
            eventData = "";
          }
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name !== "AbortError") {
        onError?.(error);
      }
    }
  })();

  return {
    close: () => controller.abort(),
  };
}

// ============================================================================
// Docker Test Harness
// ============================================================================

/**
 * Test harness for Docker integration tests
 * Provides automatic session isolation and cleanup
 *
 * Usage:
 * ```typescript
 * const harness = new DockerTestHarness();
 *
 * beforeAll(async () => {
 *   await harness.setup();
 * });
 *
 * afterAll(async () => {
 *   await harness.cleanup();
 * });
 *
 * test('example', async () => {
 *   const sessionId = await harness.createIsolatedSession();
 *   // Test logic...
 * });
 * ```
 */
export class DockerTestHarness {
  private context: DockerTestContext | null = null;
  private createdSessions: string[] = [];
  private serverUrl: string;

  constructor(serverUrl: string = TEST_SERVER_URL) {
    this.serverUrl = serverUrl;
  }

  /**
   * Initialize the test harness
   */
  async setup(): Promise<DockerTestContext> {
    this.context = await createTestContext(this.serverUrl);
    return this.context;
  }

  /**
   * Get the current context (throws if not initialized)
   */
  get ctx(): DockerTestContext {
    if (!this.context) {
      throw new Error("DockerTestHarness not initialized. Call setup() first.");
    }
    return this.context;
  }

  /**
   * Create an isolated session with unique suffix
   * Session is tracked for automatic cleanup
   */
  async createIsolatedSession(workingDirectory: string = "/tmp"): Promise<string> {
    const sessionId = await createSession(this.ctx, workingDirectory);
    if (!sessionId) {
      throw new Error("Failed to create isolated session");
    }
    this.createdSessions.push(sessionId);
    return sessionId;
  }

  /**
   * Cleanup all sessions created by this harness
   */
  async cleanup(): Promise<void> {
    if (!this.context) return;

    // Cancel all created sessions
    for (const sessionId of this.createdSessions) {
      try {
        await makeRpcCall(this.context, "session/cancel", { sessionId });
      } catch {
        // Ignore cleanup errors
      }
    }

    this.createdSessions = [];
    this.context = null;
  }

  /**
   * Make an RPC call using the harness context
   */
  async rpc<T = unknown>(
    method: string,
    params: Record<string, unknown> = {}
  ): Promise<RpcResponse<T>> {
    return makeRpcCall<T>(this.ctx, method, params);
  }

  /**
   * Make an RPC call with retry
   */
  async rpcWithRetry<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
    options?: { maxRetries?: number }
  ): Promise<RpcResponse<T>> {
    return makeRpcCallWithRetry<T>(this.ctx, method, params, options);
  }
}

// ============================================================================
// Skip Helpers
// ============================================================================

/**
 * Check if Docker server is available and skip test if not
 */
export async function skipIfNoDocker(url: string = TEST_SERVER_URL): Promise<boolean> {
  const running = await isDockerServerRunning(url);
  if (!running) {
    console.log(`Skipping: Docker server not available at ${url}`);
    return true;
  }
  return false;
}

// ============================================================================
// Wait Utilities (Docker-specific)
// ============================================================================

/**
 * Wait for a session to be in a specific state
 */
export async function waitForSessionState(
  ctx: DockerTestContext,
  sessionId: string,
  expectedState: string,
  options?: WaitUntilOptions
): Promise<void> {
  await waitUntil(
    async () => {
      const response = await makeRpcCall<{ state: string }>(ctx, "session/status", {
        sessionId,
      });
      return response.result?.state === expectedState;
    },
    {
      timeout: getTestTimeout(10000),
      interval: 100,
      message: `Session ${sessionId} did not reach state "${expectedState}"`,
      ...options,
    }
  );
}

/**
 * Wait for output from a session
 */
export async function waitForSessionOutput(
  ctx: DockerTestContext,
  sessionId: string,
  pattern: RegExp | string,
  options?: WaitUntilOptions
): Promise<string | null> {
  const regex = typeof pattern === "string" ? new RegExp(pattern) : pattern;
  let output: string | null = null;

  await waitUntil(
    async () => {
      const response = await makeRpcCall<{ output: string }>(ctx, "session/output", {
        sessionId,
      });
      output = response.result?.output ?? null;
      return output !== null && regex.test(output);
    },
    {
      timeout: getTestTimeout(10000),
      interval: 100,
      message: `Session output did not match ${pattern}`,
      ...options,
    }
  );

  return output;
}

// Re-export for backward compatibility
export { TokenManager };
