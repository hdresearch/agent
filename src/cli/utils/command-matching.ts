// Command matching utilities

import { COMMANDS, type Command } from "../constants";
import type { AvailableCommandData } from "../../protocol/acp-types";

// Extended command type with source information
export interface MatchedCommand {
  name: string;
  alias: string | null;
  description: string;
  source: "local" | "agent";
}

/**
 * Get matching commands for partial input
 * Merges local CLI commands with agent commands from subprocess
 */
export function getMatchingCommands(
  input: string,
  agentCommands: AvailableCommandData[] = []
): MatchedCommand[] {
  if (!input.startsWith("/") || input.length < 2) return [];

  const search = input.slice(1).toLowerCase();

  // Build combined command list - agent commands first (higher priority)
  const allCommands: MatchedCommand[] = [
    ...agentCommands.map((cmd) => ({
      name: cmd.name,
      alias: null,
      description: cmd.description,
      source: "agent" as const,
    })),
    ...COMMANDS.map((cmd) => ({
      name: cmd.name,
      alias: cmd.alias,
      description: cmd.description,
      source: "local" as const,
    })),
  ];

  // Filter by prefix match
  const matches = allCommands.filter(
    (cmd) =>
      cmd.name.startsWith(search) || (cmd.alias?.startsWith(search) ?? false)
  );

  // Deduplicate by name (agent commands take precedence)
  const seen = new Set<string>();
  const deduped = matches.filter((cmd) => {
    if (seen.has(cmd.name)) return false;
    seen.add(cmd.name);
    return true;
  });

  // Don't show if exact match
  if (deduped.length === 1 && deduped[0]?.name === search) {
    return [];
  }

  return deduped.slice(0, 6); // Show up to 6 commands (more room for agent commands)
}

/**
 * Check if a command is an agent command
 */
export function isAgentCommand(
  commandName: string,
  agentCommands: AvailableCommandData[]
): boolean {
  return agentCommands.some((cmd) => cmd.name === commandName);
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
