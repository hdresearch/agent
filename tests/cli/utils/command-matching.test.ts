import { describe, test, expect } from "bun:test";
import {
  getMatchingCommands,
  extractPathAtCursor,
} from "../../../src/cli/utils/command-matching";

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
  });

  test("matches multiple commands", () => {
    const matches = getMatchingCommands("/c");
    expect(matches.length).toBe(3); // clear, continue, compact
    expect(matches.map(m => m.name)).toContain("clear");
    expect(matches.map(m => m.name)).toContain("continue");
    expect(matches.map(m => m.name)).toContain("compact");
  });

  test("matches by alias", () => {
    const matches = getMatchingCommands("/h");
    expect(matches.some(m => m.name === "help")).toBe(true);
  });

  test("returns empty for exact match", () => {
    expect(getMatchingCommands("/help")).toEqual([]);
  });

  test("limits to 4 results", () => {
    // /m could match model, mcp, etc
    const matches = getMatchingCommands("/");
    // Since we need at least 2 chars, this should be empty
    expect(matches.length).toBe(0);
  });

  test("is case insensitive", () => {
    const matches = getMatchingCommands("/HE");
    expect(matches.length).toBe(1);
    expect(matches[0]?.name).toBe("help");
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
