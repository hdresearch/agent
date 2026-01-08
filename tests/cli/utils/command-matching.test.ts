import { describe, test, expect } from "bun:test";
import {
  getMatchingCommands,
  extractPathAtCursor,
  isAgentCommand,
  type MatchedCommand,
} from "../../../src/cli/utils/command-matching";
import type { AvailableCommandData } from "../../../src/protocol/acp-types";

describe("getMatchingCommands", () => {
  test("returns empty for non-slash input", () => {
    expect(getMatchingCommands("help")).toEqual([]);
    expect(getMatchingCommands("")).toEqual([]);
  });

  test("returns empty for single slash", () => {
    expect(getMatchingCommands("/")).toEqual([]);
  });

  test("matches command by prefix", () => {
    const matches = getMatchingCommands("/he");
    expect(matches.length).toBe(1);
    expect(matches[0]?.name).toBe("help");
    expect(matches[0]?.source).toBe("local");
  });

  test("matches multiple commands", () => {
    const matches = getMatchingCommands("/c");
    expect(matches.length).toBe(4); // clear, continue, compact, connect
    expect(matches.map(m => m.name)).toContain("clear");
    expect(matches.map(m => m.name)).toContain("continue");
    expect(matches.map(m => m.name)).toContain("compact");
    expect(matches.map(m => m.name)).toContain("connect");
  });

  test("matches by alias", () => {
    const matches = getMatchingCommands("/h");
    expect(matches.some(m => m.name === "help")).toBe(true);
  });

  test("returns empty for exact match", () => {
    expect(getMatchingCommands("/help")).toEqual([]);
  });

  test("limits to 6 results", () => {
    // /s could match sessions, session - need more agent commands to test limit
    const agentCommands: AvailableCommandData[] = [
      { name: "search", description: "Search" },
      { name: "sync", description: "Sync" },
      { name: "status", description: "Status" },
      { name: "save", description: "Save" },
      { name: "set", description: "Set" },
      { name: "show", description: "Show" },
      { name: "start", description: "Start" },
    ];
    const matches = getMatchingCommands("/s", agentCommands);
    expect(matches.length).toBe(6); // Limited to 6
  });

  test("is case insensitive", () => {
    const matches = getMatchingCommands("/HE");
    expect(matches.length).toBe(1);
    expect(matches[0]?.name).toBe("help");
  });
});

describe("getMatchingCommands with agent commands", () => {
  const agentCommands: AvailableCommandData[] = [
    { name: "compact", description: "Compact context" },
    { name: "config", description: "Show configuration" },
    { name: "cost", description: "Show cost" },
    { name: "doctor", description: "Run diagnostics" },
  ];

  test("includes agent commands in results", () => {
    const matches = getMatchingCommands("/doc", agentCommands);
    expect(matches.length).toBe(2); // doctor (agent) + docs (local)
    expect(matches.some(m => m.name === "doctor" && m.source === "agent")).toBe(true);
    expect(matches.some(m => m.name === "docs" && m.source === "local")).toBe(true);
  });

  test("agent commands are marked with source: agent", () => {
    const matches = getMatchingCommands("/cost", agentCommands);
    // Exact match returns empty
    expect(matches.length).toBe(0);

    const partialMatches = getMatchingCommands("/cos", agentCommands);
    expect(partialMatches.length).toBe(1);
    expect(partialMatches[0]?.name).toBe("cost");
    expect(partialMatches[0]?.source).toBe("agent");
  });

  test("agent commands take precedence over local commands with same name", () => {
    // Both have "compact" - agent should win
    const matches = getMatchingCommands("/compa", agentCommands);
    const compactMatches = matches.filter(m => m.name === "compact");
    expect(compactMatches.length).toBe(1); // Deduplicated
    expect(compactMatches[0]?.source).toBe("agent"); // Agent takes precedence
  });

  test("local commands without agent duplicates retain local source", () => {
    const matches = getMatchingCommands("/he", agentCommands);
    expect(matches.length).toBe(1);
    expect(matches[0]?.name).toBe("help");
    expect(matches[0]?.source).toBe("local");
  });

  test("agent commands have null alias", () => {
    const matches = getMatchingCommands("/conf", agentCommands);
    const configMatch = matches.find(m => m.name === "config");
    expect(configMatch).toBeDefined();
    expect(configMatch?.alias).toBeNull();
  });

  test("returns empty when no agent commands provided", () => {
    const matches = getMatchingCommands("/cost");
    expect(matches.length).toBe(0);
  });
});

describe("isAgentCommand", () => {
  const agentCommands: AvailableCommandData[] = [
    { name: "compact", description: "Compact context" },
    { name: "config", description: "Show configuration" },
    { name: "cost", description: "Show cost" },
  ];

  test("returns true for agent command", () => {
    expect(isAgentCommand("compact", agentCommands)).toBe(true);
    expect(isAgentCommand("config", agentCommands)).toBe(true);
    expect(isAgentCommand("cost", agentCommands)).toBe(true);
  });

  test("returns false for local-only command", () => {
    expect(isAgentCommand("help", agentCommands)).toBe(false);
    expect(isAgentCommand("clear", agentCommands)).toBe(false);
    expect(isAgentCommand("model", agentCommands)).toBe(false);
  });

  test("returns false for empty agent commands", () => {
    expect(isAgentCommand("compact", [])).toBe(false);
  });

  test("returns false for unknown command", () => {
    expect(isAgentCommand("unknown", agentCommands)).toBe(false);
  });
});

describe("extractPathAtCursor", () => {
  test("returns null when no @ found", () => {
    expect(extractPathAtCursor("hello world", 5)).toBeNull();
    expect(extractPathAtCursor("hello world", 11)).toBeNull();
  });

  test("extracts path at cursor after @", () => {
    const result = extractPathAtCursor("look at @src/file.ts", 20);
    expect(result).toEqual({ path: "src/file.ts", startIndex: 8 });
  });

  test("extracts partial path at cursor", () => {
    const result = extractPathAtCursor("look at @src/fi", 15);
    expect(result).toEqual({ path: "src/fi", startIndex: 8 });
  });

  test("extracts empty path right after @", () => {
    const result = extractPathAtCursor("look at @", 9);
    expect(result).toEqual({ path: "", startIndex: 8 });
  });

  test("stops at whitespace before @", () => {
    const result = extractPathAtCursor("first @one second @two", 22);
    expect(result).toEqual({ path: "two", startIndex: 18 });
  });

  test("handles @ at start of input", () => {
    const result = extractPathAtCursor("@path/to/file", 13);
    expect(result).toEqual({ path: "path/to/file", startIndex: 0 });
  });

  test("returns null when cursor is before @", () => {
    const result = extractPathAtCursor("hello @world", 3);
    expect(result).toBeNull();
  });
});
