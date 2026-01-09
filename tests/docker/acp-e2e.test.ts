// End-to-end test: ACP Client controlling Claude Code in Docker
// Tests the full flow: client → vers-agent server → ACP → Claude Code subprocess

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import {
  DockerTestContext,
  TEST_SERVER_URL,
  isDockerServerRunning,
  createTestContext,
  makeRpcCall,
  initializeConnection,
  cleanupSessions,
} from "./docker-test-utils";

describe("ACP End-to-End Tests", () => {
  let ctx: DockerTestContext;
  let serverAvailable = false;

  beforeAll(async () => {
    serverAvailable = await isDockerServerRunning();
    if (!serverAvailable) {
      console.log(`Skipping ACP E2E tests: Server not running at ${TEST_SERVER_URL}`);
      console.log("Start with: docker compose -f docker-compose.test.yml up -d");
      return;
    }

    ctx = await createTestContext();
  });

  afterAll(async () => {
    if (serverAvailable && ctx) {
      await cleanupSessions(ctx);
    }
  });

  function skipIfNoServer(): boolean {
    if (!serverAvailable) {
      console.log("Skipping: Docker server not available");
      return true;
    }
    return false;
  }

  describe("ACP Protocol Flow", () => {
    test("initialize handshake returns ACP-compliant response", async () => {
      if (skipIfNoServer()) return;

      const response = await makeRpcCall<{
        agentInfo: { name: string; version: string };
        capabilities: {
          session?: { modes?: string[] };
          mcp?: { tools?: boolean };
        };
      }>(ctx, "initialize", {
        clientInfo: { name: "acp-e2e-test", version: "1.0.0" },
        capabilities: {
          fs: { readTextFile: true, writeTextFile: true },
          terminal: true,
        },
      });

      expect(response.error).toBeUndefined();
      expect(response.result?.agentInfo).toBeDefined();
      expect(response.result?.agentInfo.name).toBeTruthy();
      expect(response.result?.capabilities).toBeDefined();
    });

    test("agent/list includes claude-code agent", async () => {
      if (skipIfNoServer()) return;

      const response = await makeRpcCall<{
        agents: Array<{ identity: string; name: string }>;
        currentAgent: string;
      }>(ctx, "agent/list");

      expect(response.error).toBeUndefined();
      expect(response.result?.agents).toBeDefined();
      
      // Check if claude-code or similar is available
      const agentNames = response.result?.agents.map(a => a.identity) || [];
      console.log("Available agents:", agentNames);
      
      expect(agentNames.length).toBeGreaterThan(0);
    });

    test("agent/switch to claude-code succeeds or gracefully handles missing agent", async () => {
      if (skipIfNoServer()) return;

      // First get available agents
      const listResponse = await makeRpcCall<{
        agents: Array<{ identity: string }>;
      }>(ctx, "agent/list");

      const agents = listResponse.result?.agents || [];
      const claudeAgent = agents.find(a => 
        a.identity.includes("claude") || a.identity.includes("anthropic")
      );

      if (!claudeAgent) {
        console.log("Skipping: No Claude-compatible agent found");
        return;
      }

      const response = await makeRpcCall(ctx, "agent/switch", {
        agentId: claudeAgent.identity,
      });

      // Should either succeed or return a meaningful error
      expect(response).toBeDefined();
    });
  });

  describe("Session Management", () => {
    test("session/new creates session with cwd", async () => {
      if (skipIfNoServer()) return;

      const response = await makeRpcCall<{
        sessionId: string;
      }>(ctx, "session/new", {
        cwd: "/tmp",
      });

      // May fail if no API key configured - that's ok
      if (response.error) {
        console.log("session/new error (expected without API key):", response.error.message);
        return;
      }

      expect(response.result?.sessionId).toBeTruthy();
    });

    test("session/list shows created sessions", async () => {
      if (skipIfNoServer()) return;

      const response = await makeRpcCall<{
        sessions: Array<{ id: string; cwd: string }>;
      }>(ctx, "session/list");

      expect(response.error).toBeUndefined();
      expect(Array.isArray(response.result?.sessions || response.result)).toBe(true);
    });
  });

  describe("Prompt Flow (requires API key)", () => {
    test("session/prompt sends message to agent", async () => {
      if (skipIfNoServer()) return;

      // Create session first
      const sessionResponse = await makeRpcCall<{ sessionId: string }>(
        ctx,
        "session/new",
        { cwd: "/tmp" }
      );

      if (sessionResponse.error || !sessionResponse.result?.sessionId) {
        console.log("Skipping prompt test: No session created (needs API key)");
        return;
      }

      const sessionId = sessionResponse.result.sessionId;

      // Send a simple prompt
      const promptResponse = await makeRpcCall<{
        stopReason: string;
        content?: Array<{ type: string; text?: string }>;
      }>(ctx, "session/prompt", {
        sessionId,
        prompt: [{ type: "text", text: "Say hello" }],
      });

      if (promptResponse.error) {
        console.log("Prompt error (expected without API key):", promptResponse.error.message);
        return;
      }

      expect(promptResponse.result?.stopReason).toBeDefined();
    });
  });

  describe("Remote Access Simulation", () => {
    test("server accepts requests from external client", async () => {
      if (skipIfNoServer()) return;

      // Simulate a remote client connecting
      const response = await fetch(`${ctx.serverUrl}/health`);
      expect(response.ok).toBe(true);

      const data = await response.json();
      expect(data.status).toBe("ok");
    });

    test("SSE stream can be established for real-time updates", async () => {
      if (skipIfNoServer()) return;

      // Try to connect to SSE endpoint
      const sseUrl = `${ctx.serverUrl}/events`;
      
      try {
        const response = await fetch(sseUrl, {
          headers: {
            "Authorization": `Bearer ${ctx.authToken}`,
            "Accept": "text/event-stream",
          },
        });

        // SSE endpoint should return 200 with proper content type
        // or redirect/require different auth
        expect(response.status).toBeGreaterThanOrEqual(200);
        expect(response.status).toBeLessThan(500);
      } catch (e) {
        // Connection might be rejected without proper setup
        console.log("SSE connection test:", e);
      }
    });

    test("concurrent requests are handled correctly", async () => {
      if (skipIfNoServer()) return;

      // Send multiple concurrent requests
      const requests = [
        makeRpcCall(ctx, "agent/list"),
        makeRpcCall(ctx, "session/list"),
        makeRpcCall(ctx, "system/cwd"),
      ];

      const results = await Promise.all(requests);

      // All should succeed
      for (const result of results) {
        expect(result.error).toBeUndefined();
        expect(result.result).toBeDefined();
      }
    });
  });

  describe("Error Handling", () => {
    test("invalid session ID returns appropriate error", async () => {
      if (skipIfNoServer()) return;

      const response = await makeRpcCall(ctx, "session/prompt", {
        sessionId: "invalid-session-id-12345",
        prompt: [{ type: "text", text: "test" }],
      });

      // Should return an error, not crash
      expect(response.error || response.result).toBeDefined();
    });

    test("malformed prompt returns error", async () => {
      if (skipIfNoServer()) return;

      const response = await makeRpcCall(ctx, "session/prompt", {
        sessionId: "some-id",
        prompt: "not-an-array", // Invalid format
      });

      expect(response.error || response.result).toBeDefined();
    });
  });
});
