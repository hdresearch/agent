import React from "react";
import { Box, Text } from "ink";
import type { PathMatch } from "../types";

interface PathSuggestionsProps {
  matches: PathMatch[];
  selectedIndex: number;
}

export function PathSuggestions({
  matches,
  selectedIndex,
}: PathSuggestionsProps) {
  if (matches.length === 0) return null;

  return (
    <Box flexDirection="column" marginLeft={2} marginBottom={1}>
      <Box flexDirection="row" gap={1}>
        <Text dimColor>Files:</Text>
        <Text dimColor>(Tab to complete, ↑↓ to select)</Text>
      </Box>
      <Box flexDirection="column" marginLeft={2}>
        {matches.map((match, idx) => (
          <Text
            key={match.path}
            dimColor={idx !== selectedIndex}
            color={idx === selectedIndex ? "cyan" : undefined}
            inverse={idx === selectedIndex}
          >
            {match.isDirectory ? "📁 " : "📄 "}
            {match.path}
          </Text>
        ))}
      </Box>
    </Box>
  );
}
