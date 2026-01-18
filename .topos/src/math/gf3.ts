/**
 * GF(3) - Galois Field of order 3
 * 
 * Mathematical foundation for balanced ternary logic and skill quad formation.
 * 
 * ## Theory
 * 
 * GF(3) = {-1, 0, +1} under addition modulo 3:
 * - MINUS (-1): Verification, analysis, testing
 * - ERGODIC (0): Coordination, balance, infrastructure
 * - PLUS (+1): Generation, creation, synthesis
 * 
 * ## Conservation Law
 * 
 * For any valid quad of skills: Σ trits ≡ 0 (mod 3)
 * 
 * This ensures balanced agent coordination across MINUS/ERGODIC/PLUS modes.
 * 
 * @module gf3
 */

/**
 * A trit (ternary digit) in GF(3).
 * 
 * - `-1` (MINUS): Verification, validation, analysis
 * - `0` (ERGODIC): Coordination, balance, infrastructure
 * - `+1` (PLUS): Generation, creation, synthesis
 */
export type Trit = -1 | 0 | 1;

/**
 * Semantic labels for trits.
 */
export const TritLabel = {
  MINUS: -1 as Trit,
  ERGODIC: 0 as Trit,
  PLUS: 1 as Trit,
} as const;

/**
 * A skill quad: four skills with trits that sum to 0 (mod 3).
 */
export interface SkillQuad {
  skills: [string, string, string, string];
  trits: [Trit, Trit, Trit, Trit];
  balanced: boolean;
}

/**
 * Add two trits in GF(3).
 * 
 * @example
 * addGF3(1, 1)   // 0 (because 1 + 1 ≡ 2 ≡ -1 (mod 3) but normalized to [0,2])
 * addGF3(-1, 1)  // 0
 * addGF3(0, -1)  // -1
 */
export function addGF3(a: Trit, b: Trit): Trit {
  const sum = a + b;
  // Normalize to [-1, 0, 1]
  return ((sum % 3 + 3) % 3) === 2 ? -1 : (((sum % 3 + 3) % 3) as Trit);
}

/**
 * Compute the additive inverse (negation) in GF(3).
 * 
 * @example
 * negateGF3(1)   // -1
 * negateGF3(-1)  // 1
 * negateGF3(0)   // 0
 */
export function negateGF3(t: Trit): Trit {
  // Avoid JavaScript -0 issue
  if (t === 0) return 0;
  return (-t) as Trit;
}

/**
 * Sum multiple trits in GF(3).
 * 
 * @example
 * sumGF3([1, 1, 1])      // 0 (because 3 ≡ 0 (mod 3))
 * sumGF3([1, -1, 0])     // 0
 * sumGF3([1, 1, -1, -1]) // 0
 */
export function sumGF3(trits: Trit[]): Trit {
  const sum = trits.reduce((acc: number, t) => acc + t, 0);
  const normalized = ((sum % 3 + 3) % 3);
  return normalized === 2 ? -1 : (normalized as Trit);
}

/**
 * Check if a collection of trits is balanced (sums to 0 in GF(3)).
 * 
 * @example
 * isBalanced([1, -1, 0])        // true
 * isBalanced([1, 1, 1])         // true (3 ≡ 0)
 * isBalanced([1, 1, -1, -1])    // true
 * isBalanced([1, 1])            // false (2 ≡ -1)
 */
export function isBalanced(trits: Trit[]): boolean {
  return sumGF3(trits) === 0;
}

/**
 * Given a triad (3 trits), compute the balancing 4th trit.
 * 
 * @example
 * balanceTriad([1, 1, 1])    // 0 (because 1+1+1 = 3 ≡ 0, so need 0 more)
 * balanceTriad([1, 1, -1])   // -1 (because 1+1-1 = 1, so need -1)
 * balanceTriad([0, 0, 0])    // 0
 */
export function balanceTriad(triad: [Trit, Trit, Trit]): Trit {
  const sum = sumGF3(triad);
  return negateGF3(sum);
}

/**
 * Check if a quad (4 skills with trits) is balanced.
 * 
 * @example
 * isQuadBalanced([1, 1, -1, -1])  // true
 * isQuadBalanced([1, 1, 1, 0])    // true (3 + 0 = 3 ≡ 0)
 * isQuadBalanced([1, 1, 1, 1])    // false (4 ≡ 1)
 */
export function isQuadBalanced(quad: [Trit, Trit, Trit, Trit]): boolean {
  return isBalanced(quad);
}

/**
 * Create a balanced skill quad from 3 skills and their trits.
 * Computes the required 4th trit to balance the quad.
 * 
 * @param skills - Array of 3 skill names
 * @param trits - Array of 3 trits corresponding to the skills
 * @returns A balanced quad with the 4th skill set to null (to be filled by caller)
 * 
 * @example
 * const quad = createBalancedQuad(
 *   ['skill-a', 'skill-b', 'skill-c'],
 *   [1, 1, -1]
 * );
 * // quad.trits[3] === -1 (the balancing trit)
 */
export function createBalancedQuad(
  skills: [string, string, string],
  trits: [Trit, Trit, Trit]
): Omit<SkillQuad, 'skills'> & { skills: [string, string, string, null]; requiredTrit: Trit } {
  const requiredTrit = balanceTriad(trits);
  
  return {
    skills: [...skills, null] as [string, string, string, null],
    trits: [...trits, requiredTrit] as [Trit, Trit, Trit, Trit],
    balanced: true,
    requiredTrit,
  };
}

/**
 * Hash a string to a trit using a simple deterministic algorithm.
 * 
 * This provides a stable mapping from skill names to GF(3) values.
 * 
 * @example
 * stringToTrit('gay-mcp')           // 1
 * stringToTrit('acsets')            // -1
 * stringToTrit('geometric-algebra') // 0
 */
export function stringToTrit(str: string): Trit {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash & hash; // Convert to 32-bit integer
  }
  const trit = ((Math.abs(hash) % 3) - 1) as Trit;
  return trit;
}

/**
 * Find skills with a specific trit value from a pool.
 * 
 * @param skillPool - Array of skill names to search
 * @param targetTrit - The trit value to match
 * @param limit - Maximum number of results (default: 10)
 * 
 * @example
 * findSkillsWithTrit(['skill-a', 'skill-b', 'skill-c'], 1, 5)
 * // Returns up to 5 skills with trit value 1
 */
export function findSkillsWithTrit(
  skillPool: string[],
  targetTrit: Trit,
  limit: number = 10
): string[] {
  return skillPool
    .filter(skill => stringToTrit(skill) === targetTrit)
    .slice(0, limit);
}

/**
 * Suggest balancing skills for a triad from a skill pool.
 * 
 * @param triad - Array of 3 skill names
 * @param skillPool - Array of available skill names
 * @param limit - Maximum number of suggestions (default: 5)
 * 
 * @example
 * const suggestions = suggestBalancingSkills(
 *   ['skill-a', 'skill-b', 'skill-c'],
 *   ['skill-d', 'skill-e', 'skill-f', ...],
 *   5
 * );
 * // Returns up to 5 skills that would balance the triad
 */
export function suggestBalancingSkills(
  triad: [string, string, string],
  skillPool: string[],
  limit: number = 5
): Array<{ skill: string; trit: Trit; resultingQuad: SkillQuad }> {
  const trits = triad.map(stringToTrit) as [Trit, Trit, Trit];
  const requiredTrit = balanceTriad(trits);
  
  const candidates = findSkillsWithTrit(skillPool, requiredTrit, limit);
  
  return candidates.map(skill => ({
    skill,
    trit: requiredTrit,
    resultingQuad: {
      skills: [...triad, skill] as [string, string, string, string],
      trits: [...trits, requiredTrit] as [Trit, Trit, Trit, Trit],
      balanced: true,
    },
  }));
}

/**
 * Validate and analyze a skill quad.
 * 
 * @param skills - Array of 4 skill names
 * @returns Analysis including balance status and trit distribution
 * 
 * @example
 * const analysis = analyzeQuad(['skill-a', 'skill-b', 'skill-c', 'skill-d']);
 * console.log(analysis.balanced);        // true/false
 * console.log(analysis.tritDistribution); // { minus: 2, ergodic: 0, plus: 2 }
 */
export function analyzeQuad(skills: [string, string, string, string]): {
  skills: [string, string, string, string];
  trits: [Trit, Trit, Trit, Trit];
  sum: Trit;
  balanced: boolean;
  tritDistribution: {
    minus: number;
    ergodic: number;
    plus: number;
  };
} {
  const trits = skills.map(stringToTrit) as [Trit, Trit, Trit, Trit];
  const sum = sumGF3(trits);
  const balanced = sum === 0;
  
  const tritDistribution = {
    minus: trits.filter(t => t === -1).length,
    ergodic: trits.filter(t => t === 0).length,
    plus: trits.filter(t => t === 1).length,
  };
  
  return {
    skills,
    trits,
    sum,
    balanced,
    tritDistribution,
  };
}

/**
 * Convert a trit to its semantic label.
 * 
 * @example
 * tritToLabel(-1)  // 'MINUS'
 * tritToLabel(0)   // 'ERGODIC'
 * tritToLabel(1)   // 'PLUS'
 */
export function tritToLabel(trit: Trit): 'MINUS' | 'ERGODIC' | 'PLUS' {
  switch (trit) {
    case -1: return 'MINUS';
    case 0: return 'ERGODIC';
    case 1: return 'PLUS';
  }
}

/**
 * Convert a semantic label to a trit.
 * 
 * @example
 * labelToTrit('MINUS')    // -1
 * labelToTrit('ERGODIC')  // 0
 * labelToTrit('PLUS')     // 1
 */
export function labelToTrit(label: 'MINUS' | 'ERGODIC' | 'PLUS'): Trit {
  switch (label) {
    case 'MINUS': return -1;
    case 'ERGODIC': return 0;
    case 'PLUS': return 1;
  }
}
