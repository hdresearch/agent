import React from "react";
import { Box, Text } from "ink";
import { getMatchingCommands } from "../utils/command-matching";

interface CommandSuggestionsProps {
  input: string;
  selectedIndex: number;
}

export function CommandSuggestions({
  input,
  selectedIndex,
}: CommandSuggestionsProps) {
  const matches = getMatchingCommands(input);

  if (matches.length === 0) return null;

  return (
    <Box flexDirection="row" gap={2} marginLeft={2}>
      {matches.map((cmd, idx) => (
        <Text
          key={cmd.name}
          dimColor={idx !== selectedIndex}
          color={idx === selectedIndex ? "cyan" : undefined}
          inverse={idx === selectedIndex}
        >
          {" "}
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
