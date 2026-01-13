// Tool content parsing utilities
// Transforms raw ACP tool content into rich typed content for display

import type { ToolContent, ToolContentDiff, ToolContentSearch, ToolContentFileRead, ToolContentRaw, ToolContentTerminal } from "../types";

/**
 * Parse raw ACP tool content array into typed ToolContent[]
 * ACP content comes as Array<{ type: string; text?: string; data?: string; terminalId?: string }>
 */
export function parseToolContent(
  rawContent: unknown[] | undefined,
  toolName?: string,
  toolInput?: Record<string, unknown>
): ToolContent[] {
  if (!rawContent || !Array.isArray(rawContent)) {
    return [];
  }

  const result: ToolContent[] = [];

  for (const item of rawContent) {
    if (!item || typeof item !== "object") continue;
    const content = item as { 
      type?: string; 
      text?: string; 
      data?: string;
      terminalId?: string;
      output?: string;
      exitCode?: number;
      running?: boolean;
      path?: string;
      oldText?: string;
      newText?: string;
    };

    // Handle terminal content type directly
    if (content.type === "terminal" && content.terminalId) {
      result.push({
        type: "terminal",
        terminalId: content.terminalId,
        output: content.output,
        exitCode: content.exitCode,
        running: content.running,
      } as ToolContentTerminal);
      continue;
    }

    // Handle diff content type directly
    if (content.type === "diff" && content.path) {
      result.push({
        type: "diff",
        path: content.path,
        oldText: content.oldText,
        newText: content.newText || "",
      } as ToolContentDiff);
      continue;
    }

    // Parse based on content type and tool context
    if (content.type === "text" && content.text) {
      const parsed = parseTextContent(content.text, toolName, toolInput);
      if (parsed) {
        result.push(parsed);
      }
    } else if (content.type === "tool_result" && content.text) {
      // Tool results often contain raw text
      const parsed = parseTextContent(content.text, toolName, toolInput);
      if (parsed) {
        result.push(parsed);
      }
    }
  }

  return result;
}

/**
 * Parse text content based on tool context to create rich content
 */
function parseTextContent(
  text: string,
  toolName?: string,
  toolInput?: Record<string, unknown>
): ToolContent | null {
  const lowerToolName = toolName?.toLowerCase() || "";

  // File read operations - show preview
  if (lowerToolName.includes("read") || lowerToolName.includes("view")) {
    const path = (toolInput?.path as string) || (toolInput?.file as string) || "";
    const lines = text.split("\n").length;
    // Get first few lines as preview
    const previewLines = text.split("\n").slice(0, 8);
    const preview = previewLines.join("\n");
    
    return {
      type: "file-read",
      path,
      lines,
      preview,
    } as ToolContentFileRead;
  }

  // Search/grep operations - parse results
  if (lowerToolName.includes("search") || lowerToolName.includes("grep") || lowerToolName.includes("find")) {
    const query = (toolInput?.pattern as string) || (toolInput?.query as string) || "";
    const results = parseSearchResults(text);
    
    if (results.length > 0) {
      return {
        type: "search",
        query,
        results,
      } as ToolContentSearch;
    }
  }

  // Edit operations - try to parse as diff
  if (lowerToolName.includes("edit") || lowerToolName.includes("write") || lowerToolName.includes("replace")) {
    const path = (toolInput?.path as string) || (toolInput?.file as string) || "";
    // Check if it looks like a diff
    if (text.includes("---") || text.includes("+++") || text.includes("@@")) {
      const { oldText, newText } = parseDiffText(text);
      return {
        type: "diff",
        path,
        oldText,
        newText,
      } as ToolContentDiff;
    }
  }

  // Default: return as raw text if it's meaningful
  if (text.trim().length > 0 && text.length < 5000) {
    return {
      type: "raw",
      text: text.slice(0, 2000), // Limit size
    } as ToolContentRaw;
  }

  return null;
}

/**
 * Parse search/grep results from text output
 */
function parseSearchResults(text: string): Array<{ file: string; line?: number; text?: string }> {
  const results: Array<{ file: string; line?: number; text?: string }> = [];
  const lines = text.split("\n");

  for (const line of lines) {
    // Common grep-style format: file:line:text or file:line: text
    const grepMatch = line.match(/^([^:]+):(\d+):?\s*(.*)$/);
    if (grepMatch) {
      results.push({
        file: grepMatch[1]!,
        line: parseInt(grepMatch[2]!, 10),
        text: grepMatch[3]?.trim(),
      });
      continue;
    }

    // Simple file path line
    const fileMatch = line.match(/^(\S+\.\w+)$/);
    if (fileMatch) {
      results.push({ file: fileMatch[1]! });
      continue;
    }

    // File path with description: path/to/file - description
    const descMatch = line.match(/^([^\s]+)\s+-\s+(.*)$/);
    if (descMatch) {
      results.push({ file: descMatch[1]!, text: descMatch[2] });
    }
  }

  return results;
}

/**
 * Parse diff-style text into old/new text
 */
function parseDiffText(text: string): { oldText?: string; newText: string } {
  const lines = text.split("\n");
  const oldLines: string[] = [];
  const newLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("-") && !line.startsWith("---")) {
      oldLines.push(line.slice(1));
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      newLines.push(line.slice(1));
    } else if (!line.startsWith("@@") && !line.startsWith("---") && !line.startsWith("+++")) {
      // Context line - add to both
      oldLines.push(line);
      newLines.push(line);
    }
  }

  return {
    oldText: oldLines.length > 0 ? oldLines.join("\n") : undefined,
    newText: newLines.join("\n"),
  };
}

/**
 * Create rich content for common tool types based on tool result
 */
export function createToolResultContent(
  resultText: string,
  toolName?: string,
  toolCallId?: string
): ToolContent[] {
  if (!resultText || resultText.length === 0) {
    return [];
  }

  // Parse the result text as content
  const parsed = parseTextContent(resultText, toolName, undefined);
  if (parsed) {
    return [parsed];
  }

  return [];
}
