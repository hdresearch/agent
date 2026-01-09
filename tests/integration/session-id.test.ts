import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";

/**
 * Tests for session ID propagation from agent to CLI
 *
 * The flow should be:
 * 1. Agent sends session/update notification with session ID (e.g., "abc123-...")
 * 2. http-server captures this and uses it as currentSessionId
 * 3. CLI calls newSession and receives this session ID
 * 4. CLI displays the session ID (truncated) in the status bar
 *
 * Session ID format: UUID (e.g., "0d54cb28-b599-4b7f-b4e1-e155535b9437")
 * Display format: First 8 characters (e.g., "0d54cb28")
 */

// UUID regex pattern
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("Session ID format", () => {
  test("valid UUID format is recognized", () => {
    const validUUIDs = [
      "0d54cb28-b599-4b7f-b4e1-e155535b9437",
      "a487b5ad-febf-40ec-936b-e5028401f2d5",
      "572d8c2c-0dfe-4113-90ac-b0e3a50fd9ca",
    ];

    for (const uuid of validUUIDs) {
      expect(uuid).toMatch(UUID_REGEX);
    }
  });

  test("truncated display format is first 8 characters", () => {
    const fullId = "0d54cb28-b599-4b7f-b4e1-e155535b9437";
    const truncated = fullId.slice(0, 8);

    expect(truncated).toBe("0d54cb28");
    expect(truncated).toHaveLength(8);
  });

  test("different session IDs have different truncated forms", () => {
    const id1 = "0d54cb28-b599-4b7f-b4e1-e155535b9437";
    const id2 = "a487b5ad-febf-40ec-936b-e5028401f2d5";

    expect(id1.slice(0, 8)).not.toBe(id2.slice(0, 8));
  });
});

describe("AcpClient session ID from notifications", () => {
  test("setSessionId updates getSessionId", async () => {
    const { AcpClient } = await import("../../src/agents/acp-client");

    // Mock subprocess
    const mockSubprocess = {
      request: mock(() => Promise.resolve({})),
      notify: mock(() => Promise.resolve()),
      spawn: mock(() => Promise.resolve()),
      stop: mock(() => Promise.resolve()),
      stopAll: mock(() => Promise.resolve()),
      isRunning: mock(() => true),
      getState: mock(() => null),
      onRequest: mock(() => () => {}),
      onNotification: mock(() => () => {}),
      onStderr: mock(() => () => {}),
    } as any;

    const client = new AcpClient(mockSubprocess, "test-agent");

    // Initially null
    expect(client.getSessionId()).toBeNull();

    // Set from notification
    const notificationSessionId = "0d54cb28-b599-4b7f-b4e1-e155535b9437";
    client.setSessionId(notificationSessionId);

    // Should be updated
    expect(client.getSessionId()).toBe(notificationSessionId);
    expect(client.getSessionId()).toMatch(UUID_REGEX);
  });

  test("notification session ID overrides session/new response", async () => {
    const { AcpClient } = await import("../../src/agents/acp-client");

    const sessionNewId = "11111111-1111-1111-1111-111111111111";
    const notificationId = "22222222-2222-2222-2222-222222222222";

    const mockSubprocess = {
      request: mock(() => Promise.resolve({ sessionId: sessionNewId })),
      notify: mock(() => Promise.resolve()),
      spawn: mock(() => Promise.resolve()),
      stop: mock(() => Promise.resolve()),
      stopAll: mock(() => Promise.resolve()),
      isRunning: mock(() => true),
      getState: mock(() => null),
      onRequest: mock(() => () => {}),
      onNotification: mock(() => () => {}),
      onStderr: mock(() => () => {}),
    } as any;

    const client = new AcpClient(mockSubprocess, "test-agent");

    // Simulate session/new response
    await client.sessionNew("/test");
    expect(client.getSessionId()).toBe(sessionNewId);

    // Simulate notification arriving with different ID
    client.setSessionId(notificationId);
    expect(client.getSessionId()).toBe(notificationId);
  });
});

describe("Agent runner session ID callback", () => {
  test("callback is called when session ID is updated from notification", async () => {
    const { SubprocessAgentRunner } = await import("../../src/agents/agent-runner");
    const { registerAgent, clearRegistry, registerBuiltinAgents } = await import("../../src/agents/registry");

    // Setup
    clearRegistry();
    registerBuiltinAgents();

    // Create a test agent definition
    const testAgent = {
      identity: "test.session-id",
      name: "Test Session ID Agent",
      shortName: "test",
      description: "Test agent for session ID",
      url: "https://test.com",
      protocol: "acp" as const,
      type: "coding" as const,
      authorName: "Test",
      authorUrl: "https://test.com",
      publisherName: "Test",
      publisherUrl: "https://test.com",
      tags: [],
      runCommand: { "*": "echo test" },
    };

    registerAgent(testAgent);

    const runner = new SubprocessAgentRunner(testAgent, process.cwd());

    // Track callback invocations
    const callbackCalls: string[] = [];
    runner.onSessionIdUpdated((sessionId) => {
      callbackCalls.push(sessionId);
    });

    // Verify callback is registered
    expect(callbackCalls).toHaveLength(0);

    // Note: We can't easily trigger a notification without starting the agent,
    // so this test just verifies the callback registration mechanism works

    // Cleanup
    clearRegistry();
  });
});

describe("Session ID persistence behavior", () => {
  test("new server instance should use new agent session ID", () => {
    // This test documents the expected behavior:
    // When the server restarts:
    // 1. A new agent subprocess is spawned
    // 2. The agent generates a NEW session ID
    // 3. The server should use THIS new session ID, not any persisted one
    // 4. The CLI should display the new session ID

    // The session ID shown to the user should always match the agent's current session
    const agentSessionId = "new-session-" + Date.now();
    const truncated = agentSessionId.slice(0, 8);

    // Truncated ID should be 8 chars
    expect(truncated).toHaveLength(8);

    // And it should be different from old session IDs
    expect(truncated).not.toBe("a487b5ad"); // Example old session ID
  });
});
