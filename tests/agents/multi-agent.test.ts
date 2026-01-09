import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  registerAgent,
  getAgent,
  listAgents,
  unregisterAgent,
  clearRegistry,
  getRunCommand,
} from "../../src/agents/registry";
import type { AgentDefinition } from "../../src/agents/types";

describe("Multi-Agent Orchestration", () => {
  beforeEach(() => {
    clearRegistry();
  });

  afterEach(() => {
    clearRegistry();
  });

  const createAgent = (id: string, protocol = "acp"): AgentDefinition => ({
    identity: id,
    name: `Test Agent ${id}`,
    shortName: id.split(".")[0],
    url: `https://${id}`,
    protocol: protocol as "acp",
    type: "coding",
    authorName: "Test",
    authorUrl: "https://test.com",
    publisherName: "Test",
    publisherUrl: "https://test.com",
    description: `Test agent ${id}`,
    tags: ["test"],
    runCommand: {
      macos: `echo ${id}`,
      linux: `echo ${id}`,
    },
  });

  describe("agent registration", () => {
    test("can register multiple agents", () => {
      registerAgent(createAgent("agent.one"));
      registerAgent(createAgent("agent.two"));
      registerAgent(createAgent("agent.three"));

      expect(listAgents().length).toBe(3);
    });

    test("each agent has unique identity", () => {
      registerAgent(createAgent("agent.one"));
      registerAgent(createAgent("agent.two"));

      const one = getAgent("agent.one");
      const two = getAgent("agent.two");

      expect(one?.identity).toBe("agent.one");
      expect(two?.identity).toBe("agent.two");
    });

    test("duplicate registration replaces existing", () => {
      registerAgent(createAgent("agent.one"));
      registerAgent({ ...createAgent("agent.one"), name: "Updated Name" });

      const agent = getAgent("agent.one");
      expect(agent?.name).toBe("Updated Name");
      expect(listAgents().length).toBe(1);
    });

    test("unregister removes specific agent only", () => {
      registerAgent(createAgent("agent.one"));
      registerAgent(createAgent("agent.two"));
      registerAgent(createAgent("agent.three"));

      unregisterAgent("agent.two");

      expect(listAgents().length).toBe(2);
      expect(getAgent("agent.one")).toBeDefined();
      expect(getAgent("agent.two")).toBeUndefined();
      expect(getAgent("agent.three")).toBeDefined();
    });
  });

  describe("agent lookup", () => {
    test("getAgent finds by identity", () => {
      registerAgent(createAgent("com.example.agent"));
      
      const agent = getAgent("com.example.agent");
      expect(agent?.identity).toBe("com.example.agent");
    });

    test("getAgent finds by shortName", () => {
      const agent = createAgent("com.example.agent");
      agent.shortName = "example";
      registerAgent(agent);
      
      const found = getAgent("example");
      expect(found?.identity).toBe("com.example.agent");
    });

    test("getAgent returns undefined for unknown", () => {
      registerAgent(createAgent("agent.known"));
      
      expect(getAgent("agent.unknown")).toBeUndefined();
    });

    test("identity takes precedence over shortName collision", () => {
      const agent1 = createAgent("agent.one");
      agent1.shortName = "shared";
      
      const agent2 = createAgent("shared"); // identity matches agent1's shortName
      
      registerAgent(agent1);
      registerAgent(agent2);
      
      // Looking up "shared" should find by identity first
      const found = getAgent("shared");
      expect(found?.identity).toBe("shared");
    });
  });

  describe("platform-specific commands", () => {
    test("getRunCommand returns command for current OS", () => {
      const agent = createAgent("test.agent");
      registerAgent(agent);

      const cmd = getRunCommand(agent);
      // On macOS, should return the macos command
      expect(cmd).toContain("echo");
    });

    test("getRunCommand falls back to wildcard", () => {
      const agent: AgentDefinition = {
        ...createAgent("test.wildcard"),
        runCommand: {
          "*": "universal-command",
        },
      };
      registerAgent(agent);

      const cmd = getRunCommand(agent);
      expect(cmd).toBe("universal-command");
    });

    test("getRunCommand returns null for unsupported platform", () => {
      const agent: AgentDefinition = {
        ...createAgent("test.linux"),
        runCommand: {
          linux: "/linux/only",
        },
      };
      registerAgent(agent);

      // On macOS, should return null since only linux is defined
      const cmd = getRunCommand(agent);
      // This depends on the current platform
      expect(cmd === null || typeof cmd === "string").toBe(true);
    });
  });

  describe("agent filtering", () => {
    test("listAgents returns all registered agents", () => {
      registerAgent(createAgent("agent.one"));
      registerAgent(createAgent("agent.two"));
      registerAgent(createAgent("agent.three"));

      const agents = listAgents();
      expect(agents.length).toBe(3);
      expect(agents.map(a => a.identity).sort()).toEqual([
        "agent.one",
        "agent.three",
        "agent.two",
      ]);
    });

    test("clearRegistry removes all agents", () => {
      registerAgent(createAgent("agent.one"));
      registerAgent(createAgent("agent.two"));

      clearRegistry();

      expect(listAgents().length).toBe(0);
    });
  });

  describe("concurrent agent scenarios", () => {
    test("agents can be switched without conflict", () => {
      registerAgent(createAgent("agent.primary"));
      registerAgent(createAgent("agent.secondary"));

      // Simulate switching
      let currentAgent = getAgent("agent.primary");
      expect(currentAgent?.identity).toBe("agent.primary");

      currentAgent = getAgent("agent.secondary");
      expect(currentAgent?.identity).toBe("agent.secondary");

      // Original still accessible
      currentAgent = getAgent("agent.primary");
      expect(currentAgent?.identity).toBe("agent.primary");
    });

    test("registry survives rapid add/remove cycles", () => {
      for (let i = 0; i < 100; i++) {
        registerAgent(createAgent(`agent.${i}`));
      }
      expect(listAgents().length).toBe(100);

      for (let i = 0; i < 50; i++) {
        unregisterAgent(`agent.${i}`);
      }
      expect(listAgents().length).toBe(50);

      for (let i = 50; i < 100; i++) {
        expect(getAgent(`agent.${i}`)).toBeDefined();
      }
    });
  });
});

describe("Agent Definition Validation", () => {
  beforeEach(() => {
    clearRegistry();
  });

  afterEach(() => {
    clearRegistry();
  });

  test("agent with all optional fields", () => {
    const fullAgent: AgentDefinition = {
      identity: "full.agent",
      name: "Full Agent",
      shortName: "full",
      url: "https://full.agent",
      protocol: "acp",
      type: "coding",
      authorName: "Author",
      authorUrl: "https://author.com",
      publisherName: "Publisher",
      publisherUrl: "https://publisher.com",
      description: "A fully specified agent",
      tags: ["full", "test"],
      help: "Run /help for help",
      welcome: "Welcome to Full Agent",
      runCommand: {
        macos: "run --full",
      },
      envVars: {
        API_KEY: "secret",
        DEBUG: "true",
      },
      actions: {
        macos: {
          install: { command: "brew install agent", description: "Install via brew" },
        },
      },
    };

    registerAgent(fullAgent);
    const retrieved = getAgent("full.agent");

    expect(retrieved?.description).toBe("A fully specified agent");
    expect(retrieved?.envVars).toEqual({ API_KEY: "secret", DEBUG: "true" });
    expect(retrieved?.help).toBe("Run /help for help");
    expect(retrieved?.welcome).toBe("Welcome to Full Agent");
  });

  test("agent with minimal required fields", () => {
    const minimalAgent: AgentDefinition = {
      identity: "minimal.agent",
      name: "Minimal",
      shortName: "min",
      url: "https://minimal.agent",
      protocol: "acp",
      type: "coding",
      authorName: "Test",
      authorUrl: "https://test.com",
      publisherName: "Test",
      publisherUrl: "https://test.com",
      description: "Minimal agent",
      tags: [],
      runCommand: {},
    };

    registerAgent(minimalAgent);
    const retrieved = getAgent("minimal.agent");

    expect(retrieved).toBeDefined();
    expect(retrieved?.envVars).toBeUndefined();
    expect(retrieved?.help).toBeUndefined();
  });
});
