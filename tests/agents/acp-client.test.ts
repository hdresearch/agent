import { describe, test, expect, beforeEach, mock } from "bun:test";
import { AcpClient } from "../../src/agents/acp-client";
import type { SubprocessManager } from "../../src/agents/subprocess-manager";

// Mock subprocess manager
function createMockSubprocess(): SubprocessManager {
  return {
    request: mock(() => Promise.resolve({})),
    notify: mock(() => Promise.resolve()),
    spawn: mock(() => Promise.resolve()),
    stop: mock(() => Promise.resolve()),
    stopAll: mock(() => Promise.resolve()),
    isRunning: mock(() => true),
    getState: mock(() => null),
    onRequest: mock(() => () => {}),
    onNotification: mock(() => () => {}),
  } as unknown as SubprocessManager;
}

describe("AcpClient", () => {
  let subprocess: ReturnType<typeof createMockSubprocess>;
  let client: AcpClient;

  beforeEach(() => {
    subprocess = createMockSubprocess();
    client = new AcpClient(subprocess, "test-agent");
  });

  describe("initialization", () => {
    test("sessionId is null before initialize", () => {
      expect(client.getSessionId()).toBeNull();
    });

    test("capabilities is empty before initialize", () => {
      expect(client.getCapabilities()).toEqual({});
    });

    test("initialize sends correct params", async () => {
      (subprocess.request as ReturnType<typeof mock>).mockResolvedValue({
        protocolVersion: 1,
        agentInfo: { name: "test", version: "1.0" },
        agentCapabilities: { session: { modes: ["default"] } },
      });

      await client.initialize();

      expect(subprocess.request).toHaveBeenCalledWith(
        "test-agent",
        "initialize",
        expect.objectContaining({
          protocolVersion: 1,
          clientInfo: expect.objectContaining({ name: "vers-agent" }),
        })
      );
    });

    test("initialize stores capabilities from response", async () => {
      const mockCapabilities = {
        session: { modes: ["default", "plan"] },
        mcp: { tools: true },
      };
      (subprocess.request as ReturnType<typeof mock>).mockResolvedValue({
        protocolVersion: 1,
        agentInfo: { name: "test", version: "1.0" },
        agentCapabilities: mockCapabilities,
      });

      await client.initialize();

      expect(client.getCapabilities()).toEqual(mockCapabilities);
    });

    test("initialize uses custom config", async () => {
      const customConfig = {
        clientInfo: { name: "custom-client", version: "2.0.0" },
        capabilities: {
          fileSystem: { read: true, write: false },
          terminal: { create: false },
        },
      };
      const customClient = new AcpClient(subprocess, "test-agent", customConfig);

      (subprocess.request as ReturnType<typeof mock>).mockResolvedValue({
        protocolVersion: 1,
        agentInfo: { name: "test", version: "1.0" },
      });

      await customClient.initialize();

      expect(subprocess.request).toHaveBeenCalledWith(
        "test-agent",
        "initialize",
        expect.objectContaining({
          clientInfo: expect.objectContaining({ name: "custom-client" }),
        })
      );
    });
  });

  describe("session management", () => {
    test("sessionNew sends correct params with cwd", async () => {
      (subprocess.request as ReturnType<typeof mock>).mockResolvedValue({
        sessionId: "sess-123",
      });

      const result = await client.sessionNew("/test/cwd");

      expect(subprocess.request).toHaveBeenCalledWith(
        "test-agent",
        "session/new",
        expect.objectContaining({ cwd: "/test/cwd" })
      );
      expect(result.sessionId).toBe("sess-123");
    });

    test("sessionNew stores sessionId", async () => {
      (subprocess.request as ReturnType<typeof mock>).mockResolvedValue({
        sessionId: "sess-456",
      });

      await client.sessionNew("/test/cwd");

      expect(client.getSessionId()).toBe("sess-456");
    });

    test("sessionNew accepts mcpServers", async () => {
      (subprocess.request as ReturnType<typeof mock>).mockResolvedValue({
        sessionId: "sess-789",
      });

      const mcpServers = [{ name: "test-mcp", command: "test-cmd" }];
      await client.sessionNew("/test/cwd", mcpServers);

      expect(subprocess.request).toHaveBeenCalledWith(
        "test-agent",
        "session/new",
        expect.objectContaining({
          cwd: "/test/cwd",
          mcpServers,
        })
      );
    });
  });

  describe("prompting", () => {
    test("sessionPrompt requires sessionId", async () => {
      await expect(
        client.sessionPrompt([{ type: "text", text: "hello" }])
      ).rejects.toThrow("No active session");
    });

    test("sessionPrompt sends prompt with sessionId", async () => {
      // Setup session first
      (subprocess.request as ReturnType<typeof mock>).mockResolvedValue({
        sessionId: "sess-789",
      });
      await client.sessionNew("/test/cwd");

      (subprocess.request as ReturnType<typeof mock>).mockResolvedValue({
        stopReason: "end_turn",
      });

      await client.sessionPrompt([{ type: "text", text: "hello" }]);

      expect(subprocess.request).toHaveBeenLastCalledWith(
        "test-agent",
        "session/prompt",
        expect.objectContaining({
          sessionId: "sess-789",
          prompt: [{ type: "text", text: "hello" }],
        }),
        expect.any(Number) // timeout
      );
    });

    test("prompt convenience method works", async () => {
      // Setup session first
      (subprocess.request as ReturnType<typeof mock>).mockResolvedValue({
        sessionId: "sess-123",
      });
      await client.sessionNew("/test/cwd");

      (subprocess.request as ReturnType<typeof mock>).mockResolvedValue({
        stopReason: "end_turn",
      });

      await client.prompt("hello world");

      expect(subprocess.request).toHaveBeenLastCalledWith(
        "test-agent",
        "session/prompt",
        expect.objectContaining({
          prompt: [{ type: "text", text: "hello world" }],
        }),
        expect.any(Number)
      );
    });
  });

  describe("cancellation", () => {
    test("sessionCancel sends notification", async () => {
      // Setup session first
      (subprocess.request as ReturnType<typeof mock>).mockResolvedValue({
        sessionId: "sess-cancel",
      });
      await client.sessionNew("/test/cwd");

      await client.sessionCancel();

      expect(subprocess.notify).toHaveBeenCalledWith(
        "test-agent",
        "session/cancel",
        expect.objectContaining({ sessionId: "sess-cancel" })
      );
    });

    test("sessionCancel does nothing without session", async () => {
      await client.sessionCancel();
      expect(subprocess.notify).not.toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    test("initialize handles subprocess failure", async () => {
      (subprocess.request as ReturnType<typeof mock>).mockRejectedValue(
        new Error("Subprocess not running")
      );

      await expect(client.initialize()).rejects.toThrow("Subprocess not running");
    });

    test("sessionNew handles missing sessionId in response", async () => {
      (subprocess.request as ReturnType<typeof mock>).mockResolvedValue({});

      await client.sessionNew("/test/cwd");
      // Should handle gracefully - sessionId will be null (initial value)
      expect(client.getSessionId()).toBeNull();
    });
  });
});

describe("AcpClient session ID updates", () => {
  let subprocess: ReturnType<typeof createMockSubprocess>;
  let client: AcpClient;

  beforeEach(() => {
    subprocess = createMockSubprocess();
    client = new AcpClient(subprocess, "test-agent");
  });

  test("setSessionId updates the session ID", () => {
    expect(client.getSessionId()).toBeNull();

    client.setSessionId("notification-session-id-123");

    expect(client.getSessionId()).toBe("notification-session-id-123");
  });

  test("setSessionId can override session ID from sessionNew", async () => {
    // First, set session ID via sessionNew
    (subprocess.request as ReturnType<typeof mock>).mockResolvedValue({
      sessionId: "session-new-id",
    });
    await client.sessionNew("/test/cwd");
    expect(client.getSessionId()).toBe("session-new-id");

    // Then override with notification-based session ID
    client.setSessionId("notification-session-id");
    expect(client.getSessionId()).toBe("notification-session-id");
  });

  test("session ID matches UUID format", () => {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    client.setSessionId("0d54cb28-b599-4b7f-b4e1-e155535b9437");

    expect(client.getSessionId()).toMatch(uuidRegex);
  });

  test("notification session ID is preserved when sessionNew response arrives", async () => {
    // Simulate: notification arrives BEFORE sessionNew response
    // 1. Client is created (sessionId = null)
    // 2. Notification arrives with session ID "notification-id"
    // 3. sessionNew response arrives with session ID "response-id"
    // Expected: notification ID should be preserved (not overwritten)

    const notificationId = "notification-aaaa-bbbb-cccc-dddddddddddd";
    const responseId = "response-1111-2222-3333-444444444444";

    // Simulate notification arriving first
    client.setSessionId(notificationId);
    expect(client.getSessionId()).toBe(notificationId);

    // Simulate sessionNew response arriving after
    (subprocess.request as ReturnType<typeof mock>).mockResolvedValue({
      sessionId: responseId,
    });
    await client.sessionNew("/test/cwd");

    // Notification ID should be preserved
    expect(client.getSessionId()).toBe(notificationId);
  });

  test("sessionNew response is used when no notification arrived", async () => {
    const responseId = "response-1111-2222-3333-444444444444";

    // No notification, sessionId starts as null
    expect(client.getSessionId()).toBeNull();

    // sessionNew response provides the session ID
    (subprocess.request as ReturnType<typeof mock>).mockResolvedValue({
      sessionId: responseId,
    });
    await client.sessionNew("/test/cwd");

    // Response ID should be used
    expect(client.getSessionId()).toBe(responseId);
  });
});

describe("AcpClient multi-agent scenarios", () => {
  test("multiple clients can coexist", () => {
    const subprocess = createMockSubprocess();
    const client1 = new AcpClient(subprocess, "agent-1");
    const client2 = new AcpClient(subprocess, "agent-2");

    expect(client1.getSessionId()).toBeNull();
    expect(client2.getSessionId()).toBeNull();
  });

  test("clients maintain separate sessions", async () => {
    const subprocess = createMockSubprocess();
    const client1 = new AcpClient(subprocess, "agent-1");
    const client2 = new AcpClient(subprocess, "agent-2");

    (subprocess.request as ReturnType<typeof mock>)
      .mockResolvedValueOnce({ sessionId: "sess-a1" })
      .mockResolvedValueOnce({ sessionId: "sess-a2" });

    await client1.sessionNew("/cwd1");
    await client2.sessionNew("/cwd2");

    expect(client1.getSessionId()).toBe("sess-a1");
    expect(client2.getSessionId()).toBe("sess-a2");
  });

  test("clients can have different configs", () => {
    const subprocess = createMockSubprocess();
    const config1 = {
      clientInfo: { name: "client-1", version: "1.0" },
      capabilities: { fileSystem: { read: true, write: true } },
    };
    const config2 = {
      clientInfo: { name: "client-2", version: "2.0" },
      capabilities: { fileSystem: { read: true, write: false } },
    };

    const client1 = new AcpClient(subprocess, "agent-1", config1);
    const client2 = new AcpClient(subprocess, "agent-2", config2);

    expect(client1.getConfig().clientInfo.name).toBe("client-1");
    expect(client2.getConfig().clientInfo.name).toBe("client-2");
  });
});
