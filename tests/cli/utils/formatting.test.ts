import { describe, test, expect, beforeEach } from "bun:test";
import {
  formatTokens,
  formatToolArgs,
  uniqueId,
  resetIdCounter,
} from "../../../src/cli/utils/formatting";

describe("formatTokens", () => {
  test("formats small numbers as-is", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(100)).toBe("100");
    expect(formatTokens(999)).toBe("999");
  });

  test("formats thousands with K suffix", () => {
    expect(formatTokens(1000)).toBe("1.0K");
    expect(formatTokens(1500)).toBe("1.5K");
    expect(formatTokens(10000)).toBe("10.0K");
    expect(formatTokens(999999)).toBe("1000.0K");
  });

  test("formats millions with M suffix", () => {
    expect(formatTokens(1000000)).toBe("1.0M");
    expect(formatTokens(1500000)).toBe("1.5M");
    expect(formatTokens(10000000)).toBe("10.0M");
  });
});

describe("formatToolArgs", () => {
  test("formats Bash command", () => {
    expect(formatToolArgs("Bash", { command: "ls -la" })).toBe("ls -la");
    expect(formatToolArgs("Bash", { command: "a".repeat(60) })).toBe("a".repeat(50) + "...");
    expect(formatToolArgs("Bash", {})).toBe("");
  });

  test("formats Read file path", () => {
    expect(formatToolArgs("Read", { file_path: "/path/to/file.ts" })).toBe("/path/to/file.ts");
    expect(formatToolArgs("Read", {})).toBe("");
  });

  test("formats Write file path", () => {
    expect(formatToolArgs("Write", { file_path: "/path/to/file.ts" })).toBe("/path/to/file.ts");
  });

  test("formats Edit with line counts", () => {
    expect(formatToolArgs("Edit", {
      file_path: "/path/to/file.ts",
      old_string: "line1\nline2",
      new_string: "new1\nnew2\nnew3",
    })).toBe("/path/to/file.ts (-2/+3 lines)");
  });

  test("formats Glob pattern", () => {
    expect(formatToolArgs("Glob", { pattern: "**/*.ts" })).toBe("**/*.ts");
  });

  test("formats Grep pattern", () => {
    expect(formatToolArgs("Grep", { pattern: "function.*" })).toBe("/function.*/");
  });

  test("formats WebFetch URL", () => {
    expect(formatToolArgs("WebFetch", { url: "https://example.com" })).toBe("https://example.com");
  });

  test("formats WebSearch query", () => {
    expect(formatToolArgs("WebSearch", { query: "how to test" })).toBe("how to test");
  });

  test("formats unknown tool with first string value", () => {
    expect(formatToolArgs("Unknown", { foo: "bar", baz: 123 })).toBe("bar");
    expect(formatToolArgs("Unknown", { num: 123 })).toBe("");
  });
});

describe("uniqueId", () => {
  beforeEach(() => {
    resetIdCounter();
  });

  test("generates unique IDs", () => {
    expect(uniqueId()).toBe("line-1");
    expect(uniqueId()).toBe("line-2");
    expect(uniqueId()).toBe("line-3");
  });

  test("resets counter", () => {
    uniqueId();
    uniqueId();
    resetIdCounter();
    expect(uniqueId()).toBe("line-1");
  });
});
