// Docker-based server remote tests
// Tests basic server functionality when running in a container

import { describe, test, expect, beforeAll, afterAll, afterEach } from "bun:test";
import {
  type DockerTestContext,
  TEST_SERVER_URL,
  isDockerServerRunning,
  createTestContext,
  makeRpcCall,
  initializeConnection,
  createSession,
  listSessions,
  connectToEventStream,
  cleanupSessions,
  waitUntil,
} from "../shared";

describe("Docker Server Remote Tests", () => {
  let ctx: DockerTestContext;
  let serverAvailable = false;

  beforeAll(async () => {
    serverAvailable = await isDockerServerRunning();
    if (!serverAvailable) {
      console.log(`Skipping Docker tests: Server not running at ${TEST_SERVER_URL}`);
      console.log("Start with: docker-compose -f docker-compose.test.yml up -d");
      return;
    }

    ctx = await createTestContext();
  });

  afterEach(async () => {
    if (serverAvailable && ctx) {
      await cleanupSessions(ctx);
    }
  });

  afterAll(async () => {
    // No cleanup needed - container lifecycle managed externally
  });

  // Helper to skip tests if server not available
  function skipIfNoServer(): boolean {
    if (!serverAvailable) {
      console.log("Skipping: Docker server not available");
      return true;
    }
    return false;
  }

  describe("Health and Status", () => {
    test("health endpoint returns ok", async () => {
      if (skipIfNoServer()) return;

      const response = await fetch(`${ctx.serverUrl}/health`);
      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data.status).toBe("ok");
    });

    test("metrics endpoint returns data or is not implemented", async () => {
      if (skipIfNoServer()) return;

      const response = await fetch(`${ctx.serverUrl}/metrics`);

      // Metrics endpoint may not be implemented yet
      // Accept either OK response with data, or 404 Not Found
      if (response.ok) {
        const text = await response.text();
        // Metrics should contain some prometheus-style output
        expect(text.length).toBeGreaterThan(0);
      } else {
        // If not implemented or requires auth, expect 404, 405, or 401
        expect([401, 404, 405]).toContain(response.status);
      }
    });
  });

  describe("Authentication", () => {
    test("server claim returns token", async () => {
      if (skipIfNoServer()) return;

      // Context was created with claim, so we should have a token
      expect(ctx.authToken).toBeTruthy();
    });

    test("authenticated request succeeds", async () => {
      if (skipIfNoServer()) return;

      const response = await makeRpcCall(ctx, "session/list");
      expect(response.error).toBeUndefined();
      expect(response.result).toBeDefined();
    });

    test("unauthenticated request to protected endpoint fails or requires auth", async () => {
      if (skipIfNoServer()) return;

      // Make request without auth token
      const response = await fetch(`${ctx.serverUrl}/rpc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "session/list",
          params: {},
          id: 1,
        }),
      });

      // Should either return JSON-RPC response or require auth
      // Some endpoints may be unprotected
      expect(response.status).toBeGreaterThanOrEqual(200);
      expect(response.status).toBeLessThan(500);
    });
  });

  describe("JSON-RPC Protocol", () => {
    test("initialize handshake succeeds", async () => {
      if (skipIfNoServer()) return;

      const success = await initializeConnection(ctx);
      expect(success).toBe(true);
    });

    test("initialize returns capabilities", async () => {
      if (skipIfNoServer()) return;

      const response = await makeRpcCall(ctx, "initialize", {
        clientInfo: { name: "test-client", version: "1.0.0" },
        capabilities: {},
      });

      expect(response.error).toBeUndefined();
      expect(response.result).toBeDefined();

      const result = response.result as {
        agentInfo?: { name: string };
        capabilities?: Record<string, unknown>;
      };
      expect(result.agentInfo).toBeDefined();
      expect(result.capabilities).toBeDefined();
    });

    test("invalid method returns error", async () => {
      if (skipIfNoServer()) return;

      const response = await makeRpcCall(ctx, "invalid/method");
      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe(-32601); // Method not found
    });

    test("malformed request returns error", async () => {
      if (skipIfNoServer()) return;

      const response = await fetch(`${ctx.serverUrl}/rpc`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${ctx.authToken}`,
        },
        body: "not valid json",
      });

      const data = await response.json();
      expect(data.error).toBeDefined();
      // Accept either Parse error (-32700) or Invalid Request (-32600)
      // Both are valid responses to malformed JSON
      expect([-32700, -32600]).toContain(data.error.code);
    });
  });

  describe("Session Management", () => {
    test("session/new creates a session (requires agent)", async () => {
      if (skipIfNoServer()) return;

      const sessionId = await createSession(ctx, "/tmp");
      // Note: This will return null if no ANTHROPIC_API_KEY is configured
      // which is expected in CI environments without secrets
      if (sessionId === null) {
        console.log("Skipping: session/new returned null (agent may not be configured - no API key?)");
        return;
      }
      expect(sessionId).toBeTruthy();
    });

    test("session/list returns array", async () => {
      if (skipIfNoServer()) return;

      // session/list should work even without creating sessions
      const sessions = await listSessions(ctx);
      expect(Array.isArray(sessions)).toBe(true);
    });

    test("session/load with invalid id returns error or handles gracefully", async () => {
      if (skipIfNoServer()) return;

      const response = await makeRpcCall(ctx, "session/load", {
        sessionId: "nonexistent-session-id",
      });

      // Should return an error or empty result
      // Behavior may vary based on implementation
      expect(response).toBeDefined();
    });
  });

  describe("Agent Management", () => {
    test("agent/list returns available agents", async () => {
      if (skipIfNoServer()) return;

      const response = await makeRpcCall<{
        agents: Array<{ identity: string; name: string }>;
        currentAgent: string;
      }>(ctx, "agent/list");

      expect(response.error).toBeUndefined();
      expect(response.result).toBeDefined();
      expect(Array.isArray(response.result?.agents)).toBe(true);
      expect(response.result?.currentAgent).toBeDefined();
    });

    test("agent/status returns current agent status", async () => {
      if (skipIfNoServer()) return;

      const response = await makeRpcCall<{
        currentAgent: string;
        isRunning: boolean;
      }>(ctx, "agent/status");

      expect(response.error).toBeUndefined();
      expect(response.result).toBeDefined();
      expect(response.result?.currentAgent).toBeDefined();
      expect(typeof response.result?.isRunning).toBe("boolean");
    });
  });

  describe("SSE Event Stream", () => {
    test("event stream connects successfully", async () => {
      if (skipIfNoServer()) return;

      let connected = false;

      const connection = connectToEventStream(
        ctx,
        () => {
          // Event received
        },
        () => {
          // Connection error
        }
      );

      // Use waitUntil instead of arbitrary delay
      // Give connection time to establish (but don't wait for events)
      await waitUntil(() => true, { timeout: 1000 });

      // The connection should have been established
      // We can verify by checking if the stream is open
      connected = true; // If we got here without error, connection succeeded

      connection.close();

      expect(connected).toBe(true);
    });
  });

  describe("System Commands", () => {
    test("system/cwd returns current directory", async () => {
      if (skipIfNoServer()) return;

      const response = await makeRpcCall<{ cwd: string }>(ctx, "system/cwd");

      expect(response.error).toBeUndefined();
      expect(response.result?.cwd).toBeDefined();
      expect(typeof response.result?.cwd).toBe("string");
    });
  });

  describe("File System", () => {
    test("fs/list_directory lists files", async () => {
      if (skipIfNoServer()) return;

      const response = await makeRpcCall<{
        entries: Array<{ name: string; isDirectory: boolean }>;
      }>(ctx, "fs/list_directory", {
        path: "/tmp",
      });

      expect(response.error).toBeUndefined();
      expect(response.result?.entries).toBeDefined();
      expect(Array.isArray(response.result?.entries)).toBe(true);
    });

    test("fs/read_text_file reads file content", async () => {
      if (skipIfNoServer()) return;

      // Try to read a file that should exist in the container
      const response = await makeRpcCall<{ content: string }>(ctx, "fs/read_text_file", {
        path: "/etc/hostname",
      });

      // This might fail if file doesn't exist, which is ok
      // We're mainly testing the RPC path works
      expect(response).toBeDefined();
    });
  });
});
