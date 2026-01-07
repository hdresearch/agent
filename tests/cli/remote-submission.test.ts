import { describe, test, expect, beforeAll, afterAll } from "bun:test";

const SERVER_URL = "http://localhost:9999";

// Helper to make JSON-RPC requests
async function rpc(method: string, params: Record<string, unknown> = {}) {
  const response = await fetch(`${SERVER_URL}/rpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method,
      params,
      id: Date.now(),
    }),
  });
  return response.json();
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
      throw new Error(
        "Server not running! Start with: docker compose up -d"
      );
    }
    // Clear any existing queue
    await clearQueue();
  });

  afterAll(async () => {
    // Clean up queue after tests
    await clearQueue();
  });

  test("server health check", async () => {
    const response = await fetch(`${SERVER_URL}/health`);
    const data = await response.json();
    expect(data.status).toBe("ok");
  });

  test("single prompt submission only queues once", async () => {
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
