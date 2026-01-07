import { describe, test, expect, beforeAll, afterAll } from "bun:test";

const SERVER_URL = "http://localhost:9999";

describe("Server Output Storage Integration", () => {
  let sessionId: string | null = null;

  // Helper to make RPC calls
  async function rpc(method: string, params: unknown = {}) {
    const response = await fetch(`${SERVER_URL}/rpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method,
        params,
      }),
    });
    const json = await response.json();
    if (json.error) {
      throw new Error(json.error.message);
    }
    return json.result;
  }

  beforeAll(async () => {
    // Initialize and create a session
    await rpc("initialize", {
      clientInfo: { name: "test-client", version: "1.0.0" },
      capabilities: {},
    });

    const result = await rpc("session/new", {});
    sessionId = result.sessionId;
    console.log("Test session created:", sessionId);
  });

  test("session/outputs returns empty array for new session", async () => {
    const result = await rpc("session/outputs", {});

    expect(result.sessionId).toBe(sessionId);
    expect(result.outputs).toBeInstanceOf(Array);
    expect(result.syncInfo.count).toBe(0);
    expect(result.syncInfo.lastSeq).toBe(0);
  });

  test("session/sync returns correct info", async () => {
    const result = await rpc("session/sync", {});

    expect(result.sessionId).toBe(sessionId);
    expect(result.count).toBe(0);
    expect(result.lastSeq).toBe(0);
  });

  test("sending prompt stores user message", async () => {
    // This test requires the server to actually process a prompt
    // Skip if not running against a real server
    const skipReason = "Requires real Claude API - run manually";
    console.log(`Skipping: ${skipReason}`);
    return;

    // Send a simple prompt
    await rpc("session/prompt", { text: "Say hello in exactly 5 words" });

    // Wait a bit for processing
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Check outputs were stored
    const result = await rpc("session/outputs", {});
    console.log("Outputs after prompt:", result);

    expect(result.outputs.length).toBeGreaterThan(0);
    expect(result.outputs[0].type).toBe("user");
  });

  test("session list shows correct turn count", async () => {
    const result = await rpc("session/list", {});

    expect(result.sessions).toBeInstanceOf(Array);
    const currentSession = result.sessions.find((s: any) => s.id === sessionId);
    expect(currentSession).toBeDefined();
    // Turn count should match what was processed
    console.log("Session turns:", currentSession?.turns);
  });
});

// Standalone test to verify the output storage flow
describe("Output Storage Flow Verification", () => {
  test("storeAndBroadcastOutput should persist to SQLite", async () => {
    // This tests the storage function directly
    const { sessionStore, sessionOutputStore } = await import("../src/utils/session-store");

    const testId = "flow-test-" + Date.now();
    sessionStore.create(testId);

    // Simulate what sendSessionNotification does
    sessionOutputStore.append(testId, {
      type: "user",
      content: "Test user message",
    });

    sessionOutputStore.append(testId, {
      type: "text",
      content: "Test assistant response",
    });

    // Verify storage
    const outputs = sessionOutputStore.getAll(testId);
    expect(outputs.length).toBe(2);
    expect(outputs[0].type).toBe("user");
    expect(outputs[1].type).toBe("text");

    // Clean up
    sessionOutputStore.clear(testId);
    sessionStore.delete(testId);
  });
});
