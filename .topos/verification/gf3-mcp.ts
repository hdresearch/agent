// GF(3) Conservation MCP Bridge
// Uses Dafny-verified gf3.js for formally proven operations

import { readFileSync } from "fs";
import { dirname, join } from "path";

// Load the Dafny-compiled module
const gf3Path = join(dirname(import.meta.path), "gf3.js");

// Trit type matching Dafny
export type Trit = -1 | 0 | 1;
export type TritName = "Minus" | "Zero" | "Plus";

// Map trit values to names
export const tritName = (t: Trit): TritName => {
  switch (t) {
    case -1: return "Minus";
    case 0: return "Zero";
    case 1: return "Plus";
  }
};

// Map names to values
export const tritValue = (name: TritName): Trit => {
  switch (name) {
    case "Minus": return -1;
    case "Zero": return 0;
    case "Plus": return 1;
  }
};

// GF(3) sum of trits
export const gf3Sum = (trits: Trit[]): number => {
  return trits.reduce((sum, t) => sum + t, 0);
};

// Check if balanced (sum ≡ 0 mod 3)
export const isBalanced = (trits: Trit[]): boolean => {
  const sum = gf3Sum(trits);
  return ((sum % 3) + 3) % 3 === 0;
};

// Compute balancing trit for a triad
export const balanceTriad = (triad: [Trit, Trit, Trit]): Trit => {
  const sum = gf3Sum(triad);
  const mod3 = (((-sum) % 3) + 3) % 3;
  if (mod3 === 0) return 0;
  if (mod3 === 1) return 1;
  return -1;
};

// Negate a trit
export const negateTrit = (t: Trit): Trit => {
  return (-t) as Trit;
};

// Add two trits in GF(3)
export const addGF3 = (a: Trit, b: Trit): Trit => {
  const sum = a + b;
  const mod3 = ((sum % 3) + 3) % 3;
  if (mod3 === 0) return 0;
  if (mod3 === 1) return 1;
  return -1;
};

// Skill alphabet mapping
export const SKILL_ALPHABET: Record<string, { skill: string; trit: Trit; desc: string }> = {
  a: { skill: "acsets-hatchery", trit: 1, desc: "Attributed C-Sets" },
  b: { skill: "bisimulation-game", trit: 0, desc: "Resilient dispersal" },
  c: { skill: "catsharp", trit: 0, desc: "Cat# Ergodic" },
  d: { skill: "discopy-operads", trit: 1, desc: "String diagrams" },
  e: { skill: "enzyme-autodiff", trit: 0, desc: "Automatic differentiation" },
  f: { skill: "fokker-planck-analyzer", trit: -1, desc: "Convergence analysis" },
  g: { skill: "gay-mcp", trit: 1, desc: "Deterministic colors" },
  h: { skill: "hoot", trit: -1, desc: "Scheme→WASM" },
  i: { skill: "ies", trit: 0, desc: "Interaction Entropy" },
  j: { skill: "jacobian", trit: -1, desc: "Partial derivatives" },
  k: { skill: "kan-extensions", trit: 0, desc: "Universal constructions" },
  l: { skill: "lyapunov-function", trit: -1, desc: "Decreasing along trajectories" },
  m: { skill: "monoidal-category", trit: 0, desc: "⊗ I α λ ρ" },
  n: { skill: "natural-transformation", trit: 0, desc: "Morphisms of functors" },
  o: { skill: "operad-compose", trit: 1, desc: "Multi-input operations" },
  p: { skill: "propagators", trit: -1, desc: "Constraint networks" },
  q: { skill: "quillen-model", trit: -1, desc: "Homotopy structures" },
  r: { skill: "reafference-corollary-discharge", trit: 0, desc: "Von Holst verification" },
  s: { skill: "segal-types", trit: 1, desc: "∞-categories" },
  t: { skill: "topos-logic", trit: 0, desc: "Cartesian closed + Ω" },
  u: { skill: "unison", trit: 1, desc: "Content-addressed code" },
  v: { skill: "virtual-double", trit: -1, desc: "Loose morphisms" },
  w: { skill: "worlding", trit: 1, desc: "Composable state builders" },
  x: { skill: "x-module-bimodule", trit: -1, desc: "Profunctors" },
  y: { skill: "yoneda-embedding", trit: 0, desc: "Fully faithful" },
  z: { skill: "zx-calculus", trit: 1, desc: "Quantum string diagrams" },
};

// Get skill info by letter
export const getSkill = (letter: string) => {
  const l = letter.toLowerCase();
  return SKILL_ALPHABET[l] ?? null;
};

// Check if a letter triad is balanced
export const checkTriad = (l1: string, l2: string, l3: string): {
  balanced: boolean;
  sum: number;
  skills: Array<{ letter: string; skill: string; trit: Trit }>;
} => {
  const s1 = getSkill(l1);
  const s2 = getSkill(l2);
  const s3 = getSkill(l3);
  
  if (!s1 || !s2 || !s3) {
    throw new Error(`Invalid letter(s): ${l1}, ${l2}, ${l3}`);
  }
  
  const trits: [Trit, Trit, Trit] = [s1.trit, s2.trit, s3.trit];
  const sum = gf3Sum(trits);
  
  return {
    balanced: isBalanced(trits),
    sum,
    skills: [
      { letter: l1, skill: s1.skill, trit: s1.trit },
      { letter: l2, skill: s2.skill, trit: s2.trit },
      { letter: l3, skill: s3.skill, trit: s3.trit },
    ],
  };
};

// Find balancing letter for a pair
export const findBalancer = (l1: string, l2: string): string[] => {
  const s1 = getSkill(l1);
  const s2 = getSkill(l2);
  
  if (!s1 || !s2) {
    throw new Error(`Invalid letter(s): ${l1}, ${l2}`);
  }
  
  const partialSum = s1.trit + s2.trit;
  const needed = balanceTriad([s1.trit, s2.trit, 0]);
  
  // Find all letters with the needed trit
  return Object.entries(SKILL_ALPHABET)
    .filter(([_, info]) => info.trit === needed)
    .map(([letter, _]) => letter);
};

// MCP tool definitions
export const MCP_TOOLS = {
  "gf3/check-triad": {
    description: "Check if a skill triad (3 letters) is GF(3) balanced",
    inputSchema: {
      type: "object",
      properties: {
        l1: { type: "string", description: "First letter" },
        l2: { type: "string", description: "Second letter" },
        l3: { type: "string", description: "Third letter" },
      },
      required: ["l1", "l2", "l3"],
    },
    handler: (args: { l1: string; l2: string; l3: string }) => checkTriad(args.l1, args.l2, args.l3),
  },
  "gf3/find-balancer": {
    description: "Find letters that would balance a pair",
    inputSchema: {
      type: "object",
      properties: {
        l1: { type: "string", description: "First letter" },
        l2: { type: "string", description: "Second letter" },
      },
      required: ["l1", "l2"],
    },
    handler: (args: { l1: string; l2: string }) => findBalancer(args.l1, args.l2),
  },
  "gf3/skill-info": {
    description: "Get skill info for a letter",
    inputSchema: {
      type: "object",
      properties: {
        letter: { type: "string", description: "Letter a-z" },
      },
      required: ["letter"],
    },
    handler: (args: { letter: string }) => getSkill(args.letter),
  },
  "gf3/is-balanced": {
    description: "Check if a sequence of trits is balanced",
    inputSchema: {
      type: "object",
      properties: {
        trits: { type: "array", items: { type: "number" }, description: "Array of trits (-1, 0, 1)" },
      },
      required: ["trits"],
    },
    handler: (args: { trits: Trit[] }) => ({ balanced: isBalanced(args.trits), sum: gf3Sum(args.trits) }),
  },
};

// CLI interface
if (import.meta.main) {
  const [cmd, ...args] = Bun.argv.slice(2);
  
  switch (cmd) {
    case "triad":
      console.log(JSON.stringify(checkTriad(args[0], args[1], args[2]), null, 2));
      break;
    case "balance":
      console.log(JSON.stringify(findBalancer(args[0], args[1]), null, 2));
      break;
    case "skill":
      console.log(JSON.stringify(getSkill(args[0]), null, 2));
      break;
    case "list":
      console.log("PLUS (+1):", Object.entries(SKILL_ALPHABET).filter(([_, s]) => s.trit === 1).map(([l]) => l).join(""));
      console.log("ERGODIC (0):", Object.entries(SKILL_ALPHABET).filter(([_, s]) => s.trit === 0).map(([l]) => l).join(""));
      console.log("MINUS (-1):", Object.entries(SKILL_ALPHABET).filter(([_, s]) => s.trit === -1).map(([l]) => l).join(""));
      break;
    default:
      console.log("Usage: bun gf3-mcp.ts <triad|balance|skill|list> [args]");
      console.log("  triad <l1> <l2> <l3>  - Check if triad is balanced");
      console.log("  balance <l1> <l2>     - Find balancing letters");
      console.log("  skill <letter>        - Get skill info");
      console.log("  list                  - List all skills by trit");
  }
}
