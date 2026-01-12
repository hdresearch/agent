/**
 * Skillsets - groups of skills that can be synced to remote machines
 *
 * Structure:
 *   ~/.vers-agent/skillsets/<name>/*.md
 *
 * Each .md file is a Claude Code command that will be synced to
 * the remote machine's ~/.claude/commands/ directory.
 */

import { join } from "path";
import { homedir } from "os";
import { mkdir, readdir } from "fs/promises";

const SKILLSETS_DIR = join(homedir(), ".vers-agent", "skillsets");

export interface SkillFile {
  name: string;      // filename without .md
  filename: string;  // full filename
  content: string;   // file contents
}

export interface Skillset {
  name: string;
  skills: SkillFile[];
}

async function ensureSkillsetsDir(): Promise<void> {
  await mkdir(SKILLSETS_DIR, { recursive: true });
}

/**
 * List all available skillsets
 */
export async function listSkillsets(): Promise<string[]> {
  await ensureSkillsetsDir();

  const entries = await readdir(SKILLSETS_DIR, { withFileTypes: true });
  return entries
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .sort();
}

/**
 * Get a skillset by name
 */
export async function getSkillset(name: string): Promise<Skillset | null> {
  const skillsetDir = join(SKILLSETS_DIR, name);

  try {
    const files = await readdir(skillsetDir);
    const mdFiles = files.filter(f => f.endsWith(".md"));

    const skills: SkillFile[] = [];
    for (const filename of mdFiles) {
      const content = await Bun.file(join(skillsetDir, filename)).text();
      skills.push({
        name: filename.replace(/\.md$/, ""),
        filename,
        content,
      });
    }

    return { name, skills };
  } catch {
    return null;
  }
}

/**
 * Create a new skillset directory
 */
export async function createSkillset(name: string): Promise<string> {
  const skillsetDir = join(SKILLSETS_DIR, name);
  await mkdir(skillsetDir, { recursive: true });
  return skillsetDir;
}

/**
 * Get the path to the skillsets directory
 */
export function getSkillsetsDir(): string {
  return SKILLSETS_DIR;
}
