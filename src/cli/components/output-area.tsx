import React from "react";
import { Box, Text } from "ink";
import { relative } from "path";
import type { OutputLine, ToolStatus, ToolContent, ToolLocation } from "../types";

// Convert absolute paths to relative paths based on cwd
function toRelativePath(absolutePath: string): string {
  const cwd = process.cwd();
  // Only convert if the path is under the current working directory
  if (absolutePath.startsWith(cwd + "/")) {
    return relative(cwd, absolutePath);
  }
  // Also handle home directory abbreviation
  const home = process.env.HOME || "";
  if (home && absolutePath.startsWith(home + "/")) {
    return "~/" + absolutePath.slice(home.length + 1);
  }
  return absolutePath;
}

// Convert paths in tool title strings like "Read(/Users/tynandaly/path.ts)" to "Read(src/path.ts)"
function convertPathsInToolTitle(title: string): string {
  // Match paths inside parentheses that look like absolute paths
  return title.replace(/\(([^)]+)\)/g, (match, pathInParens) => {
    // Check if this looks like an absolute path (starts with /)
    if (pathInParens.startsWith("/")) {
      return `(${toRelativePath(pathInParens)})`;
    }
    return match;
  });
}

// Get status indicator
function getStatusIndicator(status?: ToolStatus): { icon: string; color: string } {
  switch (status) {
    case "pending":
      return { icon: "○", color: "gray" };
    case "in_progress":
      return { icon: "◐", color: "yellow" };
    case "completed":
      return { icon: "✓", color: "green" };
    case "failed":
      return { icon: "✗", color: "red" };
    default:
      return { icon: "○", color: "gray" };
  }
}

// Truncate path to reasonable length, keeping filename visible
// First converts absolute paths to relative paths
function truncatePath(path: string, maxLen: number = 60): string {
  // Convert to relative path first
  const relativePath = toRelativePath(path);

  if (relativePath.length <= maxLen) return relativePath;

  const parts = relativePath.split("/");
  const filename = parts[parts.length - 1] || "";

  // Always show at least the filename
  if (filename.length >= maxLen - 3) {
    return "..." + filename.slice(-(maxLen - 3));
  }

  // Try to show some directory context
  const remaining = maxLen - filename.length - 4; // ".../" prefix
  const dirPath = parts.slice(0, -1).join("/");

  if (remaining > 10) {
    return "..." + dirPath.slice(-remaining) + "/" + filename;
  }

  return ".../" + filename;
}

// Format location for display
function formatLocation(loc: ToolLocation): string {
  const truncatedPath = truncatePath(loc.path, 50);
  if (loc.line !== undefined) {
    return `${truncatedPath}:${loc.line}`;
  }
  return truncatedPath;
}

// Sanitize text for terminal display - remove control characters and ANSI codes
function sanitizeText(text: string): string {
  return text
    // Remove ANSI escape codes
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
    // Remove other control characters (except newline which we handle separately)
    .replace(/[\x00-\x09\x0b-\x1f\x7f]/g, "")
    // Replace tabs with spaces
    .replace(/\t/g, "  ");
}

// Truncate a line for display
function truncateLine(line: string, maxLen: number = 100): string {
  // Sanitize first
  const clean = sanitizeText(line);
  if (clean.length <= maxLen) return clean;
  return clean.slice(0, maxLen - 3) + "...";
}

// Render a single piece of tool content
function renderToolContent(content: ToolContent, key: string): React.ReactNode {
  switch (content.type) {
    case "diff": {
      // Render a unified diff
      const lines: React.ReactNode[] = [];
      if (content.oldText !== undefined && content.newText) {
        // Show a simplified diff view
        const oldLines = content.oldText.split("\n");
        const newLines = content.newText.split("\n");
        const maxLines = 5; // Limit diff size to avoid overwhelming display

        // Show removed lines (red)
        const removedCount = Math.min(oldLines.length, maxLines);
        for (let i = 0; i < removedCount; i++) {
          lines.push(
            <Box key={`${key}-old-${i}`}>
              <Text color="red" dimColor>{"    "}- {truncateLine(oldLines[i] || "", 80)}</Text>
            </Box>
          );
        }
        if (oldLines.length > maxLines) {
          lines.push(
            <Box key={`${key}-old-more`}>
              <Text dimColor>{"    "}... {oldLines.length - maxLines} more removed</Text>
            </Box>
          );
        }

        // Show added lines (green)
        const addedCount = Math.min(newLines.length, maxLines);
        for (let i = 0; i < addedCount; i++) {
          lines.push(
            <Box key={`${key}-new-${i}`}>
              <Text color="green">{"    "}+ {truncateLine(newLines[i] || "", 80)}</Text>
            </Box>
          );
        }
        if (newLines.length > maxLines) {
          lines.push(
            <Box key={`${key}-new-more`}>
              <Text dimColor>{"    "}... {newLines.length - maxLines} more added</Text>
            </Box>
          );
        }
      } else if (content.newText) {
        // Just new text (creation)
        const newLines = content.newText.split("\n");
        const maxLines = 5;
        const showCount = Math.min(newLines.length, maxLines);
        for (let i = 0; i < showCount; i++) {
          lines.push(
            <Box key={`${key}-new-${i}`}>
              <Text color="green">{"    "}+ {truncateLine(newLines[i] || "", 80)}</Text>
            </Box>
          );
        }
        if (newLines.length > maxLines) {
          lines.push(
            <Box key={`${key}-more`}>
              <Text dimColor>{"    "}... {newLines.length - maxLines} more lines</Text>
            </Box>
          );
        }
      }
      return (
        <Box key={key} flexDirection="column">
          {lines}
        </Box>
      );
    }

    case "terminal": {
      return (
        <Box key={key} marginLeft={2}>
          <Text dimColor>{"    "}[Terminal: {sanitizeText(content.terminalId)}]</Text>
        </Box>
      );
    }

    case "content": {
      if (content.content?.type === "text") {
        // Sanitize and truncate text preview
        const cleanText = sanitizeText(content.content.text);
        const textPreview = cleanText.slice(0, 100).replace(/\n/g, " ");
        const truncated = cleanText.length > 100;
        return (
          <Box key={key} marginLeft={2}>
            <Text dimColor>{"    "}{textPreview}{truncated ? "..." : ""}</Text>
          </Box>
        );
      }
      return null;
    }

    default:
      return null;
  }
}

interface OutputAreaProps {
  lines: OutputLine[];
  maxLines?: number;
  scrollOffset?: number;
  maxToolsVisible?: number; // Max tool calls to show in a tool activity window
}

// Group consecutive lines into chunks for windowed display
type LineChunk =
  | { type: "single"; line: OutputLine }
  | { type: "tool-group"; lines: OutputLine[]; collapsed: number };

function groupLines(lines: OutputLine[], maxToolsVisible: number): LineChunk[] {
  const chunks: LineChunk[] = [];
  let currentToolGroup: OutputLine[] = [];

  const flushToolGroup = () => {
    if (currentToolGroup.length === 0) return;

    const collapsed = Math.max(0, currentToolGroup.length - maxToolsVisible);
    chunks.push({
      type: "tool-group",
      lines: currentToolGroup.slice(-maxToolsVisible), // Keep last N
      collapsed,
    });
    currentToolGroup = [];
  };

  for (const line of lines) {
    if (line.type === "tool" || line.type === "tool-result") {
      currentToolGroup.push(line);
    } else {
      flushToolGroup();
      chunks.push({ type: "single", line });
    }
  }
  flushToolGroup();

  return chunks;
}

export function OutputArea({ lines, maxLines = 20, scrollOffset = 0, maxToolsVisible = 4 }: OutputAreaProps) {
  // Calculate visible window with scroll offset
  // scrollOffset 0 = bottom (most recent), higher = scrolled up
  const endIndex = lines.length - scrollOffset;
  const startIndex = Math.max(0, endIndex - maxLines);
  const visibleLines = lines.slice(startIndex, endIndex);

  // Group lines for windowed tool display
  const chunks = groupLines(visibleLines, maxToolsVisible);

  // Check if we can scroll in either direction
  const canScrollUp = startIndex > 0;
  const canScrollDown = scrollOffset > 0;

  // Render a tool line (call or result)
  const renderToolLine = (line: OutputLine) => {
    if (line.type === "tool") {
      const status = getStatusIndicator(line.toolStatus);
      // Convert absolute paths in tool titles to relative paths
      let toolDisplay = convertPathsInToolTitle(sanitizeText(line.toolTitle || line.toolName || line.content || "Tool"));
      if (toolDisplay.length > 70) {
        toolDisplay = toolDisplay.slice(0, 67) + "...";
      }
      const hasContent = line.toolContent && line.toolContent.length > 0;

      return (
        <Box key={line.id} flexDirection="column">
          <Box flexDirection="row">
            <Text color="magenta" bold>⏺ </Text>
            <Text color="cyan" bold>{toolDisplay}</Text>
            {line.toolStatus && (
              <Text color={status.color as "gray" | "yellow" | "green" | "red"}> {status.icon}</Text>
            )}
          </Box>
          {hasContent && line.toolContent!.map((content, idx) =>
            renderToolContent(content, `${line.id}-content-${idx}`)
          )}
        </Box>
      );
    } else if (line.type === "tool-result") {
      const resultStatus = getStatusIndicator(line.toolStatus);
      let resultContent = sanitizeText(line.content || "Done");
      if (resultContent.length > 60) {
        resultContent = resultContent.slice(0, 57) + "...";
      }

      return (
        <Box key={line.id} flexDirection="column">
          <Box marginLeft={2} flexDirection="row">
            <Text color={resultStatus.color as "gray" | "yellow" | "green" | "red"}>⎿ {resultStatus.icon} </Text>
            <Text dimColor>{resultContent}</Text>
          </Box>
        </Box>
      );
    }
    return null;
  };

  // Render a single non-tool line
  const renderSingleLine = (line: OutputLine) => {
    switch (line.type) {
      case "user":
        return (
          <Box key={line.id} flexDirection="column" marginTop={1}>
            <Text color="cyan" bold>❯ {truncateLine(sanitizeText(line.content), 90)}</Text>
          </Box>
        );
      case "text": {
        const cleanContent = sanitizeText(line.content);
        const textLines = cleanContent.split("\n");
        return (
          <Box key={line.id} flexDirection="column" marginTop={1}>
            <Box flexDirection="row">
              <Text color="magenta" bold>⏺ </Text>
              <Text wrap="wrap">{textLines[0] || ""}</Text>
            </Box>
            {textLines.slice(1).map((textLine, idx) => (
              <Box key={`${line.id}-line-${idx}`}>
                <Text wrap="wrap">{"   "}{textLine}</Text>
              </Box>
            ))}
          </Box>
        );
      }
      case "system":
        return (
          <Box key={line.id} marginTop={1}>
            <Text dimColor>{truncateLine(sanitizeText(line.content), 100)}</Text>
          </Box>
        );
      case "error":
        return (
          <Box key={line.id} marginTop={1} flexDirection="row">
            <Text color="red" bold>⏺ </Text>
            <Text color="red">{truncateLine(sanitizeText(line.content), 90)}</Text>
          </Box>
        );
      case "stats":
        return (
          <Box key={line.id} marginTop={1}>
            <Text dimColor>  ✓ {truncateLine(sanitizeText(line.content), 90)}</Text>
          </Box>
        );
      default:
        return <Text key={line.id}>{line.content}</Text>;
    }
  };

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* Scroll up indicator */}
      {canScrollUp && (
        <Box justifyContent="center">
          <Text dimColor>↑ {startIndex} more messages (PgUp to scroll)</Text>
        </Box>
      )}
      {chunks.map((chunk, chunkIdx) => {
        if (chunk.type === "single") {
          return renderSingleLine(chunk.line);
        } else {
          // Tool group - show collapsed indicator + visible tools
          return (
            <Box key={`chunk-${chunkIdx}`} flexDirection="column" marginTop={1}>
              {chunk.collapsed > 0 && (
                <Box>
                  <Text dimColor>  +{chunk.collapsed} more tool uses</Text>
                </Box>
              )}
              {chunk.lines.map(renderToolLine)}
            </Box>
          );
        }
      })}
      {/* Scroll down indicator */}
      {canScrollDown && (
        <Box justifyContent="center">
          <Text dimColor>↓ {scrollOffset} more messages (PgDn to scroll)</Text>
        </Box>
      )}
    </Box>
  );
}
