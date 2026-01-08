import { test, expect, beforeEach, afterEach } from "bun:test";
import {
  createAgentRunner,
  SubprocessAgentRunner,
} from "../../src/agents/agent-runner";
import {
  registerAgent,
  clearRegistry,
  registerBuiltinAgents,
} from "../../src/agents/registry";
import type { AgentDefinition } from "../../src/agents/types";

// Test ACP agent definition with all required fields
const testAcpAgent: AgentDefinition = {
  identity: "test.acp",
  name: "Test ACP Agent",
  shortName: "testacp",
  description: "A test ACP agent",
  url: "https://test.acp",
  protocol: "acp",
  type: "coding",
  authorName: "Test Author",
  authorUrl: "https://test.author",
  publisherName: "Test Publisher",
  publisherUrl: "https://test.publisher",
  tags: ["test"],
  runCommand: {
    "*": "echo test",
  },
};

// Test non-ACP agent definition (should be rejected)
const testNonAcpAgent: AgentDefinition = {
  identity: "test.nonacp",
  name: "Test Non-ACP Agent",
  shortName: "testnonacp",
  description: "A test non-ACP agent",
  url: "https://test.nonacp",
  protocol: "claude-sdk",
  type: "coding",
  authorName: "Test Author",
  authorUrl: "https://test.author",
  publisherName: "Test Publisher",
  publisherUrl: "https://test.publisher",
  tags: ["test"],
  runCommand: {},
};

beforeEach(() => {
  clearRegistry();
  registerBuiltinAgents();
});

afterEach(() => {
  clearRegistry();
});

test("createAgentRunner returns SubprocessAgentRunner for ACP agent", () => {
  registerAgent(testAcpAgent);
  const runner = createAgentRunner("test.acp", process.cwd());
  expect(runner).toBeInstanceOf(SubprocessAgentRunner);
  expect(runner.agentId).toBe("test.acp");
});

test("createAgentRunner throws for non-ACP protocol agent", () => {
  registerAgent(testNonAcpAgent);
  expect(() => createAgentRunner("test.nonacp", process.cwd())).toThrow(
    "unsupported protocol"
  );
});

test("createAgentRunner throws for unknown agent", () => {
  expect(() => createAgentRunner("nonexistent", process.cwd())).toThrow(
    "Unknown agent: nonexistent"
  );
});

test("SubprocessAgentRunner has correct agentId", () => {
  registerAgent(testAcpAgent);
  const runner = createAgentRunner("test.acp", process.cwd()) as SubprocessAgentRunner;
  expect(runner.agentId).toBe("test.acp");
});

test("SubprocessAgentRunner.isRunning() returns false initially", () => {
  registerAgent(testAcpAgent);
  const runner = createAgentRunner("test.acp", process.cwd()) as SubprocessAgentRunner;
  expect(runner.isRunning()).toBe(false);
});

test("SubprocessAgentRunner.runPrompt() throws if not started", () => {
  registerAgent(testAcpAgent);
  const runner = createAgentRunner("test.acp", process.cwd()) as SubprocessAgentRunner;

  expect(() =>
    runner.runPrompt({ prompt: "test" })
  ).toThrow("Agent not started");
});
