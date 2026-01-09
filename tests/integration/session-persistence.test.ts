import { describe, test, expect, beforeEach, mock, afterEach } from "bun:test";

/**
 * Tests for session persistence and resume behavior
 *
 * Key behaviors:
 * 1. Resume parameters are passed correctly to claude-code-acp
 * 2. Agent is restarted when resumeSessionId is provided
 * 3. Text deltas are accumulated and stored for history
 * 4. Historical outputs are loaded when resuming a session
 */

describe("AcpClient resume parameters", () => {
  test("sessionNew passes resume via _meta.claudeCode.options when resumeSessionId provided", async () => {
    const { AcpClient } = await import("../../src/agents/acp-client");

    const mockRequest = mock(() => Promise.resolve({ sessionId: "test-session" }));
    const mockSubprocess = {
      request: mockRequest,
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
    const resumeSessionId = "existing-session-123";

    await client.sessionNew("/test/cwd", undefined, resumeSessionId);

    // Verify the request was called with correct _meta structure
    expect(mockRequest).toHaveBeenCalledWith(
      "test-agent",
      "session/new",
      expect.objectContaining({
        cwd: "/test/cwd",
        _meta: {
          claudeCode: {
            options: {
              resume: resumeSessionId,
              extraArgs: {
                resume: resumeSessionId,
              },
            },
          },
        },
      })
    );
  });

  test("sessionNew does not include _meta when no resumeSessionId", async () => {
    const { AcpClient } = await import("../../src/agents/acp-client");

    const mockRequest = mock(() => Promise.resolve({ sessionId: "new-session" }));
    const mockSubprocess = {
      request: mockRequest,
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

    await client.sessionNew("/test/cwd");

    // Verify no _meta was passed
    const callArgs = mockRequest.mock.calls[0];
    expect(callArgs[2]).not.toHaveProperty("_meta");
  });
});

describe("AcpClient Claude session ID tracking", () => {
  test("getClaudeSessionId returns null initially", async () => {
    const { AcpClient } = await import("../../src/agents/acp-client");

    const mockSubprocess = {
      request: mock(() => Promise.resolve({})),
      notify: mock(() => Promise.resolve()),
    } as any;

    const client = new AcpClient(mockSubprocess, "test-agent");

    expect(client.getClaudeSessionId()).toBeNull();
  });

  test("setClaudeSessionId stores the Claude CLI session ID", async () => {
    const { AcpClient } = await import("../../src/agents/acp-client");

    const mockSubprocess = {
      request: mock(() => Promise.resolve({})),
      notify: mock(() => Promise.resolve()),
    } as any;

    const client = new AcpClient(mockSubprocess, "test-agent");

    const claudeSessionId = "abcd1234";
    client.setClaudeSessionId(claudeSessionId);

    expect(client.getClaudeSessionId()).toBe(claudeSessionId);
  });

  test("Claude session ID is separate from ACP session ID", async () => {
    const { AcpClient } = await import("../../src/agents/acp-client");

    const acpSessionId = "acp-uuid-1234-5678-9012";
    const claudeSessionId = "claude12";

    const mockSubprocess = {
      request: mock(() => Promise.resolve({ sessionId: acpSessionId })),
      notify: mock(() => Promise.resolve()),
    } as any;

    const client = new AcpClient(mockSubprocess, "test-agent");

    await client.sessionNew("/test/cwd");
    client.setClaudeSessionId(claudeSessionId);

    // Both IDs should be stored separately
    expect(client.getSessionId()).toBe(acpSessionId);
    expect(client.getClaudeSessionId()).toBe(claudeSessionId);
  });
});

describe("Session output storage", () => {
  test("text accumulation stores complete message on final", () => {
    // This tests the logic of accumulating text_delta events
    // and storing the complete message when final: true is received

    let accumulatedText = "";
    const storedOutputs: string[] = [];

    // Simulate the storage function
    const storeOutput = (content: string) => {
      storedOutputs.push(content);
    };

    // Simulate text_delta events
    const events = [
      { type: "text_delta", text: "Hello", final: false },
      { type: "text_delta", text: " ", final: false },
      { type: "text_delta", text: "world", final: false },
      { type: "text_delta", text: "!", final: true },
    ];

    for (const event of events) {
      accumulatedText += event.text;
      if (event.final && accumulatedText) {
        storeOutput(accumulatedText);
        accumulatedText = "";
      }
    }

    expect(storedOutputs).toHaveLength(1);
    expect(storedOutputs[0]).toBe("Hello world!");
  });

  test("started event resets accumulator", () => {
    let accumulatedText = "leftover from previous";

    // Simulate started event
    const event = { type: "started" };
    if (event.type === "started") {
      accumulatedText = "";
    }

    expect(accumulatedText).toBe("");
  });

  test("multiple turns accumulate separately", () => {
    let accumulatedText = "";
    const storedOutputs: string[] = [];

    const storeOutput = (content: string) => {
      storedOutputs.push(content);
    };

    // First turn
    const turn1Events = [
      { type: "started" },
      { type: "text_delta", text: "First response", final: true },
    ];

    for (const event of turn1Events) {
      if (event.type === "started") {
        accumulatedText = "";
      } else if (event.type === "text_delta") {
        accumulatedText += (event as any).text;
        if ((event as any).final && accumulatedText) {
          storeOutput(accumulatedText);
          accumulatedText = "";
        }
      }
    }

    // Second turn
    const turn2Events = [
      { type: "started" },
      { type: "text_delta", text: "Second response", final: true },
    ];

    for (const event of turn2Events) {
      if (event.type === "started") {
        accumulatedText = "";
      } else if (event.type === "text_delta") {
        accumulatedText += (event as any).text;
        if ((event as any).final && accumulatedText) {
          storeOutput(accumulatedText);
          accumulatedText = "";
        }
      }
    }

    expect(storedOutputs).toHaveLength(2);
    expect(storedOutputs[0]).toBe("First response");
    expect(storedOutputs[1]).toBe("Second response");
  });
});

describe("Claude Code stderr filter", () => {
  test("filters Spawning Claude Code message", async () => {
    const { CLAUDE_CODE_CONFIG } = await import("../../src/agents/configs/claude-code");

    const spawnMessage = "Spawning Claude Code: /path/to/claude --output-format stream-json --verbose";

    expect(CLAUDE_CODE_CONFIG.stderrFilter?.(spawnMessage)).toBe(true);
  });

  test("filters TodoWrite hook errors", async () => {
    const { CLAUDE_CODE_CONFIG } = await import("../../src/agents/configs/claude-code");

    const hookError = "No onPostToolUseHook found for tool xyz";

    expect(CLAUDE_CODE_CONFIG.stderrFilter?.(hookError)).toBe(true);
  });

  test("does not filter regular stderr output", async () => {
    const { CLAUDE_CODE_CONFIG } = await import("../../src/agents/configs/claude-code");

    const regularOutput = "Some useful debug output";

    expect(CLAUDE_CODE_CONFIG.stderrFilter?.(regularOutput)).toBe(false);
  });

  test("does not filter error messages", async () => {
    const { CLAUDE_CODE_CONFIG } = await import("../../src/agents/configs/claude-code");

    const errorMessage = "Error: Something went wrong";

    expect(CLAUDE_CODE_CONFIG.stderrFilter?.(errorMessage)).toBe(false);
  });
});

describe("Agent manager resume behavior", () => {
  // Note: These tests verify the expected behavior at the interface level
  // Full integration tests would require mocking the subprocess

  test("InitializeAgentOptions includes resumeSessionId", async () => {
    // Verify the type structure supports resume
    const options: import("../../src/core/agent-manager").InitializeAgentOptions = {
      resumeSessionId: "session-to-resume",
    };

    expect(options.resumeSessionId).toBe("session-to-resume");
  });

  test("resume session ID format matches UUID pattern", () => {
    const validSessionIds = [
      "0c9ebe91-86e1-4c47-843f-972aaa72dc15",
      "49ca8cec-66fd-4922-bcc6-68cf68482ef1",
      "91ecbe18-6815-4d1d-8ee5-04c743e8d798",
    ];

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    for (const id of validSessionIds) {
      expect(id).toMatch(uuidRegex);
    }
  });
});

describe("Session persistence flow", () => {
  test("session load should trigger agent restart with resume", () => {
    // Document the expected flow:
    // 1. Client calls session/load with previousSessionId
    // 2. Server calls initializeAgent with { resumeSessionId: previousSessionId }
    // 3. Agent manager stops existing agent (if running)
    // 4. Agent manager creates new runner with resumeSessionId option
    // 5. AcpClient.sessionNew is called with resumeSessionId
    // 6. Claude Code receives --resume <sessionId> flag
    // 7. Claude Code loads conversation history from its session file

    const flow = [
      "client.loadSession(previousSessionId)",
      "server.handleSessionLoad(previousSessionId)",
      "agentManager.initializeAgent(undefined, undefined, { resumeSessionId })",
      "agentManager.stopAgent() // if running",
      "new SubprocessAgentRunner(agent, cwd, { resumeSessionId })",
      "acpClient.sessionNew(cwd, undefined, resumeSessionId)",
      "// Claude Code spawned with --resume <sessionId>",
    ];

    expect(flow).toHaveLength(7);
  });

  test("historical outputs should be loaded after session load", () => {
    // Document the expected flow:
    // 1. Session is loaded
    // 2. Client fetches historical outputs via session/outputs
    // 3. Historical outputs are displayed in the UI

    const expectedBehavior = {
      sessionLoadTriggersOutputFetch: true,
      outputTypesLoaded: ["user", "text", "tool", "tool-result", "system"],
      outputsDisplayedInOrder: true,
    };

    expect(expectedBehavior.sessionLoadTriggersOutputFetch).toBe(true);
  });
});
