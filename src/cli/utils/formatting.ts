// Formatting utilities for CLI display

/**
 * Format token count with K/M suffix
 */
export function formatTokens(tokens: number): string {
  if (tokens >= 1000000) {
    return `${(tokens / 1000000).toFixed(1)}M`;
  }
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}K`;
  }
  return tokens.toString();
}

/**
 * Format tool arguments for display
 */
export function formatToolArgs(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case "Bash": {
      const cmd = (input.command as string) || "";
      const preview = cmd.length > 50 ? cmd.slice(0, 50) + "..." : cmd;
      return preview;
    }
    case "Read":
      return String(input.file_path || "");
    case "Write":
      return String(input.file_path || "");
    case "Edit": {
      const oldStr = (input.old_string as string) || "";
      const newStr = (input.new_string as string) || "";
      return `${input.file_path} (-${oldStr.split("\n").length}/+${newStr.split("\n").length} lines)`;
    }
    case "Glob":
      return String(input.pattern || "");
    case "Grep":
      return `/${input.pattern}/`;
    case "WebFetch":
      return String(input.url || "");
    case "WebSearch":
      return String(input.query || "");
    default: {
      // Show first string value from input
      const firstVal = Object.values(input).find(v => typeof v === "string");
      return firstVal ? String(firstVal).slice(0, 40) : "";
    }
  }
}

// Unique ID counter for output lines
let idCounter = 0;

/**
 * Generate a unique ID for output lines
 */
export function uniqueId(): string {
  return `line-${++idCounter}`;
}

/**
 * Reset the ID counter (useful for testing)
 */
export function resetIdCounter(): void {
  idCounter = 0;
}
