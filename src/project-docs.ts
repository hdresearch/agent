// Project documentation reader
// Reads CLAUDE.md, AGENT.md, AGENTS.md from project directories

import { join, dirname } from "path";

const DOC_FILES = ["CLAUDE.md", "AGENT.md", "AGENTS.md"];

export interface ProjectDocs {
  files: Array<{
    path: string;
    name: string;
    content: string;
  }>;
  combined: string;
}

// Read a file if it exists
async function tryReadFile(path: string): Promise<string | null> {
  try {
    const file = Bun.file(path);
    if (await file.exists()) {
      return await file.text();
    }
  } catch {
    // File doesn't exist or can't be read
  }
  return null;
}

// Find and read project doc files starting from cwd and walking up
export async function readProjectDocs(cwd: string = process.cwd()): Promise<ProjectDocs> {
  const foundFiles: ProjectDocs["files"] = [];
  const seenPaths = new Set<string>();

  // Walk up from cwd to find doc files
  let currentDir = cwd;
  const root = dirname(currentDir) === currentDir ? currentDir : "/";

  while (currentDir !== root) {
    for (const docFile of DOC_FILES) {
      const filePath = join(currentDir, docFile);

      if (seenPaths.has(filePath)) continue;
      seenPaths.add(filePath);

      const content = await tryReadFile(filePath);
      if (content) {
        foundFiles.push({
          path: filePath,
          name: docFile,
          content,
        });
      }
    }

    // Move to parent directory
    const parent = dirname(currentDir);
    if (parent === currentDir) break;
    currentDir = parent;
  }

  // Also check home directory for global config
  const homeDir = process.env.HOME;
  if (homeDir) {
    for (const docFile of DOC_FILES) {
      const filePath = join(homeDir, ".vers", docFile);

      if (seenPaths.has(filePath)) continue;
      seenPaths.add(filePath);

      const content = await tryReadFile(filePath);
      if (content) {
        foundFiles.push({
          path: filePath,
          name: docFile,
          content,
        });
      }
    }
  }

  // Combine all docs into a single string
  const combined = foundFiles
    .map((f) => `# ${f.name} (${f.path})\n\n${f.content}`)
    .join("\n\n---\n\n");

  return { files: foundFiles, combined };
}

// Format docs as a system prompt section
export function formatDocsAsSystemPrompt(docs: ProjectDocs): string {
  if (docs.files.length === 0) {
    return "";
  }

  const sections = docs.files.map((f) => {
    return `<project-doc source="${f.path}">\n${f.content}\n</project-doc>`;
  });

  return `The following project documentation files were found. Follow any instructions they contain:\n\n${sections.join("\n\n")}`;
}

// Format docs to prepend to a user message (for re-injection after compaction)
export function formatDocsForReinjection(docs: ProjectDocs): string {
  if (docs.files.length === 0) {
    return "";
  }

  const sections = docs.files.map((f) => {
    return `<project-doc source="${f.path}">\n${f.content}\n</project-doc>`;
  });

  return `<context-refresh reason="compaction">
The conversation context was compacted. Here are the project documentation files again for reference:

${sections.join("\n\n")}
</context-refresh>

`;
}
