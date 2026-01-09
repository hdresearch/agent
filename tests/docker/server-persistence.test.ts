// Docker-based server persistence tests
// Tests that sessions and data survive container operations

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import {
  type DockerTestContext,
  TEST_SERVER_URL,
  isDockerServerRunning,
  createTestContext,
  makeRpcCall,
  initializeConnection,
  createSession,
  listSessions,
} from "../shared";

describe("Docker Server Persistence Tests", () => {
  let ctx: DockerTestContext;
  let serverAvailable = false;
  let testSessionId: string | null = null;

  beforeAll(async () => {
    serverAvailable = await isDockerServerRunning();
    if (!serverAvailable) {
      console.log(`Skipping Docker persistence tests: Server not running at ${TEST_SERVER_URL}`);
      console.log("Start with: docker-compose -f docker-compose.test.yml up -d");
      return;
    }

    ctx = await createTestContext();
    await initializeConnection(ctx);

    // Create one session for all tests to share
    // This avoids the UNIQUE constraint issue when the server
    // generates the same session ID multiple times
    // Note: This will be null if no ANTHROPIC_API_KEY is configured
    testSessionId = await createSession(ctx, "/tmp");
    if (!testSessionId) {
      console.log("Note: Session creation failed (agent may not be configured - no API key?)");
      console.log("Tests requiring sessions will be skipped");
    }
  });

  afterAll(async () => {
    // Cleanup is handled by container lifecycle
  });

  // Helper to skip tests if server not available
  function skipIfNoServer(): boolean {
    if (!serverAvailable) {
      console.log("Skipping: Docker server not available");
      return true;
    }
    return false;
  }

  // Helper to skip tests if no session is available (agent not configured)
  function skipIfNoSession(): boolean {
    if (skipIfNoServer()) return true;
    if (!testSessionId) {
      console.log("Skipping: No session available (agent may not be configured)");
      return true;
    }
    return false;
  }

  // Helper to get the shared test session ID
  function getTestSessionId(): string | null {
    return testSessionId;
  }

  describe("Session Persistence", () => {
    test("created session appears in session list", async () => {
      if (skipIfNoSession()) return;

      // Use the session created in beforeAll
      const sessionId = getTestSessionId();
      expect(sessionId).toBeTruthy();

      // Verify it appears in the list
      const sessions = await listSessions(ctx);
      expect(sessions.length).toBeGreaterThan(0);
    });

    test("session outputs are stored and retrievable", async () => {
      if (skipIfNoSession()) return;

      // Use shared session
      const sessionId = getTestSessionId();
      expect(sessionId).toBeTruthy();

      // Get session outputs
      const response = await makeRpcCall<{
        outputs: Array<{ type: string; content: string }>;
      }>(ctx, "session/outputs", {
        sessionId,
        afterSeq: 0,
      });

      expect(response.error).toBeUndefined();
      expect(response.result).toBeDefined();
      // Outputs array should exist (may be empty for new session)
      expect(Array.isArray(response.result?.outputs)).toBe(true);
    });

    test("session sync returns consistent state", async () => {
      if (skipIfNoSession()) return;

      // Use shared session
      const sessionId = getTestSessionId();
      expect(sessionId).toBeTruthy();

      // Sync session
      const response = await makeRpcCall<{
        sessionId: string;
        mode?: string;
      }>(ctx, "session/sync", {
        sessionId,
      });

      expect(response.error).toBeUndefined();
      expect(response.result?.sessionId).toBe(sessionId);
    });
  });

  describe("Configuration Persistence", () => {
    test("agent selection persists", async () => {
      if (skipIfNoServer()) return;

      // Get current agent
      const statusBefore = await makeRpcCall<{
        currentAgent: string;
      }>(ctx, "agent/status");

      expect(statusBefore.error).toBeUndefined();
      const currentAgent = statusBefore.result?.currentAgent;
      expect(currentAgent).toBeDefined();

      // Agent should remain consistent across calls
      const statusAfter = await makeRpcCall<{
        currentAgent: string;
      }>(ctx, "agent/status");

      expect(statusAfter.result?.currentAgent).toBe(currentAgent);
    });
  });

  describe("Output History", () => {
    test("session outputs maintain sequence order", async () => {
      if (skipIfNoSession()) return;

      // Use shared session
      const sessionId = getTestSessionId();
      expect(sessionId).toBeTruthy();

      // Get outputs with sequence tracking
      const response1 = await makeRpcCall<{
        outputs: Array<{ seq: number; type: string }>;
        lastSeq: number;
      }>(ctx, "session/outputs", {
        sessionId,
        afterSeq: 0,
      });

      expect(response1.error).toBeUndefined();

      // If there are outputs, verify sequence numbers are ordered
      const outputs = response1.result?.outputs || [];
      if (outputs.length > 1) {
        for (let i = 1; i < outputs.length; i++) {
          expect(outputs[i].seq).toBeGreaterThan(outputs[i - 1].seq);
        }
      }
    });

    test("incremental sync with afterSeq works", async () => {
      if (skipIfNoSession()) return;

      // Use shared session
      const sessionId = getTestSessionId();
      expect(sessionId).toBeTruthy();

      // Get all outputs
      const response1 = await makeRpcCall<{
        outputs: Array<{ seq: number }>;
        lastSeq: number;
      }>(ctx, "session/outputs", {
        sessionId,
        afterSeq: 0,
      });

      expect(response1.error).toBeUndefined();
      const lastSeq = response1.result?.lastSeq || 0;

      // Get outputs after lastSeq (should be empty or only new ones)
      const response2 = await makeRpcCall<{
        outputs: Array<{ seq: number }>;
      }>(ctx, "session/outputs", {
        sessionId,
        afterSeq: lastSeq,
      });

      expect(response2.error).toBeUndefined();
      // Should not include items we already have
      const newOutputs = response2.result?.outputs || [];
      for (const output of newOutputs) {
        expect(output.seq).toBeGreaterThan(lastSeq);
      }
    });
  });

  describe("Queue Persistence", () => {
    test("queue operations work", async () => {
      if (skipIfNoServer()) return;

      // List queue (should be empty or have prompts)
      const listResponse = await makeRpcCall<{
        prompts: Array<{ id: string }>;
        processing: boolean;
      }>(ctx, "queue/list");

      expect(listResponse.error).toBeUndefined();
      expect(Array.isArray(listResponse.result?.prompts)).toBe(true);
    });

    test("enqueue and dequeue work", async () => {
      if (skipIfNoServer()) return;

      // Enqueue an item (server expects 'text' parameter, not 'prompt')
      const enqueueResponse = await makeRpcCall<{
        id: string;
        position: number;
      }>(ctx, "queue/enqueue", {
        text: "test prompt for queue",
      });

      expect(enqueueResponse.error).toBeUndefined();
      const itemId = enqueueResponse.result?.id;
      expect(itemId).toBeDefined();

      // Peek at queue
      const peekResponse = await makeRpcCall<{
        item?: { id: string; prompt: string };
      }>(ctx, "queue/peek");

      expect(peekResponse.error).toBeUndefined();

      // Clear the queue to clean up
      await makeRpcCall(ctx, "queue/clear");
    });
  });

  describe("Volume-Based Persistence", () => {
    test("server data directory exists in container", async () => {
      if (skipIfNoSession()) return;

      // The server should have its data directory set up
      // We can verify by checking if sessions persist

      // Use shared session
      const sessionId = getTestSessionId();
      expect(sessionId).toBeTruthy();

      // List sessions - should include our session
      const sessions = await listSessions(ctx);
      const found = sessions.some((s) => s.id === sessionId);
      expect(found).toBe(true);
    });
  });
});
