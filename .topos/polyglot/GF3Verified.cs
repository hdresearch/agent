// GF(3) Verified Operations - C# Implementation
//
// Formally verified GF(3) field arithmetic with runtime assertions
// backed by Dafny proofs in verification/dafny/GF3Conservation.dfy
//
// Ported from vers-agent/src/math/gf3-verified.ts and Gay.jl/src/gf3_verified.jl
//
// Author: bmorphism (via Dafny formal verification)
// License: MIT

using System;
using System.Collections.Generic;
using System.Linq;

namespace GF3Verified
{
    // ============================================================================
    // GF(3) DATA TYPES
    // ============================================================================

    /// <summary>
    /// A trit (ternary digit) in GF(3).
    /// 
    /// Values:
    /// - MINUS (-1): Verification, validation, analysis
    /// - ERGODIC (0): Coordination, balance, infrastructure
    /// - PLUS (1): Generation, creation, synthesis
    /// </summary>
    public enum TritValue : sbyte
    {
        MINUS = -1,
        ERGODIC = 0,
        PLUS = 1
    }

    public static class GF3Operations
    {
        // ============================================================================
        // CORE OPERATIONS
        // ============================================================================

        /// <summary>
        /// Sum trits in GF(3) and normalize to {-1, 0, 1}
        /// </summary>
        public static TritValue SumGF3(IEnumerable<TritValue> trits)
        {
            int sum = trits.Sum(t => (int)t);
            int normalized = ((sum % 3) + 3) % 3;
            return normalized == 2 ? TritValue.MINUS : (TritValue)normalized;
        }

        /// <summary>
        /// Check if trits sum to 0 in GF(3)
        /// </summary>
        public static bool IsBalanced(IEnumerable<TritValue> trits)
        {
            return SumGF3(trits) == TritValue.ERGODIC;
        }

        /// <summary>
        /// Compute additive inverse in GF(3)
        /// </summary>
        public static TritValue NegateGF3(TritValue t)
        {
            if (t == TritValue.ERGODIC) return TritValue.ERGODIC;
            return (TritValue)(-(int)t);
        }

        /// <summary>
        /// Given 3 trits, compute the 4th balancing trit
        /// </summary>
        public static TritValue BalanceTriad((TritValue, TritValue, TritValue) triad)
        {
            var (a, b, c) = triad;
            var s = SumGF3(new[] { a, b, c });
            return NegateGF3(s);
        }

        // ============================================================================
        // VERIFIED OPERATIONS (Runtime Assertions)
        // ============================================================================

        /// <summary>
        /// Verified: BalanceTriad produces balanced quad
        /// 
        /// Theorem: For any triad T, IsBalanced(T + [BalanceTriad(T)])
        /// Proof: verification/dafny/GF3Conservation.dfy:BalanceTriadCorrectness
        /// </summary>
        public static TritValue VerifiedBalanceTriad((TritValue, TritValue, TritValue) triad)
        {
            var result = BalanceTriad(triad);
            var quad = new[] { triad.Item1, triad.Item2, triad.Item3, result };

            if (!IsBalanced(quad))
            {
                throw new InvalidOperationException(
                    "GF(3) conservation violated! Contradicts GF3Conservation.dfy:BalanceTriadCorrectness"
                );
            }

            return result;
        }

        /// <summary>
        /// Verified: Concatenating balanced sequences preserves balance
        /// 
        /// Theorem: Balanced(A) ∧ Balanced(B) → Balanced(A + B)
        /// Proof: verification/dafny/GF3Conservation.dfy:BalancedConcatenation
        /// </summary>
        public static List<TritValue> VerifiedConcatenateBalanced(
            List<TritValue> trits1,
            List<TritValue> trits2)
        {
            if (!IsBalanced(trits1))
                throw new ArgumentException("Precondition violated: trits1 not balanced");
            if (!IsBalanced(trits2))
                throw new ArgumentException("Precondition violated: trits2 not balanced");

            var result = new List<TritValue>(trits1.Count + trits2.Count);
            result.AddRange(trits1);
            result.AddRange(trits2);

            if (!IsBalanced(result))
            {
                throw new InvalidOperationException(
                    "GF(3) conservation violated! Contradicts GF3Conservation.dfy:BalancedConcatenation"
                );
            }

            return result;
        }

        /// <summary>
        /// Verified: GF(3) Conservation Theorem for quad sequences
        /// 
        /// Theorem: ∀i. Balanced(Q[i]) → Balanced(concat(Q))
        /// Proof: verification/dafny/GF3Conservation.dfy:GF3ConservationTheorem
        /// </summary>
        public static void VerifyQuadConservation(List<TritValue> trits)
        {
            if (trits.Count % 4 != 0)
                throw new ArgumentException($"Length {trits.Count} not multiple of 4");

            int numQuads = trits.Count / 4;
            for (int i = 0; i < numQuads; i++)
            {
                var quad = trits.GetRange(i * 4, 4);
                if (!IsBalanced(quad))
                    throw new ArgumentException($"Quad {i} not balanced");
            }

            if (!IsBalanced(trits))
            {
                throw new InvalidOperationException(
                    "GF(3) conservation violated! Contradicts GF3Conservation.dfy:GF3ConservationTheorem"
                );
            }
        }

        // ============================================================================
        // PROPERTY VERIFICATION
        // ============================================================================

        /// <summary>
        /// Test all 27 possible triads can be balanced (exhaustive proof)
        /// </summary>
        public static void VerifyAllTriads()
        {
            var allTrits = new[] { TritValue.MINUS, TritValue.ERGODIC, TritValue.PLUS };

            foreach (var a in allTrits)
            {
                foreach (var b in allTrits)
                {
                    foreach (var c in allTrits)
                    {
                        var triad = (a, b, c);
                        VerifiedBalanceTriad(triad);
                    }
                }
            }
        }
    }

    class Program
    {
        static void Main(string[] args)
        {
            try
            {
                GF3Operations.VerifyAllTriads();
                Console.WriteLine("✓ All 27 triads verified");
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"Verification failed: {ex.Message}");
                Environment.Exit(1);
            }
        }
    }
}
