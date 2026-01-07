// Path expansion for @path references in prompts
// Parses @path references and expands them with file contents
// Supports both local and remote (via ACP client) file reads

import { join, resolve, isAbsolute } from "path";
import type { HttpAcpClient } from "../client/http-client";

// Match @path references: @./file, @file, @path/to/file, @/absolute/path
// Supports optional quotes: @"path with spaces"
const PATH_PATTERN = /@(?:"([^"]+)"|'([^']+)'|([^\s,;:!?\])}>]+))/g;

export interface PathReference {
  original: string; // The full match including @
  path: string; // The extracted path
  startIndex: number;
  endIndex: number;
}

export interface ExpandedPath extends PathReference {
  absolutePath: string;
  content: string | null; // null if file couldn't be read
  error?: string;
}

// Extract all @path references from a string
export function extractPathReferences(text: string): PathReference[] {
  const refs: PathReference[] = [];
  let match: RegExpExecArray | null;

  // Reset regex state
  PATH_PATTERN.lastIndex = 0;

  while ((match = PATH_PATTERN.exec(text)) !== null) {
    // Path is in one of the capture groups (quoted or unquoted)
    const path = match[1] || match[2] || match[3];
    if (path) {
      refs.push({
        original: match[0],
        path,
        startIndex: match.index,
        endIndex: match.index + match[0].length,
      });
    }
  }

  return refs;
}

// Read file content safely - supports both local and remote reads
async function readFileContent(
  absolutePath: string,
  client?: HttpAcpClient
): Promise<{ content: string | null; error?: string }> {
  // If client is provided, use remote file read
  if (client) {
    try {
      const result = await client.readFile(absolutePath);
      return { content: result.content, error: result.error };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: null, error: `Remote read failed: ${msg}` };
    }
  }

  // Local file read
  try {
    const file = Bun.file(absolutePath);
    if (!(await file.exists())) {
      return { content: null, error: `File not found: ${absolutePath}` };
    }

    // Check if it's a directory
    const stat = await file.stat();
    if (stat && typeof stat === "object" && "type" in stat) {
      // Bun.file().stat() returns different structure
    }

    const content = await file.text();

    // Limit file size to prevent massive expansions (1MB limit)
    if (content.length > 1024 * 1024) {
      return {
        content: content.slice(0, 1024 * 1024),
        error: `File truncated (>1MB): ${absolutePath}`
      };
    }

    return { content };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: null, error: `Failed to read ${absolutePath}: ${msg}` };
  }
}

// Expand a single path reference
export async function expandPathReference(
  ref: PathReference,
  cwd: string,
  client?: HttpAcpClient
): Promise<ExpandedPath> {
  const absolutePath = isAbsolute(ref.path)
    ? ref.path
    : resolve(cwd, ref.path);

  const { content, error } = await readFileContent(absolutePath, client);

  return {
    ...ref,
    absolutePath,
    content,
    error,
  };
}

// Expand all @path references in a prompt
// If client is provided, files are read from the remote server's filesystem
export async function expandPrompt(
  prompt: string,
  cwd: string = process.cwd(),
  client?: HttpAcpClient
): Promise<{
  expandedPrompt: string;
  refs: ExpandedPath[];
  hasErrors: boolean;
}> {
  const refs = extractPathReferences(prompt);

  if (refs.length === 0) {
    return { expandedPrompt: prompt, refs: [], hasErrors: false };
  }

  // Expand all references in parallel
  const expandedRefs = await Promise.all(
    refs.map((ref) => expandPathReference(ref, cwd, client))
  );

  // Build the expanded prompt
  // Replace @path with file content blocks
  let expandedPrompt = prompt;
  let offset = 0;

  for (const ref of expandedRefs) {
    const replacement = ref.content !== null
      ? `<file path="${ref.absolutePath}">\n${ref.content}\n</file>`
      : `<file path="${ref.absolutePath}" error="${ref.error || "Unknown error"}" />`;

    const start = ref.startIndex + offset;
    const end = ref.endIndex + offset;

    expandedPrompt =
      expandedPrompt.slice(0, start) +
      replacement +
      expandedPrompt.slice(end);

    offset += replacement.length - (ref.endIndex - ref.startIndex);
  }

  const hasErrors = expandedRefs.some((ref) => ref.content === null);

  return { expandedPrompt, refs: expandedRefs, hasErrors };
}

// Check if a prompt contains any @path references
export function hasPathReferences(prompt: string): boolean {
  PATH_PATTERN.lastIndex = 0;
  return PATH_PATTERN.test(prompt);
}
