/**
 * CapTP Color-Addressed Session Protocol
 *
 * Alternative to JSON-RPC ACP using:
 * - Sturdy refs as (seed, index) tuples
 * - Colors as capability addresses
 * - GF(3) trits as access levels
 * - Promise pipelining for reduced latency
 */

// ============================================================
// COLOR-ADDRESSABLE TYPES
// ============================================================

export type Trit = -1 | 0 | 1;
export type TritRole = 'MINUS' | 'ERGODIC' | 'PLUS';

export interface ColorRef {
  hex: string;           // e.g., "#E67F86"
  seed: number;          // e.g., 1069
  index: number;         // e.g., 1
  trit: Trit;            // access level
}

export interface SturdyRef {
  vatId: string;         // vat identifier (maps to seed)
  swissNum: string;      // swiss number (maps to index as hex)
  colorRef: ColorRef;    // deterministic color representation
}

// ============================================================
// CAPTP MESSAGE TYPES
// ============================================================

export type CapTPOp =
  | 'op:deliver-only'    // fire-and-forget
  | 'op:deliver'         // expects response
  | 'op:pick'            // select from promises
  | 'op:abort'           // cancel operation
  | 'op:listen'          // subscribe to updates
  | 'op:gc';             // garbage collection

export interface CapTPMessage {
  op: CapTPOp;
  sturdyRef: SturdyRef;
  args: unknown[];
  promise?: string;      // promise ID for pipelining
}

// ============================================================
// COLOR-ADDRESSED SESSION
// ============================================================

export interface ColorSession {
  colorRef: ColorRef;
  agentId: string;       // "claude.com" | "openai.com"
  createdAt: string;
  context: unknown[];    // session history
}

export interface SessionHandoff {
  from: ColorRef;
  to: ColorRef;
  reason: 'context_threshold' | 'task_complete' | 'explicit';
  introducedCaps: ColorRef[];  // capabilities shared during handoff
}

// ============================================================
// GAY.JL COLOR ALGORITHM (Golden Angle + SplitMix)
// ============================================================

const PHI = (1 + Math.sqrt(5)) / 2;  // Golden ratio φ ≈ 1.618
const GAMMA = 360 / PHI;              // Golden angle γ ≈ 222.492° (or 137.508° conjugate)

function splitmix64(seed: bigint): bigint {
  let z = seed + 0x9e3779b97f4a7c15n;
  z = (z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n;
  z = (z ^ (z >> 27n)) * 0x94d049bb133111ebn;
  return (z ^ (z >> 31n)) & 0xffffffffffffffffn;
}

// HSL to RGB conversion
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;

  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }

  return [r + m, g + m, b + m];
}

function colorAt(seed: number, index: number): ColorRef {
  // Use SplitMix to get deterministic variation from seed
  let state = BigInt(seed);
  for (let i = 0; i < index; i++) {
    state = splitmix64(state);
  }

  // Extract variation components from state
  const hueOffset = Number(state & 0xffffn) / 65535;
  const satVar = Number((state >> 16n) & 0xffn) / 255;
  const lumVar = Number((state >> 24n) & 0xffn) / 255;

  // Golden angle spiral for base hue, plus seed-derived offset
  const baseHue = (index * GAMMA + seed * 0.618) % 360;
  const hue = (baseHue + hueOffset * 30) % 360;  // ±15° variation
  const sat = 0.5 + satVar * 0.35;               // 0.5-0.85 saturation
  const lum = 0.45 + lumVar * 0.25;              // 0.45-0.70 lightness

  const [r, g, b] = hslToRgb(hue, sat, lum);

  const hex = '#' + [r, g, b].map(c =>
    Math.round(c * 255).toString(16).padStart(2, '0')
  ).join('').toUpperCase();

  // Trit from sum of RGB components mod 3
  const sum = Math.round(r * 255) + Math.round(g * 255) + Math.round(b * 255);
  const trit = ((sum % 3) - 1) as Trit;

  return { hex, seed, index, trit };
}

// ============================================================
// STURDY REF OPERATIONS
// ============================================================

export function createSturdyRef(seed: number, index: number): SturdyRef {
  const colorRef = colorAt(seed, index);
  return {
    vatId: `vat-${seed.toString(16)}`,
    swissNum: index.toString(16).padStart(8, '0'),
    colorRef,
  };
}

export function sturdyRefToColor(ref: SturdyRef): string {
  return ref.colorRef.hex;
}

export function colorToSturdyRef(hex: string, knownSeed: number, maxSearch = 1000): SturdyRef | null {
  // Abduction: find index that produces this color
  for (let i = 1; i <= maxSearch; i++) {
    const candidate = colorAt(knownSeed, i);
    if (candidate.hex === hex) {
      return createSturdyRef(knownSeed, i);
    }
  }
  return null;
}

// ============================================================
// SESSION OPERATIONS
// ============================================================

const CLAUDE_SEED = 1069;
const CODEX_SEED = 2069;

export function createClaudeSession(index: number): ColorSession {
  return {
    colorRef: colorAt(CLAUDE_SEED, index),
    agentId: 'claude.com',
    createdAt: new Date().toISOString(),
    context: [],
  };
}

export function createCodexSession(index: number): ColorSession {
  return {
    colorRef: colorAt(CODEX_SEED, index),
    agentId: 'openai.com',
    createdAt: new Date().toISOString(),
    context: [],
  };
}

export function handoffSession(
  from: ColorSession,
  toAgentId: string,
  toIndex: number
): SessionHandoff {
  const toSeed = toAgentId === 'claude.com' ? CLAUDE_SEED : CODEX_SEED;
  const toColorRef = colorAt(toSeed, toIndex);

  return {
    from: from.colorRef,
    to: toColorRef,
    reason: 'context_threshold',
    introducedCaps: [from.colorRef], // share the from capability
  };
}

// ============================================================
// CAPTP MESSAGE CONSTRUCTION
// ============================================================

export function deliverMessage(ref: SturdyRef, method: string, ...args: unknown[]): CapTPMessage {
  return {
    op: 'op:deliver',
    sturdyRef: ref,
    args: [method, ...args],
  };
}

export function pipelineMessage(
  promise: string,
  method: string,
  ...args: unknown[]
): CapTPMessage {
  // Pipeline: send to a promise before it resolves
  return {
    op: 'op:deliver',
    sturdyRef: { vatId: 'promise', swissNum: promise, colorRef: colorAt(0, 0) },
    args: [method, ...args],
    promise,
  };
}

// ============================================================
// GF(3) ACCESS CONTROL
// ============================================================

export function canAccess(requester: ColorRef, target: ColorRef): boolean {
  // PLUS can access anything
  // ERGODIC can access ERGODIC and MINUS
  // MINUS can only access MINUS
  if (requester.trit === 1) return true;
  if (requester.trit === 0) return target.trit <= 0;
  return target.trit === -1;
}

export function attenuate(cap: ColorRef, newTrit: Trit): ColorRef | null {
  // Can only attenuate (reduce access), never amplify
  if (newTrit > cap.trit) return null;
  return { ...cap, trit: newTrit };
}

// ============================================================
// DEMO
// ============================================================

if (import.meta.main) {
  console.log('═══ CapTP Color-Addressed Session Demo ═══\n');

  // Create Claude session
  const claudeSession = createClaudeSession(1);
  console.log('Claude Session:');
  console.log(`  Color: ${claudeSession.colorRef.hex}`);
  console.log(`  Seed: ${claudeSession.colorRef.seed}, Index: ${claudeSession.colorRef.index}`);
  console.log(`  Trit: ${claudeSession.colorRef.trit} (${['MINUS', 'ERGODIC', 'PLUS'][claudeSession.colorRef.trit + 1]})`);

  // Create Codex session
  const codexSession = createCodexSession(1);
  console.log('\nCodex Session:');
  console.log(`  Color: ${codexSession.colorRef.hex}`);
  console.log(`  Seed: ${codexSession.colorRef.seed}, Index: ${codexSession.colorRef.index}`);
  console.log(`  Trit: ${codexSession.colorRef.trit}`);

  // Handoff
  const handoff = handoffSession(claudeSession, 'openai.com', 1);
  console.log('\nHandoff:');
  console.log(`  From: ${handoff.from.hex} (Claude)`);
  console.log(`  To: ${handoff.to.hex} (Codex)`);
  console.log(`  Introduced: ${handoff.introducedCaps.map(c => c.hex).join(', ')}`);

  // CapTP message
  const sturdyRef = createSturdyRef(CLAUDE_SEED, 1);
  const msg = deliverMessage(sturdyRef, 'prompt', 'Implement GF(3) checker');
  console.log('\nCapTP Message:');
  console.log(`  Op: ${msg.op}`);
  console.log(`  Color: ${msg.sturdyRef.colorRef.hex}`);
  console.log(`  Args: ${JSON.stringify(msg.args)}`);

  // Abduction demo
  console.log('\nAbduction (color → sturdy ref):');
  const recovered = colorToSturdyRef(claudeSession.colorRef.hex, CLAUDE_SEED);
  if (recovered) {
    console.log(`  Input: ${claudeSession.colorRef.hex}`);
    console.log(`  Recovered: seed=${recovered.colorRef.seed}, index=${recovered.colorRef.index}`);
    console.log(`  Match: ${recovered.colorRef.hex === claudeSession.colorRef.hex}`);
  }

  // Access control
  console.log('\nGF(3) Access Control:');
  const plusCap = colorAt(1069, 1);  // assume PLUS
  const minusCap = colorAt(1069, 3); // assume different trit
  console.log(`  PLUS can access MINUS: ${canAccess({ ...plusCap, trit: 1 }, { ...minusCap, trit: -1 })}`);
  console.log(`  MINUS can access PLUS: ${canAccess({ ...minusCap, trit: -1 }, { ...plusCap, trit: 1 })}`);
}
