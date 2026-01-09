// Docker test utilities for integration testing
// Provides helpers for container lifecycle, health checks, and RPC calls

import { existsSync, writeFileSync, readFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

export interface DockerTestContext {
  serverUrl: string;
  authToken: string | null;
}

// Default test server URL (mapped from container's 9999 to host's 19999)
export const TEST_SERVER_URL = process.env.DOCKER_SERVER_URL || "http://localhost:19999";

// Token file for sharing claim token between test files
const TOKEN_FILE = join(tmpdir(), ".vers-agent-test-token");

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
      signal: AbortSignal.timeout(5000)
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Save token to file for sharing between test files
 */
function saveToken(token: string): void {
  try {
    writeFileSync(TOKEN_FILE, token, "utf-8");
  } catch {
    // Ignore save errors
  }
}

/**
 * Load token from file
 */
function loadToken(): string | null {
  try {
    if (existsSync(TOKEN_FILE)) {
      return readFileSync(TOKEN_FILE, "utf-8").trim();
    }
  } catch {
    // Ignore load errors
  }
  return null;
}

/**
 * Clear the saved token file
 */
export function clearSavedToken(): void {
  try {
    if (existsSync(TOKEN_FILE)) {
      unlinkSync(TOKEN_FILE);
    }
  } catch {
    // Ignore errors
  }
}

/**
 * Claim the server and get an auth token
 */
export async function claimServer(url: string = TEST_SERVER_URL): Promise<string | null> {
  // First, check if server is already claimed
  const healthResponse = await fetch(`${url}/health`);
  const healthData = await healthResponse.json();

  // If server is not claimed, claim it
  if (!healthData.claimed) {
    try {
      const response = await fetch(`${url}/claim`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Client-Id": `test-client-${Date.now()}`,
        },
      });

      const data = await response.json();

      if (data.token) {
        saveToken(data.token);
        return data.token;
      }
    } catch {
      // Claim failed
    }
  }

  // Server is already claimed, try to use saved token
  const savedToken = loadToken();
  if (savedToken) {
    // Verify the saved token works by making a test request
    try {
      const testResponse = await fetch(`${url}/rpc`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${savedToken}`,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "session/list",
          params: {},
          id: 1,
        }),
      });

      const testData = await testResponse.json();
      // If we don't get an auth error, the token is valid
      if (!testData.error || testData.error !== "Authentication required") {
        return savedToken;
      }
    } catch {
      // Token test failed
    }
  }

  return null;
}

/**
 * Create a test context with server URL and auth token
 */
export async function createTestContext(url: string = TEST_SERVER_URL): Promise<DockerTestContext> {
  const healthy = await waitForHealthy(url, 30000);
  if (!healthy) {
    throw new Error(`Docker server at ${url} is not healthy`);
  }

  const authToken = await claimServer(url);

  return {
    serverUrl: url,
    authToken,
  };
}

/**
 * Make a JSON-RPC call to the server
 */
export async function makeRpcCall<T = unknown>(
  ctx: DockerTestContext,
  method: string,
  params: Record<string, unknown> = {}
): Promise<{ result?: T; error?: { code: number; message: string; data?: unknown } }> {
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

  const data = await response.json();
  return data;
}

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
    return null;
  }

  const response = await makeRpcCall<{ sessionId: string }>(ctx, "session/new", {
    workingDirectory,
  });

  if (response.error) {
    // Session creation can fail with UNIQUE constraint if session already exists
    // This is expected when running multiple tests
    return null;
  }

  return response.result?.sessionId || null;
}

/**
 * List all sessions
 */
export async function listSessions(
  ctx: DockerTestContext
): Promise<Array<{ id: string; name?: string }>> {
  const response = await makeRpcCall<{ sessions: Array<{ id: string; name?: string }> }>(
    ctx,
    "session/list"
  );

  return response.result?.sessions || [];
}

/**
 * Connect to SSE event stream
 */
export function connectToEventStream(
  ctx: DockerTestContext,
  onEvent: (event: { type: string; data: unknown }) => void,
  onError?: (error: Error) => void
): { close: () => void } {
  const url = `${ctx.serverUrl}/events`;
  const headers: Record<string, string> = {};

  if (ctx.authToken) {
    headers["Authorization"] = `Bearer ${ctx.authToken}`;
  }

  // Use fetch with streaming for SSE
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

/**
 * Helper to skip test if Docker server is not available
 */
export function skipIfNoDocker(): boolean {
  // This is checked synchronously in test setup
  // The actual check happens in beforeAll
  return false;
}

/**
 * Clean up test sessions
 */
export async function cleanupSessions(ctx: DockerTestContext): Promise<void> {
  // Get all sessions and attempt to clean them up
  // This helps ensure test isolation
  const sessions = await listSessions(ctx);

  for (const session of sessions) {
    try {
      // Cancel any running tasks
      await makeRpcCall(ctx, "session/cancel", { sessionId: session.id });
    } catch {
      // Ignore errors during cleanup
    }
  }
}
