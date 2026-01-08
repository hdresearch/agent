import React from "react";
import { Box, Text } from "ink";
import type { MatchedCommand } from "../utils/command-matching";

interface CommandSuggestionsProps {
  matches: MatchedCommand[];
  selectedIndex: number;
}

export function CommandSuggestions({
  matches,
  selectedIndex,
}: CommandSuggestionsProps) {
  if (matches.length === 0) return null;

  return (
    <Box flexDirection="row" gap={2} marginLeft={2}>
      {matches.map((cmd, idx) => (
        <Text
          key={cmd.name}
          dimColor={idx !== selectedIndex}
          color={idx === selectedIndex ? "cyan" : cmd.source === "agent" ? "magenta" : undefined}
          inverse={idx === selectedIndex}
        >
          {" "}
          {cmd.source === "agent" && <Text color="magenta">[A] </Text>}
          /{cmd.name}
          {cmd.alias && <Text color="gray"> ({cmd.alias})</Text>}{" "}
        </Text>
      ))}
      <Text dimColor> (Tab to complete, ↑↓ to select)</Text>
    </Box>
  );
}

/**
 * Check if command suggestions should be shown
 */
export function shouldShowCommandSuggestions(input: string): boolean {
  return input.startsWith("/") && input.length >= 2;
}
