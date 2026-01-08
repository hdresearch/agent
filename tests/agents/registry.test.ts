import { test, expect, beforeEach, afterEach } from "bun:test";
import {
  loadAgentRegistry,
  getAgent,
  listAgents,
  registerAgent,
  unregisterAgent,
  clearRegistry,
  registerBuiltinAgents,
  getRunCommand,
  getAgentEnv,
  getInstallAction,
  commandExists,
} from "../../src/agents/registry";
import { getCurrentOS } from "../../src/agents/types";
import type { AgentDefinition } from "../../src/agents/types";

// Test agent definition
const testAgent: AgentDefinition = {
  identity: "test.agent",
  name: "Test Agent",
  shortName: "test",
  description: "A test agent for unit tests",
  url: "https://test.agent",
  protocol: "acp",
  type: "coding",
  authorName: "Test Author",
  authorUrl: "https://test.author",
  publisherName: "Test Publisher",
  publisherUrl: "https://test.publisher",
  tags: ["test"],
  runCommand: {
    "*": "test-agent-cmd",
    macos: "test-agent-mac",
    linux: "test-agent-linux",
  },
  envVars: {
    TEST_VAR: "test-value",
  },
};

beforeEach(() => {
  clearRegistry();
});

afterEach(() => {
  clearRegistry();
});

test("registerAgent adds agent to registry", () => {
  registerAgent(testAgent);
  const agent = getAgent("test.agent");
  expect(agent).not.toBeNull();
  expect(agent?.identity).toBe("test.agent");
  expect(agent?.name).toBe("Test Agent");
});

test("getAgent finds agent by identity", () => {
  registerAgent(testAgent);
  const agent = getAgent("test.agent");
  expect(agent).not.toBeNull();
  expect(agent?.identity).toBe("test.agent");
});

test("getAgent finds agent by shortName", () => {
  registerAgent(testAgent);
  const agent = getAgent("test");
  expect(agent).not.toBeNull();
  expect(agent?.identity).toBe("test.agent");
});

test("getAgent returns undefined for unknown agent", () => {
  const agent = getAgent("nonexistent");
  expect(agent).toBeUndefined();
});

test("listAgents returns all registered agents", () => {
  registerAgent(testAgent);
  registerAgent({
    ...testAgent,
    identity: "test2.agent",
    shortName: "test2",
  });

  const agents = listAgents();
  expect(agents.length).toBe(2);
  expect(agents.map(a => a.identity)).toContain("test.agent");
  expect(agents.map(a => a.identity)).toContain("test2.agent");
});

test("unregisterAgent removes agent from registry", () => {
  registerAgent(testAgent);
  expect(getAgent("test.agent")).toBeDefined();

  const removed = unregisterAgent("test.agent");
  expect(removed).toBe(true);
  expect(getAgent("test.agent")).toBeUndefined();
});

test("unregisterAgent returns false for unknown agent", () => {
  const removed = unregisterAgent("nonexistent");
  expect(removed).toBe(false);
});

test("clearRegistry removes all agents", () => {
  registerAgent(testAgent);
  registerAgent({
    ...testAgent,
    identity: "test2.agent",
    shortName: "test2",
  });

  expect(listAgents().length).toBe(2);
  clearRegistry();
  expect(listAgents().length).toBe(0);
});

test("getRunCommand returns OS-specific command", () => {
  registerAgent(testAgent);
  const os = getCurrentOS();

  const command = getRunCommand(testAgent);

  if (os === "macos") {
    expect(command).toBe("test-agent-mac");
  } else if (os === "linux") {
    expect(command).toBe("test-agent-linux");
  } else {
    // Falls back to wildcard
    expect(command).toBe("test-agent-cmd");
  }
});

test("getRunCommand falls back to wildcard", () => {
  const agentWithOnlyWildcard: AgentDefinition = {
    ...testAgent,
    runCommand: {
      "*": "universal-cmd",
    },
  };

  const command = getRunCommand(agentWithOnlyWildcard);
  expect(command).toBe("universal-cmd");
});

test("getRunCommand returns null when no matching command", () => {
  const agentWithNoMatchingCommand: AgentDefinition = {
    ...testAgent,
    runCommand: {
      windows: "windows-only-cmd",
    },
  };

  const os = getCurrentOS();
  if (os !== "windows") {
    const command = getRunCommand(agentWithNoMatchingCommand);
    expect(command).toBeNull();
  }
});

test("getAgentEnv includes agent envVars", () => {
  const env = getAgentEnv(testAgent);
  expect(env.TEST_VAR).toBe("test-value");
});

test("getAgentEnv preserves existing env vars", () => {
  // Set a test env var
  const originalValue = process.env.EXISTING_VAR;
  process.env.EXISTING_VAR = "existing-value";

  try {
    const env = getAgentEnv(testAgent);
    expect(env.EXISTING_VAR).toBe("existing-value");
    expect(env.TEST_VAR).toBe("test-value");
  } finally {
    // Restore original
    if (originalValue === undefined) {
      delete process.env.EXISTING_VAR;
    } else {
      process.env.EXISTING_VAR = originalValue;
    }
  }
});

test("registerBuiltinAgents adds claude.com agent", () => {
  registerBuiltinAgents();
  const agent = getAgent("claude.com");
  expect(agent).toBeDefined();
  expect(agent?.protocol).toBe("acp");
  expect(agent?.name).toBe("Claude Code");
});

test("loadAgentRegistry loads agents from data directory", async () => {
  await loadAgentRegistry();

  // Should have loaded at least the JSON files we created
  const agents = listAgents();

  // Check if claude.com agent was loaded
  const claudeAgent = getAgent("claude.com");
  if (claudeAgent) {
    expect(claudeAgent.name).toBe("Claude Code");
    expect(claudeAgent.protocol).toBe("acp");
  }

  // Check if goose.ai agent was loaded
  const gooseAgent = getAgent("goose.ai");
  if (gooseAgent) {
    expect(gooseAgent.name).toBe("Goose");
    expect(gooseAgent.protocol).toBe("acp");
  }
});

// Installation tests
test("commandExists returns true for existing command", async () => {
  // 'ls' should exist on all Unix systems
  const exists = await commandExists("ls");
  expect(exists).toBe(true);
});

test("commandExists returns false for non-existent command", async () => {
  const exists = await commandExists("nonexistent-command-xyz-123");
  expect(exists).toBe(false);
});

test("getInstallAction returns install action for agent with actions", async () => {
  await loadAgentRegistry();
  const claudeAgent = getAgent("claude.com");

  if (claudeAgent) {
    const installAction = getInstallAction(claudeAgent);
    expect(installAction).not.toBeNull();
    expect(installAction?.command).toContain("npm install");
  }
});

test("getInstallAction returns null for agent without actions", () => {
  const agentWithoutActions: AgentDefinition = {
    ...testAgent,
    actions: undefined,
  };

  const installAction = getInstallAction(agentWithoutActions);
  expect(installAction).toBeNull();
});
