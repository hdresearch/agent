import { describe, test, expect, mock, beforeEach } from "bun:test";
import { handleSlashCommand, type CommandHandlerContext } from "../../../src/cli/handlers/command-handlers";
import type { OutputLine, StatusInfo } from "../../../src/cli/types";
import type { SessionConfig } from "../../../src/protocol/acp-types";

// Create mock context
function createMockContext(): CommandHandlerContext & { outputs: Omit<OutputLine, "id">[] } {
  const outputs: Omit<OutputLine, "id">[] = [];

  return {
    outputs,
    client: null,
    sessionConfig: { model: "opus", thinkingBudget: null },
    setSessionConfig: mock(() => {}),
    statusInfo: {
      model: "opus",
      thinking: { enabled: false, budget: null },
      cost: { totalCost: 0, inputTokens: 0, outputTokens: 0 },
      planMode: false,
    },
    setStatusInfo: mock(() => {}),
    addOutput: (line) => outputs.push(line),
    setOutput: mock(() => {}),
    clearOutput: mock(() => {}),
    setContinueMode: mock(() => {}),
    historyRef: { current: null },
    exit: mock(() => {}),
  };
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
});
