// Filesystem handlers for remote @path expansion and directory listing

import { resolve, isAbsolute, join } from "path";
import { readdirSync, statSync } from "fs";

export interface FsReadResult {
  content: string | null;
  error?: string;
  path: string;
}

export interface FsListEntry {
  name: string;
  type: "file" | "directory";
}

export interface FsListResult {
  entries: FsListEntry[];
  error?: string;
  path: string;
}

export async function handleFsReadTextFile(
  filePath: string,
  cwd?: string
): Promise<FsReadResult> {
  const absolutePath = isAbsolute(filePath) ? filePath : resolve(cwd || process.cwd(), filePath);

  try {
    const file = Bun.file(absolutePath);
    if (!(await file.exists())) {
      return { content: null, error: `File not found: ${absolutePath}`, path: absolutePath };
    }

    const content = await file.text();

    // Limit file size to prevent massive responses (1MB limit)
    if (content.length > 1024 * 1024) {
      return {
        content: content.slice(0, 1024 * 1024),
        error: `File truncated (>1MB)`,
        path: absolutePath,
      };
    }

    return { content, path: absolutePath };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: null, error: `Failed to read: ${msg}`, path: absolutePath };
  }
}

export async function handleFsListDirectory(
  dirPath: string,
  cwd?: string
): Promise<FsListResult> {
  const absolutePath = isAbsolute(dirPath) ? dirPath : resolve(cwd || process.cwd(), dirPath);

  try {
    const entries = readdirSync(absolutePath);
    const result = entries
      .filter((name) => !name.startsWith(".")) // Skip hidden files
      .slice(0, 100) // Limit to 100 entries
      .map((name) => {
        try {
          const stat = statSync(join(absolutePath, name));
          return { name, type: stat.isDirectory() ? "directory" as const : "file" as const };
        } catch {
          return { name, type: "file" as const };
        }
      });

    return { entries: result, path: absolutePath };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { entries: [], error: `Failed to list: ${msg}`, path: absolutePath };
  }
}
