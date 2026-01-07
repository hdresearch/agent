import React from "react";
import { Box, Text } from "ink";
import type { OutputLine } from "../types";

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
                <Text color="magenta" bold>⏺ </Text>
                {textLines.map((textLine, idx) => (
                  <Text key={idx}>{"  "}{textLine}</Text>
                ))}
              </Box>
            );
          }
          case "tool":
            return (
              <Box key={line.id} flexDirection="row" marginTop={1}>
                <Text color="magenta" bold>⏺ </Text>
                <Text color="cyan" bold>{line.toolName || "Tool"}</Text>
                <Text dimColor>(</Text>
                <Text>{line.content}</Text>
                <Text dimColor>)</Text>
              </Box>
            );
          case "tool-result":
            return (
              <Box key={line.id} marginLeft={2}>
                <Text dimColor>⎿ </Text>
                <Text dimColor>{line.content || "(Done)"}</Text>
              </Box>
            );
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
