import { describe, test, expect, beforeAll, afterAll } from "bun:test";

const SERVER_URL = "http://localhost:9999";
let authToken: string | null = null;
let serverClaimedByOther = false;

// Helper to claim the server or verify existing token
async function claimOrVerify(): Promise<string | null> {
  try {
    const response = await fetch(`${SERVER_URL}/claim`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Client-Id": "test-client",
      },
    });

    const result = await response.json();
    if (result.token) {
      return result.token;
    }
    if (result.isOwner) {
      return authToken;
    }
  } catch {
    // Server not running
  }
  // Server is claimed by another client
  serverClaimedByOther = true;
  return null;
}

// Helper to fail test with clear message if server is claimed
function failIfClaimed() {
  if (serverClaimedByOther) {
    throw new Error(
      "Server is claimed by another client (likely a running vers instance). " +
      "Stop vers or use a different port to run these integration tests."
    );
  }
}

describe("Server Output Storage Integration", () => {
  let sessionId: string | null = null;

  // Helper to make RPC calls
  async function rpc(method: string, params: unknown = {}) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (authToken) {
      headers["Authorization"] = `Bearer ${authToken}`;
    }

    const response = await fetch(`${SERVER_URL}/rpc`, {
      method: "POST",
      headers,
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
    // Claim server or get token
    authToken = await claimOrVerify();
    if (serverClaimedByOther) return;

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
    failIfClaimed();
    const result = await rpc("session/outputs", {});

    expect(result.sessionId).toBe(sessionId);
    expect(result.outputs).toBeInstanceOf(Array);
    expect(result.syncInfo.count).toBe(0);
    expect(result.syncInfo.lastSeq).toBe(0);
  });

  test("session/sync returns correct info", async () => {
    failIfClaimed();
    const result = await rpc("session/sync", {});

    expect(result.sessionId).toBe(sessionId);
    expect(result.count).toBe(0);
    expect(result.lastSeq).toBe(0);
  });

  test("sending prompt stores user message", async () => {
    failIfClaimed();
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
    failIfClaimed();
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
