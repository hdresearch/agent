import React from "react";
import { Box, Text } from "ink";
import type { OutputLine, ToolKind, ToolStatus, ToolContent, ToolLocation } from "../types";

// Tool kind icons
const TOOL_KIND_ICONS: Record<ToolKind, string> = {
  read: "📄",
  edit: "✏️",
  delete: "🗑️",
  move: "📦",
  search: "🔍",
  execute: "💻",
  think: "🧠",
  fetch: "🌐",
  switch_mode: "🔄",
  other: "🔧",
};

// Get icon for tool kind
function getToolIcon(kind?: ToolKind): string {
  return kind ? TOOL_KIND_ICONS[kind] || "🔧" : "🔧";
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
function truncatePath(path: string, maxLen: number = 60): string {
  if (path.length <= maxLen) return path;

  const parts = path.split("/");
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

// Truncate a line for display
function truncateLine(line: string, maxLen: number = 100): string {
  if (line.length <= maxLen) return line;
  return line.slice(0, maxLen - 3) + "...";
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
        const maxLines = 8; // Limit diff size

        // Show removed lines (red)
        const removedCount = Math.min(oldLines.length, maxLines);
        for (let i = 0; i < removedCount; i++) {
          lines.push(
            <Text key={`${key}-old-${i}`} color="red" dimColor wrap="truncate-end">
              {"    "}- {truncateLine(oldLines[i]!, 90)}
            </Text>
          );
        }
        if (oldLines.length > maxLines) {
          lines.push(
            <Text key={`${key}-old-more`} dimColor>{"    "}... {oldLines.length - maxLines} more removed</Text>
          );
        }

        // Show added lines (green)
        const addedCount = Math.min(newLines.length, maxLines);
        for (let i = 0; i < addedCount; i++) {
          lines.push(
            <Text key={`${key}-new-${i}`} color="green" wrap="truncate-end">
              {"    "}+ {truncateLine(newLines[i]!, 90)}
            </Text>
          );
        }
        if (newLines.length > maxLines) {
          lines.push(
            <Text key={`${key}-new-more`} dimColor>{"    "}... {newLines.length - maxLines} more added</Text>
          );
        }
      } else if (content.newText) {
        // Just new text (creation)
        const newLines = content.newText.split("\n");
        const maxLines = 8;
        const showCount = Math.min(newLines.length, maxLines);
        for (let i = 0; i < showCount; i++) {
          lines.push(
            <Text key={`${key}-new-${i}`} color="green" wrap="truncate-end">
              {"    "}+ {truncateLine(newLines[i]!, 90)}
            </Text>
          );
        }
        if (newLines.length > maxLines) {
          lines.push(
            <Text key={`${key}-more`} dimColor>{"    "}... {newLines.length - maxLines} more lines</Text>
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
          <Text dimColor wrap="truncate-end">{"    "}[Terminal: {content.terminalId}]</Text>
        </Box>
      );
    }

    case "content": {
      if (content.content?.type === "text") {
        const textPreview = content.content.text.slice(0, 150);
        const truncated = content.content.text.length > 150;
        return (
          <Box key={key} marginLeft={2}>
            <Text dimColor wrap="truncate-end">{"    "}{textPreview}{truncated ? "..." : ""}</Text>
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
}

export function OutputArea({ lines, maxLines = 20, scrollOffset = 0 }: OutputAreaProps) {
  // Calculate visible window with scroll offset
  // scrollOffset 0 = bottom (most recent), higher = scrolled up
  const endIndex = lines.length - scrollOffset;
  const startIndex = Math.max(0, endIndex - maxLines);
  const visibleLines = lines.slice(startIndex, endIndex);

  // Check if we can scroll in either direction
  const canScrollUp = startIndex > 0;
  const canScrollDown = scrollOffset > 0;

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* Scroll up indicator */}
      {canScrollUp && (
        <Box justifyContent="center">
          <Text dimColor>↑ {startIndex} more messages (PgUp to scroll)</Text>
        </Box>
      )}
      {visibleLines.map((line) => {
        switch (line.type) {
          case "user":
            return (
              <Box key={line.id} flexDirection="column" marginTop={1}>
                <Text color="cyan" bold>❯ {line.content}</Text>
              </Box>
            );
          case "text": {
            // Indent multi-line text content
            const textLines = line.content.split("\n");
            return (
              <Box key={line.id} flexDirection="column" marginTop={1}>
                <Box>
                  <Text color="magenta" bold>⏺ </Text>
                </Box>
                {textLines.map((textLine, idx) => (
                  <Box key={idx}>
                    <Text wrap="wrap">{"  "}{textLine}</Text>
                  </Box>
                ))}
              </Box>
            );
          }
          case "tool": {
            const icon = getToolIcon(line.toolKind);
            const status = getStatusIndicator(line.toolStatus);
            // Use toolTitle if available (rich ACP format), otherwise fall back to basic format
            let displayTitle = line.toolTitle || `${line.toolName || "Tool"}(${line.content})`;
            // Truncate very long titles
            if (displayTitle.length > 80) {
              displayTitle = displayTitle.slice(0, 77) + "...";
            }

            // Check if we have rich content to display
            const hasContent = line.toolContent && line.toolContent.length > 0;

            return (
              <Box key={line.id} flexDirection="column" marginTop={1}>
                <Box flexDirection="row">
                  <Text color="magenta" bold>⏺ </Text>
                  <Text>{icon} </Text>
                  <Text color="cyan" bold wrap="truncate-end">{displayTitle}</Text>
                  {line.toolStatus && (
                    <Text color={status.color as "gray" | "yellow" | "green" | "red"}> {status.icon}</Text>
                  )}
                </Box>
                {/* Show locations if available */}
                {line.toolLocations && line.toolLocations.length > 0 && (
                  <Box marginLeft={3}>
                    <Text dimColor wrap="truncate-end">
                      {line.toolLocations.slice(0, 3).map(formatLocation).join(", ")}
                      {line.toolLocations.length > 3 ? ` (+${line.toolLocations.length - 3} more)` : ""}
                    </Text>
                  </Box>
                )}
                {/* Show rich content (diffs, file content, etc.) */}
                {hasContent && line.toolContent!.map((content, idx) =>
                  renderToolContent(content, `${line.id}-content-${idx}`)
                )}
              </Box>
            );
          }
          case "tool-result": {
            const resultStatus = getStatusIndicator(line.toolStatus);
            const hasContent = line.toolContent && line.toolContent.length > 0;
            // Truncate result content
            let resultContent = line.content || "Done";
            if (resultContent.length > 80) {
              resultContent = resultContent.slice(0, 77) + "...";
            }

            return (
              <Box key={line.id} flexDirection="column">
                <Box marginLeft={2}>
                  <Text color={resultStatus.color as "gray" | "yellow" | "green" | "red"}>⎿ {resultStatus.icon} </Text>
                  <Text dimColor wrap="truncate-end">{resultContent}</Text>
                </Box>
                {/* Show rich content in result if available */}
                {hasContent && line.toolContent!.map((content, idx) =>
                  renderToolContent(content, `${line.id}-result-${idx}`)
                )}
              </Box>
            );
          }
          case "system":
            return (
              <Box key={line.id} marginTop={1}>
                <Text dimColor>{line.content}</Text>
              </Box>
            );
          case "error":
            return (
              <Box key={line.id} marginTop={1}>
                <Text color="red" bold>⏺ </Text>
                <Text color="red">{line.content}</Text>
              </Box>
            );
          case "stats":
            return (
              <Box key={line.id} marginTop={1}>
                <Text dimColor>  ✓ {line.content}</Text>
              </Box>
            );
          default:
            return <Text key={line.id}>{line.content}</Text>;
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
