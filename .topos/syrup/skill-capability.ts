/**
 * Skill-Capability Bridge
 * 
 * Maps skills to CapTP capabilities with GF(3) conservation.
 * Each skill becomes a sturdyref that can be invoked via OCapN.
 * 
 * Architecture:
 *   Skill (SKILL.md) → SkillCapability → SturdyRef → OCapN endpoint
 *   
 * GF(3) Conservation:
 *   Skills are colored with trits {-1, 0, +1} such that
 *   balanced triads sum to 0 (mod 3).
 */

import { encode, type SyrupRecord } from "./syrup";

// ============================================================
// TYPES
// ============================================================

export type Trit = -1 | 0 | 1;

export interface SkillMetadata {
  name: string;
  description: string;
  version: string;
  path: string;
}

export interface SkillCapability {
  // Identity
  name: string;
  uri: string;           // skill://name#COLOR
  sturdyref: string;     // ocapn://tailscale/node/skill-name
  
  // GF(3) coloring
  color: string;         // Hex color
  trit: Trit;
  tritSymbol: string;    // −, ○, +
  
  // Content
  metadata: SkillMetadata;
  content: string;       // Full SKILL.md content
  
  // Capability operations
  facets: string[];      // Available operations
}

export interface SkillTriad {
  skills: [string, string, string];
  trits: [Trit, Trit, Trit];
  colors: [string, string, string];
  sum: number;
  balanced: boolean;
}

export interface SkillQuad {
  skills: [string, string, string, string];
  trits: [Trit, Trit, Trit, Trit];
  colors: [string, string, string, string];
  sum: number;
  balanced: boolean;
}

// ============================================================
// GF(3) COLOR GENERATION (matches Gay.jl)
// ============================================================

// SplitMix64-based hash for deterministic coloring
function splitmix64(seed: bigint): bigint {
  let z = seed + 0x9e3779b97f4a7c15n;
  z = (z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n;
  z = (z ^ (z >> 27n)) * 0x94d049bb133111ebn;
  return (z ^ (z >> 31n)) & 0xffffffffffffffffn;
}

function hashString(s: string): bigint {
  let h = 0n;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31n + BigInt(s.charCodeAt(i))) & 0xffffffffffffffffn;
  }
  return h;
}

function computeColor(skillName: string, seed: number = 1069): string {
  const hash = splitmix64(hashString(skillName) + BigInt(seed));
  const hue = Number(hash % 360n);
  return hslToHex(hue, 70, 55);
}

function computeTrit(skillName: string): Trit {
  const hash = splitmix64(hashString(skillName));
  const mod = Number(hash % 3n);
  return mod === 0 ? 0 : mod === 1 ? 1 : -1;
}

function tritSymbol(trit: Trit): string {
  switch (trit) {
    case -1: return "−";
    case 0: return "○";
    case 1: return "+";
  }
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`.toUpperCase();
}

// ============================================================
// SKILL LOADING
// ============================================================

const SKILL_DIRS = [
  `${process.env.HOME}/.claude/skills`,
  `${process.cwd()}/asi/skills`,
];

async function loadSkillMetadata(skillPath: string): Promise<SkillMetadata | null> {
  const skillMdPath = `${skillPath}/SKILL.md`;
  try {
    const file = Bun.file(skillMdPath);
    if (!await file.exists()) return null;
    
    const content = await file.text();
    
    // Parse YAML frontmatter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch || !frontmatterMatch[1]) {
      const name = skillPath.split('/').pop() || 'unknown';
      return { name, description: '', version: '1.0.0', path: skillPath };
    }
    
    const frontmatter: string = frontmatterMatch[1];
    const name = frontmatter.match(/name:\s*(.+)/)?.[1]?.trim() || skillPath.split('/').pop() || 'unknown';
    const description = frontmatter.match(/description:\s*(.+)/)?.[1]?.trim() || '';
    const version = frontmatter.match(/version:\s*(.+)/)?.[1]?.trim() || '1.0.0';
    
    return { name, description, version, path: skillPath };
  } catch {
    return null;
  }
}

async function loadSkillContent(skillPath: string): Promise<string> {
  try {
    const file = Bun.file(`${skillPath}/SKILL.md`);
    return await file.text();
  } catch {
    return '';
  }
}

// ============================================================
// SKILL CAPABILITY CREATION
// ============================================================

export async function createSkillCapability(
  skillName: string,
  nodeId: string = "barton-i",
  seed: number = 1069
): Promise<SkillCapability | null> {
  // Find skill in known directories
  let skillPath: string | null = null;
  for (const dir of SKILL_DIRS) {
    const testPath = `${dir}/${skillName}`;
    const file = Bun.file(`${testPath}/SKILL.md`);
    if (await file.exists()) {
      skillPath = testPath;
      break;
    }
  }
  
  if (!skillPath) {
    console.warn(`[SkillCapability] Skill not found: ${skillName}`);
    return null;
  }
  
  const metadata = await loadSkillMetadata(skillPath);
  if (!metadata) return null;
  
  const content = await loadSkillContent(skillPath);
  const color = computeColor(skillName, seed);
  const trit = computeTrit(skillName);
  
  return {
    name: skillName,
    uri: `skill://${skillName}#${color.slice(1)}`,
    sturdyref: `ocapn://tailscale/${nodeId}/skill-${skillName}`,
    color,
    trit,
    tritSymbol: tritSymbol(trit),
    metadata,
    content,
    facets: ['read', 'invoke', 'describe'],
  };
}

// ============================================================
// SKILL REGISTRY (26 Goblins = 26 Skills)
// ============================================================

export class SkillRegistry {
  private skills: Map<string, SkillCapability> = new Map();
  private nodeId: string;
  private seed: number;
  
  constructor(nodeId: string = "barton-i", seed: number = 1069) {
    this.nodeId = nodeId;
    this.seed = seed;
  }
  
  async loadSkill(skillName: string): Promise<SkillCapability | null> {
    // Check cache
    if (this.skills.has(skillName)) {
      return this.skills.get(skillName)!;
    }
    
    const cap = await createSkillCapability(skillName, this.nodeId, this.seed);
    if (cap) {
      this.skills.set(skillName, cap);
    }
    return cap;
  }
  
  async loadSkills(skillNames: string[]): Promise<SkillCapability[]> {
    const results = await Promise.all(skillNames.map(n => this.loadSkill(n)));
    return results.filter((c): c is SkillCapability => c !== null);
  }
  
  getSkill(name: string): SkillCapability | undefined {
    return this.skills.get(name);
  }
  
  listSkills(): SkillCapability[] {
    return Array.from(this.skills.values());
  }
  
  // Get all loaded skills as sturdyrefs
  getSturdyrefs(): Array<{ name: string; uri: string; sturdyref: string; trit: Trit; color: string }> {
    return this.listSkills().map(s => ({
      name: s.name,
      uri: s.uri,
      sturdyref: s.sturdyref,
      trit: s.trit,
      color: s.color,
    }));
  }
  
  // GF(3) balance check
  getGF3Sum(): number {
    return this.listSkills().reduce((sum, s) => sum + s.trit, 0);
  }
  
  isBalanced(): boolean {
    return this.getGF3Sum() % 3 === 0;
  }
  
  // Find skills that would balance current set
  suggestBalancingSkill(knownSkills: string[]): Trit {
    const currentSum = this.listSkills()
      .filter(s => knownSkills.includes(s.name))
      .reduce((sum, s) => sum + s.trit, 0);
    
    // Need trit such that (currentSum + trit) % 3 === 0
    const needed = (3 - (currentSum % 3)) % 3;
    return needed === 0 ? 0 : needed === 1 ? 1 : -1;
  }
}

// ============================================================
// TRIAD/QUAD FORMATION
// ============================================================

export function formTriad(
  s1: SkillCapability,
  s2: SkillCapability,
  s3: SkillCapability
): SkillTriad {
  const sum = s1.trit + s2.trit + s3.trit;
  return {
    skills: [s1.name, s2.name, s3.name],
    trits: [s1.trit, s2.trit, s3.trit],
    colors: [s1.color, s2.color, s3.color],
    sum,
    balanced: sum % 3 === 0,
  };
}

export function formQuad(
  s1: SkillCapability,
  s2: SkillCapability,
  s3: SkillCapability,
  s4: SkillCapability
): SkillQuad {
  const sum = s1.trit + s2.trit + s3.trit + s4.trit;
  return {
    skills: [s1.name, s2.name, s3.name, s4.name],
    trits: [s1.trit, s2.trit, s3.trit, s4.trit],
    colors: [s1.color, s2.color, s3.color, s4.color],
    sum,
    balanced: sum % 3 === 0,
  };
}

// ============================================================
// SYRUP ENCODING FOR CAPTP
// ============================================================

export function encodeSkillCapability(skill: SkillCapability): string {
  const record: SyrupRecord = {
    tag: Symbol.for('skill-capability'),
    fields: [
      skill.name,
      skill.uri,
      skill.sturdyref,
      skill.trit,
      skill.color,
      skill.facets,
    ],
  };
  return encode(record);
}

export function encodeSkillInvocation(
  skillName: string,
  method: string,
  args: unknown[] = []
): string {
  const record: SyrupRecord = {
    tag: Symbol.for('op:deliver'),
    fields: [
      { tag: Symbol.for('skill-ref'), fields: [skillName] },
      method,
      args as any,
    ],
  };
  return encode(record);
}

// ============================================================
// CANONICAL 26 SKILLS (Wizard Book Mapping)
// ============================================================

// Map SICP chapters to skill categories
export const SICP_SKILL_MAP = {
  // Chapter 1: Building Abstractions with Procedures [PLUS]
  'ch1-procedures': ['scheme', 'clojure', 'lambda-calculus', 'sicp', 'recursion'],
  
  // Chapter 2: Building Abstractions with Data [ERGODIC]
  'ch2-data': ['acsets', 'crdt', 'algebraic-rewriting', 'specter-acset', 'datalog-fixpoint'],
  
  // Chapter 3: Modularity, Objects, and State [PLUS]
  'ch3-state': ['goblins', 'captp', 'actor-model', 'streams', 'concurrency'],
  
  // Chapter 4: Metalinguistic Abstraction [PLUS]
  'ch4-metalinguistic': ['eval-apply', 'metacircular', 'prolog', 'unification', 'amb'],
  
  // Chapter 5: Register Machines [ERGODIC]
  'ch5-machines': ['continuation', 'compilation', 'garbage-collection', 'vm', 'assembly'],
};

// Canonical 26-goblin skill set (balanced GF(3))
export const CANONICAL_26_SKILLS = [
  // Core computational skills (SICP-aligned)
  'sicp',           // 0: The wizard book itself
  'scheme',         // 1: The language of SICP
  'goblins',        // 2: Distributed objects
  'captp',          // 3: Capability transport
  'acsets',         // 4: Algebraic data structures
  'crdt',           // 5: Conflict-free data types
  
  // Category theory bridge
  'catsharp',       // 6: Cat# bicomodules
  'presheaf-topos', // 7: Topos theory
  'sheaf-cohomology', // 8: Cohomological methods
  'operad-compose', // 9: Compositional structures
  
  // GF(3) and coloring
  'gay-mcp',        // 10: Deterministic colors
  'gf3-society',    // 11: Three-valued logic
  'bifurcation',    // 12: Dynamical systems
  
  // Agent and AI
  'agent-o-rama',   // 13: Multi-agent systems
  'active-inference', // 14: Free energy principle
  'autopoiesis',    // 15: Self-production
  
  // Infrastructure
  'babashka',       // 16: Fast Clojure scripting
  'nix-flakes',     // 17: Reproducible builds
  'tailscale',      // 18: Mesh networking
  
  // Domain-specific
  'aptos-agent',    // 19: Blockchain integration
  'bluesky-jetstream', // 20: Social graph
  'academic-research', // 21: Paper retrieval
  
  // Glass bead game
  'glass-bead-game', // 22: Skill synthesis
  'chromatic-walk', // 23: Color navigation
  'phenomenal-bisect', // 24: Consciousness
  
  // Meta
  '_integrated',    // 25: The meta-skill
];

// ============================================================
// DEMO / CLI
// ============================================================

if (import.meta.main) {
  console.log('═══ Skill-Capability Bridge ═══\n');
  
  const registry = new SkillRegistry("barton-i", 1069);
  
  // Load SICP and related skills
  const skillsToLoad = ['sicp', 'captp', 'goblins', 'scheme', 'acsets'];
  
  console.log('Loading skills...\n');
  const loaded = await registry.loadSkills(skillsToLoad);
  
  for (const skill of loaded) {
    console.log(`${skill.tritSymbol} ${skill.name.padEnd(12)} ${skill.color}  ${skill.sturdyref}`);
  }
  
  console.log(`\nLoaded: ${loaded.length} skills`);
  console.log(`GF(3) sum: ${registry.getGF3Sum()}`);
  console.log(`Balanced: ${registry.isBalanced() ? '✓' : '✗'}`);
  
  // Form triads
  if (loaded.length >= 3) {
    console.log('\n═══ Triads ═══\n');
    const s1 = loaded[0]!;
    const s2 = loaded[1]!;
    const s3 = loaded[2]!;
    const triad = formTriad(s1, s2, s3);
    console.log(`${triad.skills.join(' ⊗ ')}`);
    console.log(`Trits: ${triad.trits.join(' + ')} = ${triad.sum}`);
    console.log(`Balanced: ${triad.balanced ? '✓' : '✗'}`);
  }
  
  // Syrup encoding
  if (loaded.length > 0) {
    console.log('\n═══ Syrup Encoding ═══\n');
    const first = loaded[0]!;
    const syrup = encodeSkillCapability(first);
    console.log(`${first.name}: ${syrup}`);
    
    const invocation = encodeSkillInvocation(first.name, 'describe', []);
    console.log(`Invoke: ${invocation}`);
  }
  
  // Sturdyrefs for mesh
  console.log('\n═══ Sturdyrefs ═══\n');
  for (const ref of registry.getSturdyrefs()) {
    console.log(`  ${ref.sturdyref}`);
  }
}
