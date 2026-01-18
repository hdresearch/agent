/**
 * Subobject Classifier Sets for Syrup/CapTP
 * 
 * In topos theory, a subobject classifier Ω generalizes truth values.
 * Instead of just {true, false}, membership carries PROVENANCE:
 * - WHO granted access (capability source)
 * - WHEN it was granted (lamport timestamp)  
 * - WITH WHAT attenuation (facet/permission mask)
 * 
 * This enables:
 * - Capability revocation tracking
 * - Audit trails for access
 * - GF(3) balanced set operations
 * - Sieve-based membership (presheaf semantics)
 * 
 * ═══════════════════════════════════════════════════════════════
 * CATEGORICAL BACKGROUND
 * ═══════════════════════════════════════════════════════════════
 * 
 * In Set:     Ω = {⊥, ⊤}           (false, true)
 * In GF(3):   Ω = {−1, 0, +1}      (deny, unknown, allow)
 * In Sieve:   Ω = {sieves on C}    (sets of morphisms)
 * 
 * A "sieve" S on object c is a set of morphisms with codomain c,
 * closed under precomposition: if (f: b → c) ∈ S and g: a → b,
 * then (f ∘ g) ∈ S.
 * 
 * For capabilities: if Alice grants Bob access, and Bob delegates
 * to Carol, Carol's access is in the same sieve (attenuation path).
 */

import { encode, decode, type SyrupValue, type SyrupRecord } from './syrup';

// ═══════════════════════════════════════════════════════════════
// GF(3) TRIT TYPE
// ═══════════════════════════════════════════════════════════════

export type Trit = -1 | 0 | 1;

export const DENY: Trit = -1;      // Explicit denial
export const UNKNOWN: Trit = 0;    // No information (ergodic)
export const ALLOW: Trit = 1;      // Explicit grant

/** GF(3) addition (max semantics for capability union) */
export function tritAdd(a: Trit, b: Trit): Trit {
  // For capabilities, use MAX semantics: any ALLOW wins over UNKNOWN
  // But DENY is sticky (explicit revocation)
  if (a === DENY || b === DENY) return DENY;
  if (a === ALLOW || b === ALLOW) return ALLOW;
  return UNKNOWN;
}

/** GF(3) addition (strict mod-3 arithmetic) */
export function tritAddStrict(a: Trit, b: Trit): Trit {
  return ((a + b + 3) % 3 - 1) as Trit;  // Maps to {-1, 0, 1}
}

/** GF(3) multiplication */
export function tritMul(a: Trit, b: Trit): Trit {
  return (a * b) as Trit;
}

/** GF(3) negation */
export function tritNeg(a: Trit): Trit {
  return (-a) as Trit;
}

// ═══════════════════════════════════════════════════════════════
// MEMBERSHIP WITNESS (Subobject Classifier Element)
// ═══════════════════════════════════════════════════════════════

/**
 * A MembershipWitness is an element of our subobject classifier Ω.
 * It's not just "in or out" but carries the REASON for membership.
 */
export interface MembershipWitness {
  /** GF(3) access level: DENY, UNKNOWN, or ALLOW */
  trit: Trit;
  
  /** Who granted this access (capability source) */
  grantor: string;
  
  /** Lamport timestamp of grant */
  timestamp: number;
  
  /** Attenuation path: list of delegators from root */
  sieve: string[];
  
  /** Optional expiry (0 = never) */
  expiry: number;
  
  /** Facet mask: which operations are permitted */
  facets: symbol[];
}

/** Create a witness for direct access */
export function directWitness(grantor: string, facets: symbol[] = []): MembershipWitness {
  return {
    trit: ALLOW,
    grantor,
    timestamp: Date.now(),
    sieve: [grantor],
    expiry: 0,
    facets,
  };
}

/** Attenuate a witness (delegation) */
export function attenuate(
  witness: MembershipWitness,
  delegator: string,
  restrictFacets?: symbol[]
): MembershipWitness {
  return {
    ...witness,
    timestamp: Date.now(),
    sieve: [...witness.sieve, delegator],
    facets: restrictFacets 
      ? witness.facets.filter(f => restrictFacets.includes(f))
      : witness.facets,
  };
}

/** Revoke by negating the trit */
export function revoke(witness: MembershipWitness): MembershipWitness {
  return {
    ...witness,
    trit: DENY,
    timestamp: Date.now(),
  };
}

/** Check if witness is still valid */
export function isValid(witness: MembershipWitness): boolean {
  if (witness.trit !== ALLOW) return false;
  if (witness.expiry > 0 && Date.now() > witness.expiry) return false;
  return true;
}

// ═══════════════════════════════════════════════════════════════
// SIEVE SET (Subobject Classifier-based Set)
// ═══════════════════════════════════════════════════════════════

/**
 * SieveSet: A set where membership is witnessed by MembershipWitness.
 * 
 * Unlike a normal set:
 * - Elements can have multiple witnesses (from different grantors)
 * - Membership is resolved by combining witnesses via GF(3)
 * - The set maintains audit history
 * - Revocation propagates through sieves
 */
export class SieveSet<T> {
  private elements: Map<string, { value: T; witnesses: MembershipWitness[] }> = new Map();
  
  constructor(private keyFn: (v: T) => string = JSON.stringify) {}
  
  /** Add element with witness */
  add(value: T, witness: MembershipWitness): this {
    const key = this.keyFn(value);
    const existing = this.elements.get(key);
    
    if (existing) {
      existing.witnesses.push(witness);
    } else {
      this.elements.set(key, { value, witnesses: [witness] });
    }
    return this;
  }
  
  /** 
   * Check membership via GF(3) resolution.
   * Multiple witnesses combine: ALLOW + DENY = UNKNOWN
   */
  has(value: T): Trit {
    const key = this.keyFn(value);
    const entry = this.elements.get(key);
    
    if (!entry) return UNKNOWN;
    
    // Combine all valid witnesses via GF(3) addition
    let result: Trit = UNKNOWN;
    for (const w of entry.witnesses) {
      if (w.expiry === 0 || Date.now() <= w.expiry) {
        result = tritAdd(result, w.trit);
      }
    }
    return result;
  }
  
  /** Get the full membership witness(es) for an element */
  getWitnesses(value: T): MembershipWitness[] {
    const key = this.keyFn(value);
    return this.elements.get(key)?.witnesses ?? [];
  }
  
  /** Revoke all access granted by a specific grantor */
  revokeByGrantor(grantor: string): number {
    let count = 0;
    for (const [key, entry] of this.elements) {
      for (const w of entry.witnesses) {
        if (w.sieve.includes(grantor) && w.trit === ALLOW) {
          w.trit = DENY;
          w.timestamp = Date.now();
          count++;
        }
      }
    }
    return count;
  }
  
  /** Get all elements with ALLOW status */
  *allowed(): Generator<T> {
    for (const entry of this.elements.values()) {
      if (this.has(entry.value) === ALLOW) {
        yield entry.value;
      }
    }
  }
  
  /** Get all elements (regardless of status) */
  *all(): Generator<{ value: T; trit: Trit; witnesses: MembershipWitness[] }> {
    for (const entry of this.elements.values()) {
      yield {
        value: entry.value,
        trit: this.has(entry.value),
        witnesses: entry.witnesses,
      };
    }
  }
  
  /** Size (count of ALLOW elements) */
  get size(): number {
    let count = 0;
    for (const entry of this.elements.values()) {
      if (this.has(entry.value) === ALLOW) count++;
    }
    return count;
  }
  
  // ═══════════════════════════════════════════════════════════
  // SET OPERATIONS (GF(3) balanced)
  // ═══════════════════════════════════════════════════════════
  
  /** 
   * Union: combine witnesses from both sets.
   * If element is ALLOW in either, result combines via GF(3).
   */
  union(other: SieveSet<T>): SieveSet<T> {
    const result = new SieveSet<T>(this.keyFn);
    
    // Copy all from this
    for (const entry of this.elements.values()) {
      for (const w of entry.witnesses) {
        result.add(entry.value, w);
      }
    }
    
    // Add all from other
    for (const entry of other.elements.values()) {
      for (const w of entry.witnesses) {
        result.add(entry.value, w);
      }
    }
    
    return result;
  }
  
  /**
   * Intersection: element must be ALLOW in both.
   * Witnesses from both are combined.
   */
  intersection(other: SieveSet<T>): SieveSet<T> {
    const result = new SieveSet<T>(this.keyFn);
    
    for (const entry of this.elements.values()) {
      const thisStatus = this.has(entry.value);
      const otherStatus = other.has(entry.value);
      
      if (thisStatus === ALLOW && otherStatus === ALLOW) {
        // Combine witnesses from both
        for (const w of entry.witnesses) {
          result.add(entry.value, w);
        }
        for (const w of other.getWitnesses(entry.value)) {
          result.add(entry.value, w);
        }
      }
    }
    
    return result;
  }
  
  /**
   * Difference: elements in this but not (ALLOW) in other.
   */
  difference(other: SieveSet<T>): SieveSet<T> {
    const result = new SieveSet<T>(this.keyFn);
    
    for (const entry of this.elements.values()) {
      if (this.has(entry.value) === ALLOW && other.has(entry.value) !== ALLOW) {
        for (const w of entry.witnesses) {
          result.add(entry.value, w);
        }
      }
    }
    
    return result;
  }

  // ═══════════════════════════════════════════════════════════
  // SYRUP SERIALIZATION
  // ═══════════════════════════════════════════════════════════
  
  /** Encode to Syrup format */
  toSyrup(): string {
    const items: SyrupValue[] = [];
    
    for (const entry of this.elements.values()) {
      // Each entry is a record: <set-entry value witnesses...>
      const witnessRecords: SyrupValue[] = entry.witnesses.map(w => ({
        tag: Symbol.for('witness'),
        fields: [
          w.trit,
          w.grantor,
          w.timestamp,
          w.sieve,
          w.expiry,
          w.facets.map(f => f.description || ''),
        ],
      }));
      
      items.push({
        tag: Symbol.for('set-entry'),
        fields: [
          this.keyFn(entry.value),  // Serialized value
          witnessRecords,
        ],
      });
    }
    
    // Syrup set syntax: #<items>$
    // We use a record wrapper for our enhanced set
    const setRecord: SyrupRecord = {
      tag: Symbol.for('sieve-set'),
      fields: items,
    };
    
    return encode(setRecord);
  }
  
  /** Decode from Syrup (returns keys as strings) */
  static fromSyrup(syrup: string): SieveSet<string> {
    const decoded = decode(syrup);
    const result = new SieveSet<string>(x => x);
    
    if (typeof decoded === 'object' && decoded !== null && 
        'tag' in decoded && decoded.tag === Symbol.for('sieve-set')) {
      
      for (const entry of decoded.fields) {
        if (typeof entry === 'object' && entry !== null &&
            'tag' in entry && entry.tag === Symbol.for('set-entry')) {
          
          const [keyStr, witnessRecords] = entry.fields;
          
          if (typeof keyStr === 'string' && Array.isArray(witnessRecords)) {
            for (const wr of witnessRecords) {
              if (typeof wr === 'object' && wr !== null &&
                  'tag' in wr && wr.tag === Symbol.for('witness')) {
                const [trit, grantor, timestamp, sieve, expiry, facetStrs] = wr.fields;
                
                const witness: MembershipWitness = {
                  trit: trit as Trit,
                  grantor: grantor as string,
                  timestamp: timestamp as number,
                  sieve: sieve as string[],
                  expiry: expiry as number,
                  facets: (facetStrs as string[]).map(s => Symbol.for(s)),
                };
                
                result.add(keyStr, witness);
              }
            }
          }
        }
      }
    }
    
    return result;
  }
}

// ═══════════════════════════════════════════════════════════════
// SIMPLE SYRUP SET (Standard #...$ syntax)
// ═══════════════════════════════════════════════════════════════

/**
 * Standard Syrup set with canonical ordering.
 * Uses #<item1><item2>...$ syntax, sorted by encoded form.
 */
export class SyrupSet {
  private items: Map<string, SyrupValue> = new Map();
  
  constructor(values?: SyrupValue[]) {
    if (values) {
      for (const v of values) {
        this.add(v);
      }
    }
  }
  
  add(value: SyrupValue): this {
    const key = encode(value);
    this.items.set(key, value);
    return this;
  }
  
  has(value: SyrupValue): boolean {
    return this.items.has(encode(value));
  }
  
  delete(value: SyrupValue): boolean {
    return this.items.delete(encode(value));
  }
  
  get size(): number {
    return this.items.size;
  }
  
  *values(): Generator<SyrupValue> {
    for (const v of this.items.values()) {
      yield v;
    }
  }
  
  /** Encode with canonical ordering (sorted by encoded bytes) */
  encode(): string {
    const sortedKeys = [...this.items.keys()].sort();
    return `#${sortedKeys.join('')}$`;
  }
  
  /** Decode from Syrup set syntax */
  static decode(input: string): SyrupSet {
    if (!input.startsWith('#') || !input.endsWith('$')) {
      throw new Error('Invalid Syrup set syntax');
    }
    
    const result = new SyrupSet();
    const inner = input.slice(1, -1);
    
    // Parse items (reuse decoder logic)
    let pos = 0;
    while (pos < inner.length) {
      // Find the next complete value
      const remaining = inner.slice(pos);
      const value = decode(remaining);
      result.add(value);
      pos += encode(value).length;
    }
    
    return result;
  }
}

// ═══════════════════════════════════════════════════════════════
// CHARACTERISTIC MORPHISM (χ: A → Ω)
// ═══════════════════════════════════════════════════════════════

/**
 * The characteristic morphism of a subobject.
 * Given a SieveSet, returns the function A → Ω
 * that classifies which elements are "in" the subset.
 */
export function characteristic<T>(
  set: SieveSet<T>
): (value: T) => MembershipWitness | null {
  return (value: T) => {
    const witnesses = set.getWitnesses(value);
    if (witnesses.length === 0) return null;
    
    // Return the "strongest" witness (most recent ALLOW)
    const valid = witnesses
      .filter(isValid)
      .sort((a, b) => b.timestamp - a.timestamp);
    
    return valid[0] ?? null;
  };
}

/**
 * GF(3) characteristic: simplified to just the trit value
 */
export function gf3Characteristic<T>(set: SieveSet<T>): (value: T) => Trit {
  return (value: T) => set.has(value);
}

// ═══════════════════════════════════════════════════════════════
// DEMO
// ═══════════════════════════════════════════════════════════════

if (import.meta.main) {
  console.log('═══ Subobject Classifier Sets Demo ═══\n');
  
  // Create a SieveSet with capability witnesses
  const accessList = new SieveSet<string>();
  
  // Alice grants access to resource "file:secret.txt"
  const aliceWitness = directWitness('alice', [Symbol.for('read'), Symbol.for('write')]);
  accessList.add('file:secret.txt', aliceWitness);
  
  // Bob gets delegated access from Alice (attenuated to read-only)
  const bobWitness = attenuate(aliceWitness, 'bob', [Symbol.for('read')]);
  accessList.add('file:secret.txt', bobWitness);
  
  console.log('Initial access:');
  console.log(`  file:secret.txt → ${accessList.has('file:secret.txt')} (ALLOW=1)`);
  console.log(`  Witnesses: ${accessList.getWitnesses('file:secret.txt').length}`);
  
  // Check characteristic morphism
  const χ = characteristic(accessList);
  const witness = χ('file:secret.txt');
  console.log(`\nCharacteristic morphism χ('file:secret.txt'):`);
  console.log(`  grantor: ${witness?.grantor}`);
  console.log(`  sieve: [${witness?.sieve.join(' → ')}]`);
  console.log(`  facets: [${witness?.facets.map(f => f.description).join(', ')}]`);
  
  // Revoke Alice's access - this affects Bob too (sieve propagation)
  console.log('\nRevoking Alice\'s grants...');
  const revoked = accessList.revokeByGrantor('alice');
  console.log(`  Revoked ${revoked} witness(es)`);
  console.log(`  file:secret.txt → ${accessList.has('file:secret.txt')} (should be DENY=-1 or UNKNOWN=0)`);
  
  // Syrup serialization
  console.log('\n═══ Syrup Serialization ═══\n');
  
  const set2 = new SieveSet<string>();
  set2.add('cap:alice', directWitness('root'));
  set2.add('cap:bob', directWitness('root'));
  
  const syrup = set2.toSyrup();
  console.log('Encoded SieveSet:');
  console.log(`  ${syrup.slice(0, 80)}...`);
  
  // Standard Syrup set
  console.log('\n═══ Standard Syrup Set ═══\n');
  
  const simpleSet = new SyrupSet([
    Symbol.for('cat'),
    Symbol.for('dog'),
    'hello',
    42,
  ]);
  
  console.log('SyrupSet encoded (canonical order):');
  console.log(`  ${simpleSet.encode()}`);
  
  // GF(3) set operations
  console.log('\n═══ GF(3) Set Operations ═══\n');
  
  const setA = new SieveSet<string>();
  setA.add('x', directWitness('alice'));
  setA.add('y', directWitness('alice'));
  
  const setB = new SieveSet<string>();
  setB.add('y', directWitness('bob'));
  setB.add('z', directWitness('bob'));
  
  const union = setA.union(setB);
  const intersection = setA.intersection(setB);
  const difference = setA.difference(setB);
  
  console.log('A = {x, y} (granted by alice)');
  console.log('B = {y, z} (granted by bob)');
  console.log(`\nA ∪ B = {${[...union.allowed()].join(', ')}}`);
  console.log(`A ∩ B = {${[...intersection.allowed()].join(', ')}}`);
  console.log(`A \\ B = {${[...difference.allowed()].join(', ')}}`);
  
  // The union of 'y' has witnesses from BOTH alice and bob
  console.log('\nUnion witnesses for \'y\':');
  for (const w of union.getWitnesses('y')) {
    console.log(`  - granted by ${w.grantor}, sieve: [${w.sieve.join(' → ')}]`);
  }
}
