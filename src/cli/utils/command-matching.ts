// Command matching utilities

import { COMMANDS, type Command } from "../constants";

/**
 * Get matching commands for partial input
 */
export function getMatchingCommands(input: string): Command[] {
  if (!input.startsWith("/") || input.length < 2) return [];

  const search = input.slice(1).toLowerCase();
  const matches = COMMANDS.filter(
    (cmd) =>
      cmd.name.startsWith(search) || (cmd.alias?.startsWith(search) ?? false)
  );

  // Don't show if exact match
  if (matches.length === 1 && matches[0]?.name === search) {
    return [];
  }

  return matches.slice(0, 4) as Command[];
}

/**
 * Extract the @path being typed at cursor position
 */
export function extractPathAtCursor(
  input: string,
  cursorIndex: number
): { path: string; startIndex: number } | null {
  // Look backwards from cursor to find @
  let atIndex = -1;
  for (let i = cursorIndex - 1; i >= 0; i--) {
    const ch = input[i];
    if (ch === "@") {
      atIndex = i;
      break;
    }
    // Stop if we hit whitespace or certain punctuation
    if (ch === " " || ch === "\n" || ch === "\t") {
      break;
    }
  }

  if (atIndex === -1) return null;

  // Extract the path from @ to cursor
  const path = input.slice(atIndex + 1, cursorIndex);
  return { path, startIndex: atIndex };
}
