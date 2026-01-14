// Embedded skills - imported at build time and bundled into the binary
// This allows skills to be distributed with compiled vers-agent

import orchestrateSkill from "../../.claude/skills/orchestrate/SKILL.md" with { type: "text" };

export interface EmbeddedSkill {
  name: string;
  description: string;
  content: string;
}

function parseSkillFrontmatter(content: string): { name: string; description: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match?.[1]) return { name: "unknown", description: "" };

  const frontmatter = match[1];
  const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
  const descMatch = frontmatter.match(/^description:\s*(.+)$/m);

  return {
    name: nameMatch?.[1]?.trim() ?? "unknown",
    description: descMatch?.[1]?.trim() ?? "",
  };
}

// Parse and export embedded skills
const orchestrateMeta = parseSkillFrontmatter(orchestrateSkill);

export const embeddedSkills: EmbeddedSkill[] = [
  {
    name: orchestrateMeta.name,
    description: orchestrateMeta.description,
    content: orchestrateSkill,
  },
];

/**
 * Get an embedded skill by name
 */
export function getEmbeddedSkill(name: string): EmbeddedSkill | undefined {
  return embeddedSkills.find(s => s.name === name);
}

/**
 * List all embedded skill names
 */
export function listEmbeddedSkills(): string[] {
  return embeddedSkills.map(s => s.name);
}
