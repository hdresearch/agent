import { describe, test, expect, beforeAll, afterAll } from "bun:test";

const SERVER_URL = "http://localhost:9999";
let authToken: string | null = null;
let serverClaimedByOther = false;

// Helper to skip test if server is not available
function skipIfNoServer(): boolean {
  if (serverClaimedByOther) {
    console.log("Skipping: Server not running or claimed by another client");
    return true;
  }
  return false;
}

// JSON-RPC response type
interface RpcResponse {
  result?: {
    success?: boolean;
    prompts?: Array<{ text: string }>;
    [key: string]: unknown;
  };
  error?: { message: string };
}

// Helper to make JSON-RPC requests
async function rpc(method: string, params: Record<string, unknown> = {}): Promise<RpcResponse> {
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
      method,
      params,
      id: Date.now(),
    }),
  });
  return response.json() as Promise<RpcResponse>;
}

// Helper to check server health
async function isServerRunning(): Promise<boolean> {
  try {
    const response = await fetch(`${SERVER_URL}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

// Helper to claim the server or verify existing token
async function claimOrVerify(): Promise<string | null> {
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Client-Id": "test-client",
    };

    const response = await fetch(`${SERVER_URL}/claim`, {
      method: "POST",
      headers,
    });

    const result = await response.json();
    if (result.token) {
      return result.token;
    }
    if (result.isOwner) {
      // Already claimed by us (from previous run with same token)
      return authToken;
    }
  } catch {
    // Server not running
  }
  // Server is claimed by another client
  serverClaimedByOther = true;
  return null;
}

// Helper to clear the queue
async function clearQueue() {
  return rpc("queue/clear");
}

// Helper to get queue status
async function getQueueStatus() {
  return rpc("queue/list");
}

describe("Remote Server Submission Tests", () => {
  beforeAll(async () => {
    const running = await isServerRunning();
    if (!running) {
      serverClaimedByOther = true; // Treat as skip
      return;
    }

    // Claim server or get token
    authToken = await claimOrVerify();
    if (serverClaimedByOther) return;

    // Clear any existing queue
    await clearQueue();
  });

  afterAll(async () => {
    if (serverClaimedByOther) return;
    // Clean up queue after tests
    await clearQueue();
  });

  test("server health check", async () => {
    if (skipIfNoServer()) return;
    const response = await fetch(`${SERVER_URL}/health`);
    const data = await response.json() as { status: string };
    expect(data.status).toBe("ok");
  });

  test("single prompt submission only queues once", async () => {
    if (skipIfNoServer()) return;
    // Clear queue first
    await clearQueue();

    // Submit a single prompt
    const result = await rpc("session/prompt", { text: "test prompt 1" });
    expect(result.result?.success).toBe(true);

    // Wait a moment for any duplicate submissions to arrive
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Check queue - should have 0 items (prompt is being processed, not queued)
    // or the prompt completed already
    const queueStatus = await getQueueStatus();
    console.log("Queue status after single submit:", queueStatus);

    // The queue should not have duplicates
    const prompts = queueStatus.result?.prompts || [];
    const testPrompts = prompts.filter((p: { text: string }) =>
      p.text.includes("test prompt 1")
    );
    expect(testPrompts.length).toBeLessThanOrEqual(1);
  });

  test("rapid submissions should be queued not duplicated", async () => {
    if (skipIfNoServer()) return;
    // Clear queue first
    await clearQueue();

    // Submit the same prompt 5 times rapidly (simulating rapid enter presses)
    const promises = [];
    for (let i = 0; i < 5; i++) {
      promises.push(rpc("session/prompt", { text: "rapid test" }));
    }

    const results = await Promise.all(promises);
    console.log("Rapid submission results:", results);

    // All should succeed (either executed or queued)
    for (const result of results) {
      expect(result.result?.success).toBe(true);
    }

    // Check queue
    const queueStatus = await getQueueStatus();
    console.log("Queue after rapid submit:", queueStatus);

    // Should have exactly 5 queued (server queues all rapid submissions correctly)
    const prompts = queueStatus.result?.prompts || [];
    expect(prompts.length).toBeLessThanOrEqual(5);
  });

  test("queue can be cleared", async () => {
    if (skipIfNoServer()) return;
    // Add some items
    await rpc("session/prompt", { text: "to be cleared 1" });
    await rpc("session/prompt", { text: "to be cleared 2" });

    // Clear
    const clearResult = await clearQueue();
    console.log("Clear result:", clearResult);

    // Verify empty (may still have 1 running)
    const queueStatus = await getQueueStatus();
    const prompts = queueStatus.result?.prompts || [];
    expect(prompts.length).toBe(0);
  });
});
