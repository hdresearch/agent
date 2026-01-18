/**
 * OCapN Skill Server - Port 9323
 * 
 * Maps skills to capabilities with GF(3) conservation.
 * Each skill becomes a sturdyref that can be invoked via OCapN.
 * 
 * The 26-goblin mesh now maps to skill triads:
 *   goblin-0  → sicp (0)      ERGODIC coordinator
 *   goblin-1  → scheme (+1)   PLUS generator  
 *   goblin-2  → goblins (+1)  PLUS generator
 *   goblin-3  → captp (+1)    PLUS generator
 *   ...
 */

import { encode, type SyrupRecord } from "./syrup";

// ============================================================
// GF(3) TYPES
// ============================================================

type Trit = -1 | 0 | 1;

const TRIT_SYMBOLS: Record<Trit, string> = {
  [-1]: "−",
  [0]: "○",
  [1]: "+",
};

const TRIT_NAMES: Record<Trit, string> = {
  [-1]: "MINUS (validator)",
  [0]: "ERGODIC (coordinator)",
  [1]: "PLUS (generator)",
};

// ============================================================
// SKILL MAPPING (from Gay.jl precomputed assignments)
// ============================================================

// Core 26 skills for goblin mesh (balanced GF(3))
const GOBLIN_SKILLS: Array<{ name: string; trit: Trit }> = [
  // ERGODIC (0) - Coordinators: 9 skills
  { name: "sicp", trit: 0 },
  { name: "acsets", trit: 0 },
  { name: "crdt", trit: 0 },
  { name: "babashka", trit: 0 },
  { name: "gay-mcp", trit: 0 },
  { name: "catsharp", trit: 0 },
  { name: "autopoiesis", trit: 0 },
  { name: "consensus", trit: 0 },
  { name: "equilibrium", trit: 0 },
  
  // PLUS (+1) - Generators: 9 skills
  { name: "scheme", trit: 1 },
  { name: "goblins", trit: 1 },
  { name: "captp", trit: 1 },
  { name: "algebraic-rewriting", trit: 1 },
  { name: "datalog-fixpoint", trit: 1 },
  { name: "operad-compose", trit: 1 },
  { name: "agent-o-rama", trit: 1 },
  { name: "presheaf-topos", trit: 1 },
  
  // MINUS (-1) - Validators: 8 skills  
  { name: "sheaf-cohomology", trit: -1 },
  { name: "glass-bead-game", trit: -1 },
  { name: "clojure", trit: -1 },
  { name: "emacs", trit: -1 },
  { name: "lyapunov-function", trit: -1 },
  { name: "invariant-measure", trit: -1 },
  { name: "limit-set", trit: -1 },
  { name: "structural-stability", trit: -1 },
];

// Verify GF(3) balance: 9*0 + 9*1 + 8*(-1) = 0 + 9 - 8 = 1
// Need to adjust: add one more MINUS skill
// Actually let's rebalance: 9*0 + 8*1 + 9*(-1) = 0 + 8 - 9 = -1
// Or: 8*0 + 9*1 + 9*(-1) = 0 + 9 - 9 = 0 ✓

const BALANCED_26_SKILLS: Array<{ name: string; trit: Trit; index: number }> = [
  // ERGODIC (0) - 8 coordinators
  { name: "sicp", trit: 0, index: 0 },
  { name: "acsets", trit: 0, index: 1 },
  { name: "crdt", trit: 0, index: 2 },
  { name: "babashka", trit: 0, index: 3 },
  { name: "gay-mcp", trit: 0, index: 4 },
  { name: "catsharp", trit: 0, index: 5 },
  { name: "autopoiesis", trit: 0, index: 6 },
  { name: "consensus", trit: 0, index: 7 },
  
  // PLUS (+1) - 9 generators
  { name: "scheme", trit: 1, index: 8 },
  { name: "goblins", trit: 1, index: 9 },
  { name: "captp", trit: 1, index: 10 },
  { name: "algebraic-rewriting", trit: 1, index: 11 },
  { name: "datalog-fixpoint", trit: 1, index: 12 },
  { name: "operad-compose", trit: 1, index: 13 },
  { name: "agent-o-rama", trit: 1, index: 14 },
  { name: "presheaf-topos", trit: 1, index: 15 },
  { name: "topos-adhesive-rewriting", trit: 1, index: 16 },
  
  // MINUS (-1) - 9 validators
  { name: "sheaf-cohomology", trit: -1, index: 17 },
  { name: "glass-bead-game", trit: -1, index: 18 },
  { name: "clojure", trit: -1, index: 19 },
  { name: "emacs", trit: -1, index: 20 },
  { name: "lyapunov-function", trit: -1, index: 21 },
  { name: "invariant-measure", trit: -1, index: 22 },
  { name: "limit-set", trit: -1, index: 23 },
  { name: "structural-stability", trit: -1, index: 24 },
  { name: "bifurcation", trit: -1, index: 25 },
];

// Verify: 8*0 + 9*1 + 9*(-1) = 0 + 9 - 9 = 0 ✓ BALANCED!

// ============================================================
// COLOR GENERATION
// ============================================================

function colorAt(seed: number, index: number): string {
  const phi = 1.618033988749895;
  const goldenAngle = 360 / (phi * phi);
  const hue = ((seed * 137 + index * goldenAngle) % 360);
  return hslToHex(hue, 70, 55);
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100; l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`.toUpperCase();
}

// ============================================================
// SKILL CAPABILITY TYPE
// ============================================================

interface SkillCapability {
  name: string;
  index: number;
  trit: Trit;
  tritSymbol: string;
  tritName: string;
  color: string;
  sturdyref: string;
  uri: string;
  facets: string[];
}

// ============================================================
// MESH STATE
// ============================================================

interface SkillMeshState {
  nodeId: string;
  port: number;
  seed: number;
  skills: SkillCapability[];
  peers: Map<string, { node: string; ip: string; skills: string[]; connectedAt: string }>;
  invocationCount: number;
  gf3Sum: number;
}

function initSkillMesh(): SkillMeshState {
  const seed = 1069;
  const nodeId = "barton-i";
  
  const skills: SkillCapability[] = BALANCED_26_SKILLS.map(s => ({
    name: s.name,
    index: s.index,
    trit: s.trit,
    tritSymbol: TRIT_SYMBOLS[s.trit],
    tritName: TRIT_NAMES[s.trit],
    color: colorAt(seed, s.index),
    sturdyref: `ocapn://tailscale/${nodeId}/skill-${s.name}`,
    uri: `skill://${s.name}#${colorAt(seed, s.index).slice(1)}`,
    facets: ["read", "invoke", "describe"],
  }));
  
  // Calculate GF(3) sum
  const gf3Sum = skills.reduce((sum, s) => sum + s.trit, 0);
  
  return {
    nodeId,
    port: 9323,
    seed,
    skills,
    peers: new Map(),
    invocationCount: 0,
    gf3Sum,
  };
}

const mesh = initSkillMesh();

// ============================================================
// SKILL CONTENT LOADING
// ============================================================

async function loadSkillContent(skillName: string): Promise<string | null> {
  const paths = [
    `${process.env.HOME}/.claude/skills/${skillName}/SKILL.md`,
    `${process.cwd()}/asi/skills/${skillName}/SKILL.md`,
  ];
  
  for (const path of paths) {
    try {
      const file = Bun.file(path);
      if (await file.exists()) {
        return await file.text();
      }
    } catch {
      continue;
    }
  }
  return null;
}

// ============================================================
// HTTP HANDLERS
// ============================================================

function handleHealth(): Response {
  const tritCounts = { [-1]: 0, [0]: 0, [1]: 0 };
  mesh.skills.forEach(s => tritCounts[s.trit]++);
  
  return Response.json({
    status: "ok",
    node: mesh.nodeId,
    endpoint: `ocapn://tailscale/${mesh.nodeId}/captp:${mesh.port}`,
    skills: mesh.skills.length,
    peers: mesh.peers.size,
    invocations: mesh.invocationCount,
    gf3: {
      sum: mesh.gf3Sum,
      balanced: mesh.gf3Sum === 0,
      distribution: {
        "MINUS (−)": tritCounts[-1],
        "ERGODIC (○)": tritCounts[0],
        "PLUS (+)": tritCounts[1],
      },
    },
  });
}

function handleMesh(): Response {
  return Response.json({
    local: {
      node: mesh.nodeId,
      port: mesh.port,
      seed: mesh.seed,
    },
    skills: mesh.skills.map(s => ({
      index: s.index,
      name: s.name,
      trit: s.trit,
      tritSymbol: s.tritSymbol,
      color: s.color,
      sturdyref: s.sturdyref,
      uri: s.uri,
    })),
    gf3: {
      sum: mesh.gf3Sum,
      balanced: mesh.gf3Sum === 0,
      formula: "8×(0) + 9×(+1) + 9×(-1) = 0",
    },
    peers: Array.from(mesh.peers.values()),
  });
}

async function handleSkillRead(skillName: string): Promise<Response> {
  const skill = mesh.skills.find(s => s.name === skillName);
  if (!skill) {
    return Response.json({ error: `Skill not found: ${skillName}` }, { status: 404 });
  }
  
  const content = await loadSkillContent(skillName);
  
  return Response.json({
    skill: {
      ...skill,
      content: content || "(content not available)",
    },
  });
}

async function handleOCapN(req: Request): Promise<Response> {
  try {
    const body = await req.json() as {
      op: string;
      skill?: string;
      method?: string;
      args?: unknown[];
      from?: { node: string; ip: string };
      trit?: Trit;
    };
    
    console.log(`[OCapN] ${body.op}`, body.skill || "");
    
    mesh.invocationCount++;
    
    // Track GF(3) if trit provided
    if (body.trit !== undefined) {
      mesh.gf3Sum += body.trit;
    }
    
    // Register peer
    if (body.from?.node && body.from?.ip) {
      mesh.peers.set(`${body.from.node}@${body.from.ip}`, {
        node: body.from.node,
        ip: body.from.ip,
        skills: [],
        connectedAt: new Date().toISOString(),
      });
    }
    
    switch (body.op) {
      case "op:deliver": {
        // Invoke a skill
        if (!body.skill) {
          return Response.json({ error: "skill required for op:deliver" }, { status: 400 });
        }
        
        const skill = mesh.skills.find(s => s.name === body.skill);
        if (!skill) {
          return Response.json({ error: `Unknown skill: ${body.skill}` }, { status: 404 });
        }
        
        const content = await loadSkillContent(body.skill);
        
        // Response trit balances the request
        const responseTrit: Trit = ((-body.trit! || 0) % 3) as Trit;
        mesh.gf3Sum += responseTrit;
        
        return Response.json({
          op: "op:reply",
          skill: skill.name,
          result: {
            name: skill.name,
            trit: skill.trit,
            tritSymbol: skill.tritSymbol,
            color: skill.color,
            sturdyref: skill.sturdyref,
            content: content?.slice(0, 500) + "...",
          },
          gf3: {
            requestTrit: body.trit,
            responseTrit,
            meshSum: mesh.gf3Sum,
          },
          syrup: encode({
            tag: Symbol.for("skill-result"),
            fields: [skill.name, skill.trit, skill.color],
          } as SyrupRecord),
        });
      }
      
      case "op:list": {
        return Response.json({
          op: "op:reply",
          skills: mesh.skills.map(s => ({
            name: s.name,
            trit: s.trit,
            tritSymbol: s.tritSymbol,
            sturdyref: s.sturdyref,
          })),
        });
      }
      
      case "op:triad": {
        // Form a balanced triad
        const skills = body.args as string[] || [];
        if (skills.length !== 3) {
          return Response.json({ error: "triad requires exactly 3 skills" }, { status: 400 });
        }
        
        const triad = skills.map(name => mesh.skills.find(s => s.name === name)).filter(Boolean);
        if (triad.length !== 3) {
          return Response.json({ error: "one or more skills not found" }, { status: 404 });
        }
        
        const sum = triad.reduce((s, skill) => s + skill!.trit, 0);
        
        return Response.json({
          op: "op:reply",
          triad: triad.map(s => ({
            name: s!.name,
            trit: s!.trit,
            tritSymbol: s!.tritSymbol,
            color: s!.color,
          })),
          sum,
          balanced: sum % 3 === 0,
        });
      }
      
      default:
        return Response.json({
          error: `Unknown op: ${body.op}`,
          supportedOps: ["op:deliver", "op:list", "op:triad"],
        }, { status: 400 });
    }
  } catch (error) {
    console.error("[OCapN] Error:", error);
    return Response.json({ error: String(error) }, { status: 500 });
  }
}

// ============================================================
// SERVER
// ============================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  
  let response: Response;
  
  // Route handling
  if (url.pathname === "/" || url.pathname === "/health") {
    response = handleHealth();
  } else if (url.pathname === "/mesh") {
    response = handleMesh();
  } else if (url.pathname.startsWith("/skill/")) {
    const skillName = url.pathname.slice(7);
    response = await handleSkillRead(skillName);
  } else if (url.pathname === "/ocapn" && req.method === "POST") {
    response = await handleOCapN(req);
  } else {
    response = Response.json({ error: "Not Found" }, { status: 404 });
  }
  
  // Add CORS headers
  const headers = new Headers(response.headers);
  Object.entries(corsHeaders).forEach(([k, v]) => headers.set(k, v));
  
  return new Response(response.body, {
    status: response.status,
    headers,
  });
}

// ============================================================
// STARTUP
// ============================================================

const PORT = 9323;

// Print skill mesh summary
console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║            OCapN Skill Server — 26-Goblin Mesh                     ║
╠═══════════════════════════════════════════════════════════════════╣
║ Node:     ${mesh.nodeId.padEnd(54)}║
║ Port:     ${String(PORT).padEnd(54)}║
║ Seed:     ${String(mesh.seed).padEnd(54)}║
║ Skills:   ${String(mesh.skills.length).padEnd(54)}║
║ GF(3):    ${(mesh.gf3Sum === 0 ? "BALANCED ✓" : `SUM=${mesh.gf3Sum}`).padEnd(54)}║
╠═══════════════════════════════════════════════════════════════════╣
║ Skill Distribution:                                                ║
║   ERGODIC (○):  8 coordinators                                     ║
║   PLUS (+):     9 generators                                       ║
║   MINUS (−):    9 validators                                       ║
║   Formula:      8×0 + 9×(+1) + 9×(-1) = 0 ✓                        ║
╠═══════════════════════════════════════════════════════════════════╣
║ Endpoints:                                                         ║
║   GET  /              Health check                                 ║
║   GET  /mesh          Full skill mesh                              ║
║   GET  /skill/:name   Read skill content                           ║
║   POST /ocapn         OCapN operations                             ║
╚═══════════════════════════════════════════════════════════════════╝
`);

console.log("Skills by GF(3) trit:\n");

// Group by trit
const byTrit: Record<Trit, typeof mesh.skills> = { [-1]: [], [0]: [], [1]: [] };
mesh.skills.forEach(s => byTrit[s.trit].push(s));

console.log("○ ERGODIC (coordinators):");
byTrit[0].forEach(s => console.log(`  ${s.index.toString().padStart(2)}. ${s.name.padEnd(25)} ${s.color}`));

console.log("\n+ PLUS (generators):");
byTrit[1].forEach(s => console.log(`  ${s.index.toString().padStart(2)}. ${s.name.padEnd(25)} ${s.color}`));

console.log("\n− MINUS (validators):");
byTrit[-1].forEach(s => console.log(`  ${s.index.toString().padStart(2)}. ${s.name.padEnd(25)} ${s.color}`));

console.log(`\nListening on http://localhost:${PORT}`);
console.log(`Sturdyref: ocapn://tailscale/${mesh.nodeId}/captp:${PORT}\n`);

const server = Bun.serve({
  port: PORT,
  fetch: handleRequest,
});

console.log("Waiting for skill invocations...\n");
