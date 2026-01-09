// String utility functions

/**
 * Clean up a title string: strip surrounding quotes and filter invalid values
 * Used for tool names, titles, etc. to ensure display-friendly output
 */
export function cleanTitle(s: string | undefined | unknown): string | undefined {
  // Handle unknown type (for cases where the input might be any type)
  if (typeof s !== "string" || !s || s === "undefined" || s.trim() === "") {
    return undefined;
  }

  // Strip surrounding quotes if present
  let cleaned = s.trim();
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"))
  ) {
    cleaned = cleaned.slice(1, -1);
  }

  return cleaned || undefined;
}
