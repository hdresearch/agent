// Path completion utilities

import type { PathMatch } from "../types";
import type { HttpAcpClient } from "../../client/http-client";

/**
 * List files matching a partial path (supports local or remote via client)
 */
export async function getMatchingPaths(
  partialPath: string,
  cwd: string,
  client?: HttpAcpClient | null
): Promise<PathMatch[]> {
  const { join, dirname, basename, resolve } = await import("path");

  try {
    // Determine directory to list and prefix to match
    let dirToList: string;
    let prefix: string;

    if (partialPath === "" || partialPath === ".") {
      dirToList = cwd;
      prefix = "";
    } else if (partialPath === "./") {
      dirToList = cwd;
      prefix = "";
    } else if (partialPath.endsWith("/")) {
      dirToList = resolve(cwd, partialPath);
      prefix = "";
    } else {
      dirToList = resolve(cwd, dirname(partialPath));
      prefix = basename(partialPath).toLowerCase();
    }

    // Get directory entries - either remotely or locally
    let entries: Array<{ name: string; type: "file" | "directory" }>;

    if (client) {
      // Remote listing via ACP client
      const result = await client.listDirectory(dirToList);
      if (result.error) {
        return [];
      }
      entries = result.entries;
    } else {
      // Local listing
      const { readdirSync } = await import("fs");
      const dirEntries = readdirSync(dirToList, { withFileTypes: true });
      entries = dirEntries.map((entry) => ({
        name: entry.name,
        type: entry.isDirectory() ? "directory" as const : "file" as const,
      }));
    }

    const matches: PathMatch[] = [];

    for (const entry of entries) {
      // Skip hidden files unless prefix starts with .
      if (entry.name.startsWith(".") && !prefix.startsWith(".")) {
        continue;
      }

      if (entry.name.toLowerCase().startsWith(prefix)) {
        const isDir = entry.type === "directory";
        // Build the completion path
        let completionPath: string;
        if (partialPath === "" || partialPath === ".") {
          completionPath = entry.name;
        } else if (partialPath === "./") {
          completionPath = "./" + entry.name;
        } else if (partialPath.endsWith("/")) {
          completionPath = partialPath + entry.name;
        } else {
          const dir = dirname(partialPath);
          completionPath = dir === "." ? entry.name : join(dir, entry.name);
        }

        matches.push({
          name: entry.name,
          path: completionPath + (isDir ? "/" : ""),
          isDirectory: isDir,
        });
      }
    }

    // Sort: directories first, then alphabetically
    matches.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });

    return matches.slice(0, 6);
  } catch {
    return [];
  }
}
