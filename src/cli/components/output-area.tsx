import React from "react";
import { Box, Text } from "ink";
import type { OutputLine } from "../types";

interface OutputAreaProps {
  lines: OutputLine[];
  maxLines?: number;
}

export function OutputArea({ lines, maxLines = 20 }: OutputAreaProps) {
  const visibleLines = lines.slice(-maxLines);

  return (
    <Box flexDirection="column" paddingX={1}>
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
    </Box>
  );
}
