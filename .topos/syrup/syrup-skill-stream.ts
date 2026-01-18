/**
 * Streaming Syrup Capability Increments for Skills
 * 
 * Each skill invocation generates a Syrup-encoded capability token
 * that can be streamed, accumulated, and verified. Skills earn
 * "capability increments" based on GF(3) balanced contributions.
 * 
 * ═══════════════════════════════════════════════════════════════
 * ARCHITECTURE
 * ═══════════════════════════════════════════════════════════════
 * 
 *   skill.md ──parse──▶ SkillDef ──invoke──▶ CapabilityIncrement
 *                                               │
 *                         ┌─────────────────────┘
 *                         ▼
 *   Stream: ──▶ [inc₁] ──▶ [inc₂] ──▶ [inc₃] ──▶ ...
 *                │         │         │
 *                └────┬────┴────┬────┘
 *                     ▼         ▼
 *              Syrup encode   GF(3) balance check
 *                     │
 *                     ▼
 *              skill://uri#RRGGBB (deterministic color)
 */

import { encode, decode, type SyrupValue, type SyrupRecord } from './syrup';
import { SieveSet, type MembershipWitness, directWitness, attenuate, type Trit, ALLOW, DENY, UNKNOWN } from './syrup-sets';

// ═══════════════════════════════════════════════════════════════
// SKILL DEFINITION (from skill.md)
// ═══════════════════════════════════════════════════════════════

export interface SkillDef {
  name: string;
  description: string;
  trit: Trit;           // GF(3) classification: PLUS, ERGODIC, MINUS
  color: string;        // Deterministic hex color from Gay.jl
  uri: string;          // skill://name#RRGGBB
  facets: symbol[];     // Allowed operations
  version: number;
}

/** Parse a skill.md file into SkillDef */
export function parseSkillMd(content: string, name: string): SkillDef {
  const lines = content.split('\n');
  
  let description = '';
  let trit: Trit = 0;
  let color = '#808080';
  
  for (const line of lines) {
    if (line.startsWith('# ')) {
      // Skip title, use provided name
    } else if (line.startsWith('trit:')) {
      const val = line.split(':')[1]?.trim();
      trit = val === '+1' || val === 'PLUS' ? 1 
           : val === '-1' || val === 'MINUS' ? -1 
           : 0;
    } else if (line.startsWith('color:')) {
      color = line.split(':')[1]?.trim() || color;
    } else if (line.startsWith('description:')) {
      description = line.split(':').slice(1).join(':').trim();
    } else if (!line.startsWith('#') && line.trim() && !description) {
      description = line.trim();
    }
  }
  
  return {
    name,
    description,
    trit,
    color,
    uri: `skill://${name}${color}`,
    facets: [Symbol.for('invoke'), Symbol.for('read')],
    version: 1,
  };
}

// ═══════════════════════════════════════════════════════════════
// CAPABILITY INCREMENT
// ═══════════════════════════════════════════════════════════════

/**
 * A CapabilityIncrement is a Syrup-encodable record representing
 * one "unit" of skill contribution. These stream through the system
 * and accumulate into capability balances.
 */
export interface CapabilityIncrement {
  /** Skill that generated this increment */
  skill: string;
  
  /** GF(3) trit value of contribution */
  trit: Trit;
  
  /** Deterministic color (from seed) */
  color: string;
  
  /** Monotonic sequence number */
  seq: number;
  
  /** Lamport timestamp */
  timestamp: number;
  
  /** Hash of previous increment (chain) */
  prev: string;
  
  /** Agent that invoked the skill */
  agent: string;
  
  /** Optional payload */
  payload?: SyrupValue;
}

/** Encode a CapabilityIncrement to Syrup */
export function encodeIncrement(inc: CapabilityIncrement): string {
  const record: SyrupRecord = {
    tag: Symbol.for('cap-inc'),
    fields: [
      inc.skill,
      inc.trit,
      inc.color,
      inc.seq,
      inc.timestamp,
      inc.prev,
      inc.agent,
      inc.payload ?? null,
    ],
  };
  return encode(record);
}

/** Decode a CapabilityIncrement from Syrup */
export function decodeIncrement(syrup: string): CapabilityIncrement {
  const decoded = decode(syrup);
  
  if (typeof decoded !== 'object' || decoded === null || 
      !('tag' in decoded) || decoded.tag !== Symbol.for('cap-inc')) {
    throw new Error('Invalid capability increment');
  }
  
  const [skill, trit, color, seq, timestamp, prev, agent, payload] = decoded.fields;
  
  return {
    skill: skill as string,
    trit: trit as Trit,
    color: color as string,
    seq: seq as number,
    timestamp: timestamp as number,
    prev: prev as string,
    agent: agent as string,
    payload: payload as SyrupValue | undefined,
  };
}

// ═══════════════════════════════════════════════════════════════
// SKILL STREAM
// ═══════════════════════════════════════════════════════════════

/**
 * SkillStream: Async generator that yields capability increments
 * as skills are invoked. Maintains GF(3) balance across the stream.
 */
export class SkillStream {
  private seq = 0;
  private prevHash = '0'.repeat(64);
  private balance: Trit = 0;
  private history: CapabilityIncrement[] = [];
  
  constructor(
    private agent: string,
    private colorFn: (skill: string, index: number) => string = () => '#808080'
  ) {}
  
  /** Generate next increment for a skill invocation */
  next(skill: SkillDef, payload?: SyrupValue): CapabilityIncrement {
    this.seq++;
    
    const inc: CapabilityIncrement = {
      skill: skill.name,
      trit: skill.trit,
      color: this.colorFn(skill.name, this.seq),
      seq: this.seq,
      timestamp: Date.now(),
      prev: this.prevHash,
      agent: this.agent,
      payload,
    };
    
    // Update chain
    const encoded = encodeIncrement(inc);
    this.prevHash = simpleHash(encoded);
    
    // Update GF(3) balance
    this.balance = ((this.balance + inc.trit + 3) % 3 - 1) as Trit;
    
    this.history.push(inc);
    return inc;
  }
  
  /** Get current GF(3) balance */
  getBalance(): Trit {
    return this.balance;
  }
  
  /** Check if stream is balanced (sum ≡ 0 mod 3) */
  isBalanced(): boolean {
    return this.balance === 0;
  }
  
  /** Get skills needed to balance */
  needsToBalance(): Trit {
    // What trit value do we need to add to get to 0?
    return ((-this.balance + 3) % 3 - 1) as Trit;
  }
  
  /** Get full history as Syrup-encoded list */
  toSyrup(): string {
    const records = this.history.map(inc => decode(encodeIncrement(inc)));
    return encode(records);
  }
  
  /** Async iterator for streaming */
  async *stream(
    skills: AsyncIterable<{ skill: SkillDef; payload?: SyrupValue }>
  ): AsyncGenerator<CapabilityIncrement> {
    for await (const { skill, payload } of skills) {
      yield this.next(skill, payload);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// SKILL CAPABILITY SET
// ═══════════════════════════════════════════════════════════════

/**
 * Accumulates capability increments into a SieveSet.
 * Each skill becomes a member with witnessed provenance.
 */
export class SkillCapabilitySet {
  private set = new SieveSet<string>();
  private increments: CapabilityIncrement[] = [];
  
  /** Add an increment, granting/updating capability for that skill */
  addIncrement(inc: CapabilityIncrement): void {
    const witness: MembershipWitness = {
      trit: inc.trit === 0 ? UNKNOWN : inc.trit > 0 ? ALLOW : DENY,
      grantor: inc.agent,
      timestamp: inc.timestamp,
      sieve: [inc.agent],
      expiry: 0,
      facets: [Symbol.for('invoke')],
    };
    
    this.set.add(inc.skill, witness);
    this.increments.push(inc);
  }
  
  /** Get capability status for a skill */
  getCapability(skill: string): Trit {
    return this.set.has(skill);
  }
  
  /** Get all skills with ALLOW status */
  getAllowedSkills(): string[] {
    return [...this.set.allowed()];
  }
  
  /** Get GF(3) balance of all increments */
  getBalance(): Trit {
    let sum = 0;
    for (const inc of this.increments) {
      sum += inc.trit;
    }
    return ((sum % 3 + 3) % 3 - 1) as Trit;
  }
  
  /** Export as Syrup */
  toSyrup(): string {
    return this.set.toSyrup();
  }
}

// ═══════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════

/** Simple hash for chaining (not cryptographic) */
function simpleHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(16, '0');
}

/** Generate deterministic color from skill name (placeholder for Gay.jl) */
function hashColor(skill: string, index: number): string {
  const hash = simpleHash(skill + index);
  return '#' + hash.slice(0, 6).toUpperCase();
}

// ═══════════════════════════════════════════════════════════════
// DEMO
// ═══════════════════════════════════════════════════════════════

if (import.meta.main) {
  console.log('═══ Streaming Syrup Skill Capabilities ═══\n');
  
  // Define some skills with GF(3) trits
  const skills: SkillDef[] = [
    { name: 'sheaf-cohomology', description: 'Cohomological computations', trit: 1, color: '#E67F86', uri: 'skill://sheaf-cohomology#E67F86', facets: [Symbol.for('invoke')], version: 1 },
    { name: 'datalog-fixpoint', description: 'Fixpoint computation', trit: 0, color: '#64F86C', uri: 'skill://datalog-fixpoint#64F86C', facets: [Symbol.for('invoke')], version: 1 },
    { name: 'bdd-verification', description: 'BDD-based verification', trit: -1, color: '#6C8FF8', uri: 'skill://bdd-verification#6C8FF8', facets: [Symbol.for('invoke')], version: 1 },
  ];
  
  // Create a skill stream
  const stream = new SkillStream('claude-agent', hashColor);
  
  console.log('Skill invocations:\n');
  
  for (const skill of skills) {
    const inc = stream.next(skill, `Invoked ${skill.name}`);
    
    console.log(`  ${skill.name}`);
    console.log(`    trit: ${inc.trit > 0 ? '+1' : inc.trit < 0 ? '-1' : '0'}`);
    console.log(`    color: ${inc.color}`);
    console.log(`    seq: ${inc.seq}`);
    console.log(`    balance: ${stream.getBalance()}`);
    console.log();
  }
  
  console.log(`Stream balanced: ${stream.isBalanced() ? '✓ YES' : '✗ NO (needs ' + stream.needsToBalance() + ')'}`);
  
  // Syrup encoding
  console.log('\n═══ Syrup Encoding ═══\n');
  
  const lastInc = stream.next(skills[0]);
  const encoded = encodeIncrement(lastInc);
  console.log('Single increment:');
  console.log(`  ${encoded.slice(0, 80)}...`);
  
  const decoded = decodeIncrement(encoded);
  console.log(`\nDecoded skill: ${decoded.skill}`);
  console.log(`Decoded trit: ${decoded.trit}`);
  
  // Full stream as Syrup
  console.log('\n═══ Full Stream ═══\n');
  console.log(`Stream length: ${encoded.length} bytes per increment`);
  console.log(`Total history: ${stream.toSyrup().length} bytes`);
  
  // Capability accumulation
  console.log('\n═══ Capability Accumulation ═══\n');
  
  const capSet = new SkillCapabilitySet();
  
  // Simulate a balanced quad
  const quad: SkillDef[] = [
    { name: 'acsets', trit: 1, description: '', color: '', uri: '', facets: [], version: 1 },
    { name: 'gay-mcp', trit: 1, description: '', color: '', uri: '', facets: [], version: 1 },
    { name: 'datalog', trit: 0, description: '', color: '', uri: '', facets: [], version: 1 },
    { name: 'verify', trit: -1, description: '', color: '', uri: '', facets: [], version: 1 },
  ];
  
  const quadStream = new SkillStream('agent');
  for (const skill of quad) {
    const inc = quadStream.next(skill);
    capSet.addIncrement(inc);
    console.log(`  +${skill.name} (trit=${skill.trit}) → balance=${quadStream.getBalance()}`);
  }
  
  console.log(`\nQuad balanced: ${quadStream.isBalanced() ? '✓' : '✗'}`);
  console.log(`Allowed skills: [${capSet.getAllowedSkills().join(', ')}]`);
  
  // skill.md example
  console.log('\n═══ skill.md Parsing ═══\n');
  
  const exampleSkillMd = `# gay-mcp

Deterministic color generation with GF(3) semantics.

trit: +1
color: #A855F7
description: Gay.jl MCP server for rainbow capabilities
`;
  
  const parsed = parseSkillMd(exampleSkillMd, 'gay-mcp');
  console.log('Parsed skill.md:');
  console.log(`  name: ${parsed.name}`);
  console.log(`  trit: ${parsed.trit}`);
  console.log(`  color: ${parsed.color}`);
  console.log(`  uri: ${parsed.uri}`);
  console.log(`  description: ${parsed.description}`);
}
