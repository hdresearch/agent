import { describe, test, expect, mock, beforeEach } from "bun:test";
import { handleSlashCommand, type CommandHandlerContext } from "../../../src/cli/handlers/command-handlers";
import type { OutputLine, StatusInfo } from "../../../src/cli/types";
import type { SessionConfig } from "../../../src/protocol/acp-types";

// Create mock context
function createMockContext(overrides?: Partial<CommandHandlerContext>): CommandHandlerContext & {
  outputs: Omit<OutputLine, "id">[];
  getReconnectUrl: () => string | null;
} {
  const outputs: Omit<OutputLine, "id">[] = [];
  const state = { reconnectUrl: null as string | null };

  const ctx = {
    outputs,
    getReconnectUrl: () => state.reconnectUrl,
    client: null,
    sessionConfig: { model: "opus", thinkingBudget: null },
    setSessionConfig: mock(() => {}),
    statusInfo: {
      model: "opus",
      thinking: { enabled: false, budget: null },
      cost: { totalCost: 0, inputTokens: 0, outputTokens: 0 },
      planMode: false,
      sessionId: null,
    },
    setStatusInfo: mock(() => {}),
    addOutput: (line: Omit<OutputLine, "id">) => outputs.push(line),
    setOutput: mock(() => {}),
    clearOutput: mock(() => {}),
    setContinueMode: mock(() => {}),
    historyRef: { current: null },
    exit: mock(() => {}),
    reconnect: (url: string) => { state.reconnectUrl = url; },
    currentServerUrl: undefined,
    ...overrides,
  };

  return ctx;
}

describe("handleSlashCommand", () => {
  describe("/help", () => {
    test("shows help information", () => {
      const ctx = createMockContext();
      const result = handleSlashCommand("/help", ctx);

      expect(result.handled).toBe(true);
      expect(ctx.outputs.some(o => o.content.includes("Available commands"))).toBe(true);
      expect(ctx.outputs.some(o => o.content.includes("Bash escape"))).toBe(true);
    });

    test("handles /h alias", () => {
      const ctx = createMockContext();
      const result = handleSlashCommand("/h", ctx);

      expect(result.handled).toBe(true);
      expect(ctx.outputs.some(o => o.content.includes("Available commands"))).toBe(true);
    });
  });

  describe("/model", () => {
    test("shows current model when no arg", () => {
      const ctx = createMockContext();
      const result = handleSlashCommand("/model", ctx);

      expect(result.handled).toBe(true);
      expect(ctx.outputs.some(o => o.content.includes("Current model"))).toBe(true);
    });

    test("sets model to sonnet", () => {
      const ctx = createMockContext();
      const result = handleSlashCommand("/model sonnet", ctx);

      expect(result.handled).toBe(true);
      expect(ctx.outputs.some(o => o.content.includes("Model set to: sonnet"))).toBe(true);
      expect(ctx.setSessionConfig).toHaveBeenCalled();
    });

    test("sets model to haiku", () => {
      const ctx = createMockContext();
      const result = handleSlashCommand("/model haiku", ctx);

      expect(result.handled).toBe(true);
      expect(ctx.outputs.some(o => o.content.includes("Model set to: haiku"))).toBe(true);
    });

    test("rejects invalid model", () => {
      const ctx = createMockContext();
      const result = handleSlashCommand("/model gpt4", ctx);

      expect(result.handled).toBe(true);
      expect(ctx.outputs.some(o => o.content.includes("Usage:"))).toBe(true);
    });
  });

  describe("/thinking", () => {
    test("shows current state when no arg", () => {
      const ctx = createMockContext();
      const result = handleSlashCommand("/thinking", ctx);

      expect(result.handled).toBe(true);
      // Should enable with default budget
      expect(ctx.outputs.some(o => o.content.includes("Thinking mode: ON"))).toBe(true);
    });

    test("turns thinking off", () => {
      const ctx = createMockContext();
      const result = handleSlashCommand("/thinking off", ctx);

      expect(result.handled).toBe(true);
      expect(ctx.outputs.some(o => o.content.includes("Thinking mode: OFF"))).toBe(true);
    });

    test("turns thinking on with custom budget", () => {
      const ctx = createMockContext();
      const result = handleSlashCommand("/thinking on 5000", ctx);

      expect(result.handled).toBe(true);
      expect(ctx.outputs.some(o => o.content.includes("5,000 tokens"))).toBe(true);
    });

    test("rejects budget below 1024", () => {
      const ctx = createMockContext();
      const result = handleSlashCommand("/thinking on 500", ctx);

      expect(result.handled).toBe(true);
      expect(ctx.outputs.some(o => o.type === "error")).toBe(true);
    });
  });

  describe("/clear", () => {
    test("clears output", () => {
      const ctx = createMockContext();
      const result = handleSlashCommand("/clear", ctx);

      expect(result.handled).toBe(true);
      expect(ctx.setOutput).toHaveBeenCalled();
    });
  });

  describe("/new", () => {
    test("starts new conversation", () => {
      const ctx = createMockContext();
      const result = handleSlashCommand("/new", ctx);

      expect(result.handled).toBe(true);
      expect(ctx.setContinueMode).toHaveBeenCalled();
      expect(ctx.outputs.some(o => o.content.includes("Starting new conversation"))).toBe(true);
    });
  });

  describe("/continue", () => {
    test("sets continue mode", () => {
      const ctx = createMockContext();
      const result = handleSlashCommand("/continue", ctx);

      expect(result.handled).toBe(true);
      expect(ctx.setContinueMode).toHaveBeenCalled();
      expect(ctx.outputs.some(o => o.content.includes("Will continue last conversation"))).toBe(true);
    });
  });

  describe("unknown command", () => {
    test("shows error for unknown command", () => {
      const ctx = createMockContext();
      const result = handleSlashCommand("/unknown", ctx);

      expect(result.handled).toBe(true);
      expect(ctx.outputs.some(o => o.type === "error" && o.content.includes("Unknown command"))).toBe(true);
    });
  });

  describe("/connect", () => {
    test("shows usage when no URL provided", () => {
      const ctx = createMockContext();
      const result = handleSlashCommand("/connect", ctx);

      expect(result.handled).toBe(true);
      expect(ctx.outputs.some(o => o.content.includes("Usage: /connect <url>"))).toBe(true);
    });

    test("shows current connection when no URL provided and connected", () => {
      const ctx = createMockContext({ currentServerUrl: "http://localhost:9999" });
      const result = handleSlashCommand("/connect", ctx);

      expect(result.handled).toBe(true);
      expect(ctx.outputs.some(o => o.content.includes("Currently connected to: http://localhost:9999"))).toBe(true);
    });

    test("triggers reconnect with valid URL", () => {
      const ctx = createMockContext();
      const result = handleSlashCommand("/connect http://localhost:9999", ctx);

      expect(result.handled).toBe(true);
      expect(ctx.getReconnectUrl()).toBe("http://localhost:9999");
    });

    test("triggers reconnect with remote URL", () => {
      const ctx = createMockContext();
      const result = handleSlashCommand("/connect http://192.168.1.100:9999", ctx);

      expect(result.handled).toBe(true);
      expect(ctx.getReconnectUrl()).toBe("http://192.168.1.100:9999");
    });

    test("rejects invalid URL", () => {
      const ctx = createMockContext();
      const result = handleSlashCommand("/connect not-a-url", ctx);

      expect(result.handled).toBe(true);
      expect(ctx.outputs.some(o => o.type === "error" && o.content.includes("Invalid URL"))).toBe(true);
      expect(ctx.getReconnectUrl()).toBeNull();
    });
  });

  describe("/local", () => {
    test("clears saved server and shows message", () => {
      const ctx = createMockContext();
      const result = handleSlashCommand("/local", ctx);

      expect(result.handled).toBe(true);
      expect(ctx.outputs.some(o => o.content.includes("Cleared saved remote server"))).toBe(true);
      expect(ctx.outputs.some(o => o.content.includes("Next launch will start in local mode"))).toBe(true);
    });
  });

  describe("agent commands", () => {
    const agentCommands = [
      { name: "compact", description: "Compact context" },
      { name: "config", description: "Show configuration" },
      { name: "cost", description: "Show cost" },
    ];

    test("unknown command shows error when no agent commands", () => {
      const ctx = createMockContext();
      const result = handleSlashCommand("/unknown", ctx);

      expect(result.handled).toBe(true);
      expect(ctx.outputs.some(o => o.type === "error" && o.content.includes("Unknown command"))).toBe(true);
    });

    test("unknown command shows error when not in agent commands", () => {
      const ctx = createMockContext({ agentCommands });
      const result = handleSlashCommand("/unknown", ctx);

      expect(result.handled).toBe(true);
      expect(ctx.outputs.some(o => o.type === "error" && o.content.includes("Unknown command"))).toBe(true);
    });

    test("agent command returns handled: false to pass through", () => {
      const ctx = createMockContext({ agentCommands });
      const result = handleSlashCommand("/cost", ctx);

      // Agent commands should NOT be handled locally - they pass through to the agent
      expect(result.handled).toBe(false);
      // No error message should be shown
      expect(ctx.outputs.filter(o => o.type === "error").length).toBe(0);
    });

    test("agent command with args returns handled: false", () => {
      const ctx = createMockContext({ agentCommands });
      const result = handleSlashCommand("/config set foo bar", ctx);

      expect(result.handled).toBe(false);
      expect(ctx.outputs.filter(o => o.type === "error").length).toBe(0);
    });

    test("local command still handled when agent has same command", () => {
      // "compact" is both local and agent - local should still be handled locally
      const ctx = createMockContext({ agentCommands });
      const result = handleSlashCommand("/compact", ctx);

      // Local /compact is handled by the local handler
      expect(result.handled).toBe(true);
    });
  });
});
