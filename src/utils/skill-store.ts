/**
 * Skill store - manages local skill definitions
 *
 * Supports multiple formats and locations:
 * 1. JSON files in ~/.vers-agent/skills/<name>.json (vers-agent native)
 * 2. Claude Code skills in ~/.claude/skills/<name>/SKILL.md (personal)
 * 3. Claude Code skills in .claude/skills/<name>/SKILL.md (project)
 * 4. Claude Code commands in ~/.claude/commands/<name>.md (personal)
 * 5. Claude Code commands in .claude/commands/<name>.md (project)
 */

import { join } from "path";
import { homedir } from "os";
import { mkdir, readdir, stat } from "fs/promises";

const VERS_SKILLS_DIR = join(homedir(), ".vers-agent", "skills");
const CLAUDE_PERSONAL_SKILLS_DIR = join(homedir(), ".claude", "skills");
const CLAUDE_PERSONAL_COMMANDS_DIR = join(homedir(), ".claude", "commands");

export interface Skill {
  name: string;
  description: string;
  /** The prompt/instructions to send to the agent when this skill is invoked */
  prompt: string;
  /** Optional: arguments hint for the user */
  argsHint?: string;
  /** When the skill was created */
  createdAt: string;
  /** When the skill was last updated */
  updatedAt: string;
  /** Source location: vers, claude-skill, claude-command */
  source?: "vers" | "claude-skill" | "claude-command";
  /** Path to the skill file (for editing) */
  path?: string;
}

async function ensureSkillsDir(): Promise<void> {
  await mkdir(VERS_SKILLS_DIR, { recursive: true });
}

function skillPath(name: string): string {
  // Sanitize name to prevent path traversal
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "_");
  return join(VERS_SKILLS_DIR, `${safeName}.json`);
}

/**
 * Parse YAML frontmatter from Markdown content
 */
function parseFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match || !match[1] || match[2] === undefined) {
    return { frontmatter: {}, body: content };
  }

  const frontmatter: Record<string, string> = {};
  const yamlLines = match[1].split("\n");
  for (const line of yamlLines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      frontmatter[key] = value;
    }
  }

  return { frontmatter, body: match[2] };
}

/**
 * Load Claude Code skills from a skills directory
 */
async function loadClaudeSkills(skillsDir: string, source: "claude-skill"): Promise<Skill[]> {
  const skills: Skill[] = [];

  try {
    const entries = await readdir(skillsDir);
    for (const entry of entries) {
      const entryPath = join(skillsDir, entry);
      const entryStat = await stat(entryPath).catch(() => null);
      if (!entryStat?.isDirectory()) continue;

      const skillMdPath = join(entryPath, "SKILL.md");
      const file = Bun.file(skillMdPath);
      if (!await file.exists()) continue;

      try {
        const content = await file.text();
        const { frontmatter, body } = parseFrontmatter(content);

        skills.push({
          name: frontmatter.name || entry,
          description: frontmatter.description || "",
          prompt: body.trim(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          source,
          path: skillMdPath,
        });
      } catch {
        // Skip invalid files
      }
    }
  } catch {
    // Directory doesn't exist or not readable
  }

  return skills;
}

/**
 * Load Claude Code commands from a commands directory
 */
async function loadClaudeCommands(commandsDir: string): Promise<Skill[]> {
  const skills: Skill[] = [];

  try {
    const glob = new Bun.Glob("*.md");
    for await (const file of glob.scan(commandsDir)) {
      const filePath = join(commandsDir, file);
      try {
        const content = await Bun.file(filePath).text();
        const { frontmatter, body } = parseFrontmatter(content);
        const name = file.replace(/\.md$/, "");

        skills.push({
          name,
          description: frontmatter.description || "",
          prompt: body.trim(),
          argsHint: body.includes("$ARGUMENTS") ? "<arguments>" : undefined,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          source: "claude-command",
          path: filePath,
        });
      } catch {
        // Skip invalid files
      }
    }
  } catch {
    // Directory doesn't exist or not readable
  }

  return skills;
}

/**
 * Load vers-agent JSON skills
 */
async function loadVersSkills(): Promise<Skill[]> {
  await ensureSkillsDir();

  const skills: Skill[] = [];
  const glob = new Bun.Glob("*.json");

  for await (const file of glob.scan(VERS_SKILLS_DIR)) {
    try {
      const filePath = join(VERS_SKILLS_DIR, file);
      const content = await Bun.file(filePath).text();
      const skill = JSON.parse(content) as Skill;
      skill.source = "vers";
      skill.path = filePath;
      skills.push(skill);
    } catch {
      // Skip invalid skill files
    }
  }

  return skills;
}

/**
 * List all available skills from all sources
 */
export async function listSkills(): Promise<Skill[]> {
  const [versSkills, personalClaudeSkills, personalClaudeCommands, projectClaudeSkills, projectClaudeCommands] = await Promise.all([
    loadVersSkills(),
    loadClaudeSkills(CLAUDE_PERSONAL_SKILLS_DIR, "claude-skill"),
    loadClaudeCommands(CLAUDE_PERSONAL_COMMANDS_DIR),
    loadClaudeSkills(join(process.cwd(), ".claude", "skills"), "claude-skill"),
    loadClaudeCommands(join(process.cwd(), ".claude", "commands")),
  ]);

  // Combine all skills, project skills take precedence over personal
  const skillMap = new Map<string, Skill>();

  // Add in order of precedence (later wins)
  for (const skill of [...personalClaudeSkills, ...personalClaudeCommands, ...versSkills, ...projectClaudeSkills, ...projectClaudeCommands]) {
    skillMap.set(skill.name, skill);
  }

  return Array.from(skillMap.values()).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Get a specific skill by name (searches all sources)
 */
export async function getSkill(name: string): Promise<Skill | null> {
  // Search all sources for the skill
  const allSkills = await listSkills();
  return allSkills.find(s => s.name === name) || null;
}

/**
 * Save a skill (create or update)
 */
export async function saveSkill(skill: Omit<Skill, "createdAt" | "updatedAt"> & { createdAt?: string; updatedAt?: string }): Promise<Skill> {
  await ensureSkillsDir();

  const existing = await getSkill(skill.name);
  const now = new Date().toISOString();

  const fullSkill: Skill = {
    ...skill,
    createdAt: existing?.createdAt || skill.createdAt || now,
    updatedAt: now,
  };

  const path = skillPath(skill.name);
  await Bun.write(path, JSON.stringify(fullSkill, null, 2));

  return fullSkill;
}

/**
 * Delete a skill
 */
export async function deleteSkill(name: string): Promise<boolean> {
  await ensureSkillsDir();

  const path = skillPath(name);
  const file = Bun.file(path);

  if (!await file.exists()) {
    return false;
  }

  const { unlink } = await import("fs/promises");
  await unlink(path);
  return true;
}

/**
 * Build the full prompt to send to the agent when invoking a skill
 * Supports $ARGUMENTS placeholder from Claude Code commands
 */
export function buildSkillPrompt(skill: Skill, userArgs?: string): string {
  let prompt = skill.prompt;

  // Replace $ARGUMENTS placeholder (Claude Code convention)
  if (prompt.includes("$ARGUMENTS")) {
    prompt = prompt.replace(/\$ARGUMENTS/g, userArgs?.trim() || "");
  } else if (userArgs?.trim()) {
    // If no placeholder, append args at the end
    prompt += `\n\n---\n\nUser request: ${userArgs.trim()}`;
  }

  return prompt;
}
