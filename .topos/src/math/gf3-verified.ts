/**
 * GF(3) Operations with Runtime Verification
 * 
 * This module implements GF(3) field arithmetic with runtime assertions
 * backed by formal proofs in Dafny.
 * 
 * Formal Verification: See verification/GF3Conservation.dfy
 * 
 * Proven Properties:
 * - GF3SumAssociative: GF3Sum(a + b) == GF3Sum(a) + GF3Sum(b)
 * - BalancedConcatenation: Balanced(a) ∧ Balanced(b) ⟹ Balanced(a + b)
 * - BalanceTriadCorrectness: ∀ triad. Balanced(triad + [BalanceTriad(triad)])
 * - GF3ConservationTheorem: Quad-balanced sequences preserve balance
 * 
 * @module gf3-verified
 */

import { type Trit, sumGF3, isBalanced, balanceTriad, negateGF3 } from './gf3';

/**
 * Verified assertion that BalanceTriad produces a balanced quad.
 * 
 * **Formal Proof**: verification/GF3Conservation.dfy:BalanceTriadCorrectness
 * 
 * Theorem:
 *   ∀ triad: [Trit, Trit, Trit].
 *     IsBalanced(triad + [BalanceTriad(triad)])
 * 
 * Proof Strategy:
 *   Let sum = GF3Sum(triad)
 *   Let required = Normalize(-sum)
 *   Then: GF3Sum(triad + [TritFromInt(required)]) % 3
 *       = (sum + required) % 3
 *       = (sum + (-sum)) % 3
 *       = 0
 */
export function verifiedBalanceTriad(triad: [Trit, Trit, Trit]): Trit {
  const result = balanceTriad(triad);
  
  // Runtime assertion backed by formal proof
  const quad = [...triad, result] as [Trit, Trit, Trit, Trit];
  const balanced = isBalanced(quad);
  
  if (!balanced) {
    const sum = sumGF3(triad);
    const quadSum = sumGF3(quad);
    throw new Error(
      `BalanceTriad violated GF(3) conservation!\n` +
      `Triad: [${triad.join(', ')}] (sum=${sum})\n` +
      `Result: ${result}\n` +
      `Quad sum: ${quadSum} (should be 0 mod 3)\n` +
      `This contradicts the formal proof in GF3Conservation.dfy:BalanceTriadCorrectness`
    );
  }
  
  return result;
}

/**
 * Verified assertion that concatenating balanced sequences preserves balance.
 * 
 * **Formal Proof**: verification/GF3Conservation.dfy:BalancedConcatenation
 * 
 * Theorem:
 *   ∀ trits1, trits2: seq<Trit>.
 *     IsBalanced(trits1) ∧ IsBalanced(trits2) ⟹
 *     IsBalanced(trits1 + trits2)
 * 
 * Proof Strategy:
 *   GF3Sum(trits1 + trits2) % 3
 *     = (GF3Sum(trits1) + GF3Sum(trits2)) % 3  [by GF3SumAssociative]
 *     = (0 + 0) % 3                             [by hypothesis]
 *     = 0
 */
export function verifiedConcatenateBalanced(
  trits1: Trit[],
  trits2: Trit[]
): Trit[] {
  // Precondition check
  if (!isBalanced(trits1)) {
    throw new Error(
      `Precondition violated: trits1 is not balanced (sum=${sumGF3(trits1)} mod 3)`
    );
  }
  if (!isBalanced(trits2)) {
    throw new Error(
      `Precondition violated: trits2 is not balanced (sum=${sumGF3(trits2)} mod 3)`
    );
  }
  
  const result = [...trits1, ...trits2];
  
  // Postcondition verification
  if (!isBalanced(result)) {
    throw new Error(
      `BalancedConcatenation violated!\n` +
      `trits1 balanced: ${isBalanced(trits1)}\n` +
      `trits2 balanced: ${isBalanced(trits2)}\n` +
      `Result balanced: ${isBalanced(result)}\n` +
      `This contradicts GF3Conservation.dfy:BalancedConcatenation`
    );
  }
  
  return result;
}

/**
 * Verified assertion of GF(3) sum associativity.
 * 
 * **Formal Proof**: verification/GF3Conservation.dfy:GF3SumAssociative
 * 
 * Theorem:
 *   ∀ trits1, trits2: seq<Trit>.
 *     GF3Sum(trits1 + trits2) = GF3Sum(trits1) + GF3Sum(trits2)
 */
export function verifiedSumAssociativity(
  trits1: Trit[],
  trits2: Trit[]
): void {
  const concatenated = [...trits1, ...trits2];
  const sumConcatenated = sumGF3(concatenated);
  const sumParts = sumGF3(trits1) + sumGF3(trits2);
  
  if (sumConcatenated !== sumParts) {
    throw new Error(
      `GF3Sum associativity violated!\n` +
      `GF3Sum(trits1 + trits2) = ${sumConcatenated}\n` +
      `GF3Sum(trits1) + GF3Sum(trits2) = ${sumParts}\n` +
      `This contradicts GF3Conservation.dfy:GF3SumAssociative`
    );
  }
}

/**
 * Verified negation property.
 * 
 * **Formal Proof**: verification/GF3Conservation.dfy:NegateGF3
 * 
 * Theorem:
 *   ∀ t: Trit. TritValue(NegateGF3(t)) = -TritValue(t)
 */
export function verifiedNegation(t: Trit): Trit {
  const result = negateGF3(t);
  
  // Verify: t + (-t) = 0
  if (t + result !== 0) {
    throw new Error(
      `NegateGF3 violated!\n` +
      `t = ${t}, -t = ${result}\n` +
      `t + (-t) = ${t + result} (should be 0)\n` +
      `This contradicts GF3Conservation.dfy:NegateGF3`
    );
  }
  
  return result;
}

/**
 * Verified GF(3) Conservation Theorem for quad sequences.
 * 
 * **Formal Proof**: verification/GF3Conservation.dfy:GF3ConservationTheorem
 * 
 * Theorem:
 *   ∀ trits: seq<Trit>.
 *     |trits| % 4 = 0 ∧
 *     (∀ i. 0 ≤ i < |trits|/4 ⟹ IsQuadBalanced(trits[i*4..(i+1)*4])) ⟹
 *     IsBalanced(trits)
 * 
 * This is the core conservation law: if all quads in a sequence are balanced,
 * then the entire sequence is balanced.
 */
export function verifyQuadConservation(trits: Trit[]): void {
  // Check precondition: length must be multiple of 4
  if (trits.length % 4 !== 0) {
    throw new Error(
      `Precondition violated: sequence length (${trits.length}) is not a multiple of 4`
    );
  }
  
  // Check precondition: all quads must be balanced
  const numQuads = trits.length / 4;
  for (let i = 0; i < numQuads; i++) {
    const quad = trits.slice(i * 4, (i + 1) * 4);
    if (!isBalanced(quad)) {
      throw new Error(
        `Precondition violated: quad ${i} is not balanced\n` +
        `Quad: [${quad.join(', ')}]\n` +
        `Sum: ${sumGF3(quad)} mod 3`
      );
    }
  }
  
  // Verify postcondition: entire sequence is balanced
  if (!isBalanced(trits)) {
    throw new Error(
      `GF3ConservationTheorem violated!\n` +
      `All ${numQuads} quads are balanced, but sequence is not.\n` +
      `Total sum: ${sumGF3(trits)} mod 3\n` +
      `This contradicts GF3Conservation.dfy:GF3ConservationTheorem`
    );
  }
}

/**
 * Runtime verification wrapper for all GF(3) operations.
 * 
 * Enable with environment variable: GF3_VERIFY=true
 */
export const ENABLE_VERIFICATION = 
  process.env.GF3_VERIFY === 'true' || 
  process.env.NODE_ENV === 'test';

/**
 * Conditionally verified BalanceTriad (only in test mode).
 */
export function balanceTriadSafe(triad: [Trit, Trit, Trit]): Trit {
  return ENABLE_VERIFICATION
    ? verifiedBalanceTriad(triad)
    : balanceTriad(triad);
}

/**
 * Conditionally verified concatenation (only in test mode).
 */
export function concatenateBalancedSafe(
  trits1: Trit[],
  trits2: Trit[]
): Trit[] {
  if (ENABLE_VERIFICATION) {
    return verifiedConcatenateBalanced(trits1, trits2);
  } else {
    return [...trits1, ...trits2];
  }
}

/**
 * Export all verification functions for explicit use.
 */
export const Verified = {
  balanceTriad: verifiedBalanceTriad,
  concatenateBalanced: verifiedConcatenateBalanced,
  sumAssociativity: verifiedSumAssociativity,
  negation: verifiedNegation,
  quadConservation: verifyQuadConservation,
} as const;
