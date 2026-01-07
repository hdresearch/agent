import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import {
  extractPathReferences,
  hasPathReferences,
  expandPathReference,
  expandPrompt,
  type PathReference,
} from "../../src/utils/path-expansion";

describe("extractPathReferences", () => {
  describe("basic paths", () => {
    test("extracts simple path", () => {
      const refs = extractPathReferences("Look at @file.txt");
      expect(refs.length).toBe(1);
      expect(refs[0].path).toBe("file.txt");
      expect(refs[0].original).toBe("@file.txt");
    });

    test("extracts relative path with ./", () => {
      const refs = extractPathReferences("Check @./src/main.ts");
      expect(refs.length).toBe(1);
      expect(refs[0].path).toBe("./src/main.ts");
    });

    test("extracts absolute path", () => {
      const refs = extractPathReferences("Read @/etc/config.json");
      expect(refs.length).toBe(1);
      expect(refs[0].path).toBe("/etc/config.json");
    });

    test("extracts nested path", () => {
      const refs = extractPathReferences("See @src/components/Button.tsx");
      expect(refs.length).toBe(1);
      expect(refs[0].path).toBe("src/components/Button.tsx");
    });
  });

  describe("quoted paths", () => {
    test("extracts double-quoted path with spaces", () => {
      const refs = extractPathReferences('Open @"path with spaces/file.txt"');
      expect(refs.length).toBe(1);
      expect(refs[0].path).toBe("path with spaces/file.txt");
      expect(refs[0].original).toBe('@"path with spaces/file.txt"');
    });

    test("extracts single-quoted path with spaces", () => {
      const refs = extractPathReferences("Open @'path with spaces/file.txt'");
      expect(refs.length).toBe(1);
      expect(refs[0].path).toBe("path with spaces/file.txt");
    });

    test("handles empty quotes - matches the quotes as unquoted path", () => {
      // When quotes are empty, the quoted pattern doesn't match (requires [^"]+)
      // but the unquoted pattern matches the literal "" characters
      const refs = extractPathReferences('Check @""');
      expect(refs.length).toBe(1);
      expect(refs[0].path).toBe('""');
    });
  });

  describe("multiple references", () => {
    test("extracts multiple paths", () => {
      const refs = extractPathReferences("Compare @file1.txt and @file2.txt");
      expect(refs.length).toBe(2);
      expect(refs[0].path).toBe("file1.txt");
      expect(refs[1].path).toBe("file2.txt");
    });

    test("extracts mixed path types", () => {
      const refs = extractPathReferences(
        'Look at @./local.ts, @/absolute/path.js, and @"quoted path.md"'
      );
      expect(refs.length).toBe(3);
      expect(refs[0].path).toBe("./local.ts");
      expect(refs[1].path).toBe("/absolute/path.js");
      expect(refs[2].path).toBe("quoted path.md");
    });

    test("handles paths on different lines", () => {
      const refs = extractPathReferences("First: @file1.txt\nSecond: @file2.txt");
      expect(refs.length).toBe(2);
    });
  });

  describe("position tracking", () => {
    test("tracks start and end indices", () => {
      const text = "Look at @file.txt please";
      const refs = extractPathReferences(text);

      expect(refs[0].startIndex).toBe(8);
      expect(refs[0].endIndex).toBe(17);
      expect(text.slice(refs[0].startIndex, refs[0].endIndex)).toBe("@file.txt");
    });

    test("tracks indices for multiple refs", () => {
      const text = "@first.txt and @second.txt";
      const refs = extractPathReferences(text);

      expect(text.slice(refs[0].startIndex, refs[0].endIndex)).toBe("@first.txt");
      expect(text.slice(refs[1].startIndex, refs[1].endIndex)).toBe("@second.txt");
    });
  });

  describe("boundary conditions", () => {
    test("stops at common punctuation", () => {
      const refs = extractPathReferences("Check @file.txt, then continue");
      expect(refs[0].path).toBe("file.txt");
    });

    test("stops at semicolon", () => {
      const refs = extractPathReferences("See @file.txt; more text");
      expect(refs[0].path).toBe("file.txt");
    });

    test("stops at colon", () => {
      const refs = extractPathReferences("File @README.md: contains docs");
      expect(refs[0].path).toBe("README.md");
    });

    test("stops at parenthesis", () => {
      const refs = extractPathReferences("(see @file.txt)");
      expect(refs[0].path).toBe("file.txt");
    });

    test("stops at brackets", () => {
      const refs = extractPathReferences("[@file.txt]");
      expect(refs[0].path).toBe("file.txt");
    });

    test("stops at braces", () => {
      const refs = extractPathReferences("{@file.txt}");
      expect(refs[0].path).toBe("file.txt");
    });

    test("stops at angle brackets", () => {
      const refs = extractPathReferences("<@file.txt>");
      expect(refs[0].path).toBe("file.txt");
    });

    test("stops at question mark", () => {
      const refs = extractPathReferences("Is @file.txt correct?");
      expect(refs[0].path).toBe("file.txt");
    });

    test("stops at exclamation mark", () => {
      const refs = extractPathReferences("Check @file.txt!");
      expect(refs[0].path).toBe("file.txt");
    });
  });

  describe("edge cases", () => {
    test("returns empty array for no references", () => {
      expect(extractPathReferences("No paths here")).toEqual([]);
    });

    test("returns empty array for empty string", () => {
      expect(extractPathReferences("")).toEqual([]);
    });

    test("handles @ at end of string without path", () => {
      // @ without following characters shouldn't match
      const refs = extractPathReferences("email@");
      expect(refs.length).toBe(0);
    });

    test("handles email-like patterns", () => {
      // email@ should not match as there's nothing after @
      const refs = extractPathReferences("Contact user@example.com");
      // This will match @example.com as a path reference
      expect(refs.length).toBe(1);
      expect(refs[0].path).toBe("example.com");
    });

    test("handles multiple @ in sequence", () => {
      const refs = extractPathReferences("@@file.txt");
      // First @ is followed by @, which then matches file.txt
      expect(refs.length).toBe(1);
    });

    test("preserves path with dots", () => {
      const refs = extractPathReferences("@../parent/file.test.ts");
      expect(refs[0].path).toBe("../parent/file.test.ts");
    });

    test("preserves path with hyphens and underscores", () => {
      const refs = extractPathReferences("@my-file_name.txt");
      expect(refs[0].path).toBe("my-file_name.txt");
    });
  });

  describe("regex state reset", () => {
    test("works correctly on consecutive calls", () => {
      // Ensure regex state is reset between calls
      const refs1 = extractPathReferences("@file1.txt");
      const refs2 = extractPathReferences("@file2.txt");

      expect(refs1[0].path).toBe("file1.txt");
      expect(refs2[0].path).toBe("file2.txt");
    });
  });
});

describe("hasPathReferences", () => {
  test("returns true for path reference", () => {
    expect(hasPathReferences("Check @file.txt")).toBe(true);
  });

  test("returns true for quoted path", () => {
    expect(hasPathReferences('Open @"path with spaces"')).toBe(true);
  });

  test("returns false for no references", () => {
    expect(hasPathReferences("No paths here")).toBe(false);
  });

  test("returns false for empty string", () => {
    expect(hasPathReferences("")).toBe(false);
  });

  test("returns true for multiple references", () => {
    expect(hasPathReferences("@file1.txt and @file2.txt")).toBe(true);
  });

  test("works correctly on consecutive calls", () => {
    // Ensure regex state is reset
    expect(hasPathReferences("@file.txt")).toBe(true);
    expect(hasPathReferences("no path")).toBe(false);
    expect(hasPathReferences("@another.txt")).toBe(true);
  });
});

describe("expandPrompt (with real files)", () => {
  const testDir = join(import.meta.dir, ".test-files");
  const testFile = join(testDir, "test.txt");
  const testContent = "Hello, this is test content!";

  beforeAll(async () => {
    await mkdir(testDir, { recursive: true });
    await writeFile(testFile, testContent);
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test("expands single file reference", async () => {
    const result = await expandPrompt(`Check @${testFile}`);

    expect(result.hasErrors).toBe(false);
    expect(result.refs.length).toBe(1);
    expect(result.refs[0].content).toBe(testContent);
    expect(result.expandedPrompt).toContain(`<file path="${testFile}">`);
    expect(result.expandedPrompt).toContain(testContent);
    expect(result.expandedPrompt).toContain("</file>");
  });

  test("handles non-existent file", async () => {
    const result = await expandPrompt("Check @/nonexistent/file.txt");

    expect(result.hasErrors).toBe(true);
    expect(result.refs[0].content).toBeNull();
    expect(result.refs[0].error).toContain("File not found");
    expect(result.expandedPrompt).toContain('error="');
  });

  test("returns original prompt when no references", async () => {
    const original = "No path references here";
    const result = await expandPrompt(original);

    expect(result.expandedPrompt).toBe(original);
    expect(result.refs.length).toBe(0);
    expect(result.hasErrors).toBe(false);
  });

  test("expands relative paths from cwd", async () => {
    const result = await expandPrompt("@test.txt", testDir);

    expect(result.hasErrors).toBe(false);
    expect(result.refs[0].content).toBe(testContent);
  });

  test("expands multiple file references", async () => {
    // Create another test file
    const testFile2 = join(testDir, "test2.txt");
    await writeFile(testFile2, "Second file content");

    try {
      const result = await expandPrompt(
        `First: @${testFile}\nSecond: @${testFile2}`
      );

      expect(result.refs.length).toBe(2);
      expect(result.hasErrors).toBe(false);
      expect(result.expandedPrompt).toContain("Hello, this is test content!");
      expect(result.expandedPrompt).toContain("Second file content");
    } finally {
      await rm(testFile2, { force: true });
    }
  });
});

describe("expandPathReference", () => {
  const testDir = join(import.meta.dir, ".test-files-ref");
  const testFile = join(testDir, "ref-test.txt");

  beforeAll(async () => {
    await mkdir(testDir, { recursive: true });
    await writeFile(testFile, "Reference test content");
  });

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  test("resolves absolute path", async () => {
    const ref: PathReference = {
      original: `@${testFile}`,
      path: testFile,
      startIndex: 0,
      endIndex: testFile.length + 1,
    };

    const result = await expandPathReference(ref, "/some/cwd");
    expect(result.absolutePath).toBe(testFile);
    expect(result.content).toBe("Reference test content");
  });

  test("resolves relative path from cwd", async () => {
    const ref: PathReference = {
      original: "@ref-test.txt",
      path: "ref-test.txt",
      startIndex: 0,
      endIndex: 13,
    };

    const result = await expandPathReference(ref, testDir);
    expect(result.absolutePath).toBe(testFile);
    expect(result.content).toBe("Reference test content");
  });

  test("handles file read error", async () => {
    const ref: PathReference = {
      original: "@nonexistent.txt",
      path: "nonexistent.txt",
      startIndex: 0,
      endIndex: 16,
    };

    const result = await expandPathReference(ref, testDir);
    expect(result.content).toBeNull();
    expect(result.error).toBeDefined();
  });
});
