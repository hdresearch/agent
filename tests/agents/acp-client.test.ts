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
  });

  describe("session management", () => {
    test("sessionNew sends correct params", async () => {
      (subprocess.request as ReturnType<typeof mock>).mockResolvedValue({
        sessionId: "sess-123",
      });

      const result = await client.sessionNew({ mode: "plan" });

      expect(subprocess.request).toHaveBeenCalledWith(
        "test-agent",
        "session/new",
        expect.objectContaining({ mode: "plan" })
      );
      expect(result.sessionId).toBe("sess-123");
    });

    test("sessionNew stores sessionId", async () => {
      (subprocess.request as ReturnType<typeof mock>).mockResolvedValue({
        sessionId: "sess-456",
      });

      await client.sessionNew({});

      expect(client.getSessionId()).toBe("sess-456");
    });

    test("sessionLoad restores existing session", async () => {
      (subprocess.request as ReturnType<typeof mock>).mockResolvedValue({
        sessionId: "sess-existing",
        history: [],
      });

      const result = await client.sessionLoad({ sessionId: "sess-existing" });

      expect(subprocess.request).toHaveBeenCalledWith(
        "test-agent",
        "session/load",
        { sessionId: "sess-existing" }
      );
      expect(client.getSessionId()).toBe("sess-existing");
    });
  });

  describe("prompting", () => {
    test("sessionPrompt requires sessionId", async () => {
      await expect(
        client.sessionPrompt({ prompt: "hello" })
      ).rejects.toThrow();
    });

    test("sessionPrompt sends prompt with sessionId", async () => {
      // Setup session first
      (subprocess.request as ReturnType<typeof mock>).mockResolvedValue({
        sessionId: "sess-789",
      });
      await client.sessionNew({});

      (subprocess.request as ReturnType<typeof mock>).mockResolvedValue({
        content: [{ type: "text", text: "response" }],
      });

      await client.sessionPrompt({ prompt: "hello" });

      expect(subprocess.request).toHaveBeenLastCalledWith(
        "test-agent",
        "session/prompt",
        expect.objectContaining({
          sessionId: "sess-789",
          prompt: "hello",
        })
      );
    });
  });

  describe("error handling", () => {
    test("initialize handles subprocess failure", async () => {
      (subprocess.request as ReturnType<typeof mock>).mockRejectedValue(
        new Error("Subprocess not running")
      );

      await expect(client.initialize()).rejects.toThrow("Subprocess not running");
    });

    test("sessionNew handles invalid response", async () => {
      (subprocess.request as ReturnType<typeof mock>).mockResolvedValue({});

      const result = await client.sessionNew({});
      // Should handle gracefully - sessionId will be undefined
      expect(client.getSessionId()).toBeUndefined();
    });
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

    await client1.sessionNew({});
    await client2.sessionNew({});

    expect(client1.getSessionId()).toBe("sess-a1");
    expect(client2.getSessionId()).toBe("sess-a2");
  });
});
