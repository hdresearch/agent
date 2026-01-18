# Dafny → TypeScript Formal Verification Mapping

## Overview

This document maps formally verified Dafny proofs to runtime TypeScript assertions, enabling **verified correctness** in production code.

**Core Idea**: Dafny proves properties mathematically → TypeScript enforces them at runtime.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Dafny Source Code (.dfy)                                       │
│  - Formal specifications (requires/ensures)                     │
│  - Mathematical proofs (lemmas/theorems)                        │
│  - Verified functions and methods                               │
└────────────────┬────────────────────────────────────────────────┘
                 │
                 │ Manual translation (currently)
                 │ Future: Dafny compiler to JS
                 │
                 ▼
┌─────────────────────────────────────────────────────────────────┐
│  TypeScript Implementation (src/math/gf3.ts)                    │
│  - Core operations (sumGF3, balanceTriad, etc.)                 │
│  - No runtime checks (performance)                              │
└────────────────┬────────────────────────────────────────────────┘
                 │
                 │ Wrapped by
                 │
                 ▼
┌─────────────────────────────────────────────────────────────────┐
│  Verified TypeScript Wrapper (src/math/gf3-verified.ts)         │
│  - Runtime assertions referencing Dafny proofs                  │
│  - Precondition/postcondition checks                            │
│  - Enabled in test mode (GF3_VERIFY=true)                       │
└─────────────────────────────────────────────────────────────────┘
```

---

## File Structure

| File | Purpose |
|------|---------|
| `verification/GF3Conservation.dfy` | Formal Dafny specification and proofs |
| `src/math/gf3.ts` | Core TypeScript implementation (unverified, fast) |
| `src/math/gf3-verified.ts` | Verified wrapper with runtime checks |
| `src/math/gf3-verified.test.ts` | Test suite validating Dafny theorems |
| `docs/DAFNY-TYPESCRIPT-MAPPING.md` | This document |

---

## Theorem-to-Code Mappings

### 1. **BalanceTriadCorrectness**

**Dafny Theorem** (`verification/GF3Conservation.dfy:BalanceTriadCorrectness`):
```dafny
lemma BalanceTriadCorrectness(triad: seq<Trit>)
  requires |triad| == 3
  ensures IsBalanced(triad + [BalanceTriad(triad)])
{
  var balancing := BalanceTriad(triad);
  var sum := GF3Sum(triad);
  var required := Normalize(-sum);
  
  calc {
    GF3Sum(triad + [balancing]) % 3;
    == { GF3SumAssociative(triad, [balancing]); }
    (GF3Sum(triad) + GF3Sum([balancing])) % 3;
    ==
    (sum + TritValue(balancing)) % 3;
    ==
    (sum + required) % 3;
    ==
    (sum + (-sum)) % 3;
    ==
    0;
  }
}
```

**TypeScript Implementation** (`src/math/gf3.ts:balanceTriad`):
```typescript
export function balanceTriad(triad: [Trit, Trit, Trit]): Trit {
  const sum = sumGF3(triad);
  return negateGF3(sum);
}
```

**Verified Wrapper** (`src/math/gf3-verified.ts:verifiedBalanceTriad`):
```typescript
export function verifiedBalanceTriad(triad: [Trit, Trit, Trit]): Trit {
  const result = balanceTriad(triad);
  
  // Runtime assertion backed by Dafny proof
  const quad = [...triad, result] as [Trit, Trit, Trit, Trit];
  if (!isBalanced(quad)) {
    throw new Error(
      `BalanceTriad violated GF(3) conservation!\n` +
      `This contradicts GF3Conservation.dfy:BalanceTriadCorrectness`
    );
  }
  
  return result;
}
```

**Test Validation** (`src/math/gf3-verified.test.ts`):
```typescript
test("balances [1, 1, -1] correctly", () => {
  const triad: [Trit, Trit, Trit] = [1, 1, -1];
  const result = verifiedBalanceTriad(triad);
  // Should never throw (proven in Dafny)
  expect(result).toBe(-1);
});
```

---

### 2. **GF3SumAssociative**

**Dafny Theorem** (`verification/GF3Conservation.dfy:GF3SumAssociative`):
```dafny
lemma GF3SumAssociative(trits1: seq<Trit>, trits2: seq<Trit>)
  ensures GF3Sum(trits1 + trits2) == GF3Sum(trits1) + GF3Sum(trits2)
{
  if |trits1| == 0 {
    assert trits1 + trits2 == trits2;
  } else {
    calc {
      GF3Sum(trits1 + trits2);
      ==
      TritValue((trits1 + trits2)[0]) + GF3Sum((trits1 + trits2)[1..]);
      ==
      TritValue(trits1[0]) + GF3Sum(trits1[1..] + trits2);
      == { GF3SumAssociative(trits1[1..], trits2); }
      TritValue(trits1[0]) + GF3Sum(trits1[1..]) + GF3Sum(trits2);
      ==
      GF3Sum(trits1) + GF3Sum(trits2);
    }
  }
}
```

**TypeScript Implementation** (`src/math/gf3.ts:sumGF3`):
```typescript
export function sumGF3(trits: Trit[]): Trit {
  const sum = trits.reduce((acc, t) => acc + t, 0);
  const normalized = ((sum % 3 + 3) % 3);
  return normalized === 2 ? -1 : (normalized as Trit);
}
```

**Verified Wrapper** (`src/math/gf3-verified.ts:verifiedSumAssociativity`):
```typescript
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
      `This contradicts GF3Conservation.dfy:GF3SumAssociative`
    );
  }
}
```

---

### 3. **BalancedConcatenation**

**Dafny Theorem** (`verification/GF3Conservation.dfy:BalancedConcatenation`):
```dafny
lemma BalancedConcatenation(trits1: seq<Trit>, trits2: seq<Trit>)
  requires IsBalanced(trits1)
  requires IsBalanced(trits2)
  ensures IsBalanced(trits1 + trits2)
{
  calc {
    GF3Sum(trits1 + trits2) % 3;
    == { GF3SumAssociative(trits1, trits2); }
    (GF3Sum(trits1) + GF3Sum(trits2)) % 3;
    ==
    (0 + 0) % 3;
    ==
    0;
  }
}
```

**Verified Wrapper** (`src/math/gf3-verified.ts:verifiedConcatenateBalanced`):
```typescript
export function verifiedConcatenateBalanced(
  trits1: Trit[],
  trits2: Trit[]
): Trit[] {
  // Precondition check
  if (!isBalanced(trits1)) {
    throw new Error('Precondition violated: trits1 is not balanced');
  }
  if (!isBalanced(trits2)) {
    throw new Error('Precondition violated: trits2 is not balanced');
  }
  
  const result = [...trits1, ...trits2];
  
  // Postcondition verification (should never fail if preconditions hold)
  if (!isBalanced(result)) {
    throw new Error(
      `BalancedConcatenation violated!\n` +
      `This contradicts GF3Conservation.dfy:BalancedConcatenation`
    );
  }
  
  return result;
}
```

---

### 4. **GF3ConservationTheorem**

**Dafny Theorem** (`verification/GF3Conservation.dfy:GF3ConservationTheorem`):
```dafny
lemma GF3ConservationTheorem(trits: seq<Trit>)
  requires |trits| % 4 == 0
  requires forall i :: 0 <= i < |trits| / 4 ==> 
             IsQuadBalanced(trits[i*4..(i+1)*4])
  ensures IsBalanced(trits)
{
  if |trits| == 0 {
    assert IsBalanced(trits);
  } else if |trits| == 4 {
    assert IsBalanced(trits);
  } else {
    var first_quad := trits[0..4];
    var rest := trits[4..];
    
    assert IsQuadBalanced(first_quad);
    
    GF3ConservationTheorem(rest);  // Recursive proof
    assert IsBalanced(rest);
    
    BalancedConcatenation(first_quad, rest);
    assert IsBalanced(trits);
  }
}
```

**Verified Wrapper** (`src/math/gf3-verified.ts:verifyQuadConservation`):
```typescript
export function verifyQuadConservation(trits: Trit[]): void {
  // Check precondition: length is multiple of 4
  if (trits.length % 4 !== 0) {
    throw new Error('Precondition violated: length not multiple of 4');
  }
  
  // Check precondition: all quads are balanced
  const numQuads = trits.length / 4;
  for (let i = 0; i < numQuads; i++) {
    const quad = trits.slice(i * 4, (i + 1) * 4);
    if (!isBalanced(quad)) {
      throw new Error(`Precondition violated: quad ${i} not balanced`);
    }
  }
  
  // Verify postcondition (should always hold by theorem)
  if (!isBalanced(trits)) {
    throw new Error(
      `GF3ConservationTheorem violated!\n` +
      `This contradicts GF3Conservation.dfy:GF3ConservationTheorem`
    );
  }
}
```

---

## Type Mappings

| Dafny Type | TypeScript Type | Notes |
|------------|-----------------|-------|
| `datatype Trit = Minus \| Zero \| Plus` | `type Trit = -1 \| 0 \| 1` | Literal types |
| `seq<Trit>` | `Trit[]` | Array |
| `nat` | `number` | Non-negative integers |
| `int` | `number` | All integers |
| `bool` | `boolean` | Boolean |
| `predicate P(x)` | `function isP(x): boolean` | Predicate → boolean function |
| `function F(x): T` | `function f(x): T` | Pure function |
| `method M(x) returns (y)` | `function m(x): y` | Method → function |
| `lemma L(x)` | *(proof only, no runtime code)* | Verified at compile time |

---

## Proof Strategy: Dafny → TypeScript

### Step 1: Write Dafny Specification

```dafny
function BalanceTriad(triad: seq<Trit>): Trit
  requires |triad| == 3
  ensures IsBalanced(triad + [BalanceTriad(triad)])
{
  var sum := GF3Sum(triad);
  var required := Normalize(-sum);
  TritFromInt(required)
}
```

### Step 2: Prove Correctness in Dafny

```dafny
lemma BalanceTriadCorrectness(triad: seq<Trit>)
  requires |triad| == 3
  ensures IsBalanced(triad + [BalanceTriad(triad)])
{
  // Dafny verifier proves this automatically or with manual calc
}
```

### Step 3: Implement in TypeScript

```typescript
// src/math/gf3.ts
export function balanceTriad(triad: [Trit, Trit, Trit]): Trit {
  const sum = sumGF3(triad);
  return negateGF3(sum);
}
```

### Step 4: Add Verified Wrapper

```typescript
// src/math/gf3-verified.ts
export function verifiedBalanceTriad(triad: [Trit, Trit, Trit]): Trit {
  const result = balanceTriad(triad);
  
  // Runtime check backed by Dafny proof
  const quad = [...triad, result];
  if (!isBalanced(quad)) {
    throw new Error('Contradicts GF3Conservation.dfy:BalanceTriadCorrectness');
  }
  
  return result;
}
```

### Step 5: Write Property-Based Tests

```typescript
// src/math/gf3-verified.test.ts
test("any triad can be balanced (Dafny QuadBalancingWorks)", () => {
  for (let i = 0; i < 100; i++) {
    const triad = generateRandomTriad();
    
    // Should never throw (proven by Dafny)
    expect(() => verifiedBalanceTriad(triad)).not.toThrow();
  }
});
```

---

## Benefits of This Approach

### 1. **Correctness Guarantee**

Dafny proofs ensure mathematical correctness. If TypeScript implementation is faithful, runtime assertions should **never** fail.

### 2. **Regression Detection**

If a refactoring breaks the implementation, verified tests will catch it:

```typescript
// Bad refactoring
export function balanceTriad(triad: [Trit, Trit, Trit]): Trit {
  return 1;  // Always return +1 (WRONG!)
}

// Test will fail:
// Error: BalanceTriad violated GF(3) conservation!
// This contradicts GF3Conservation.dfy:BalanceTriadCorrectness
```

### 3. **Documentation**

Error messages reference Dafny proofs, making bugs traceable to formal specifications.

### 4. **Selective Verification**

Runtime checks are **opt-in** (enabled via `GF3_VERIFY=true`), so production code remains fast.

---

## Usage Patterns

### Development Mode (Verified)

```bash
GF3_VERIFY=true bun run dev
```

All GF(3) operations use verified wrappers. Performance cost acceptable during development.

### Production Mode (Fast)

```bash
bun run start
```

Uses unverified implementations directly. Verified during testing, trusted in production.

### Test Mode (Always Verified)

```typescript
// src/math/gf3-verified.ts
export const ENABLE_VERIFICATION = 
  process.env.GF3_VERIFY === 'true' || 
  process.env.NODE_ENV === 'test';
```

Tests automatically enable verification to catch regressions.

---

## Future Work

### 1. **Dafny Compiler to JavaScript**

Once Dafny's JavaScript compiler stabilizes:

```bash
dafny /compile:3 /compileTarget:js verification/GF3Conservation.dfy
```

This would generate **verified JavaScript** directly, eliminating manual translation.

### 2. **Automated Mapping**

Generate TypeScript wrappers automatically from Dafny specifications:

```bash
dafny-to-typescript verification/GF3Conservation.dfy > src/math/gf3-verified.ts
```

### 3. **Runtime Proof Checking**

For critical paths, include actual proof terms at runtime:

```typescript
export function verifiedBalanceTriadWithProof(
  triad: [Trit, Trit, Trit]
): { result: Trit; proof: ProofTerm } {
  const result = balanceTriad(triad);
  const proof = constructBalanceProof(triad, result);
  
  if (!verifyProof(proof)) {
    throw new Error('Proof verification failed!');
  }
  
  return { result, proof };
}
```

---

## Comparison: Dafny vs Other Verification Tools

| Tool | Approach | TypeScript Support | Maturity |
|------|----------|-------------------|----------|
| **Dafny** | SMT-based theorem proving | JS compilation (experimental) | High |
| **Coq** | Proof assistant | Via extraction to OCaml → JS | Very High |
| **Liquid Haskell** | Refinement types | Via GHC → JS | Medium |
| **F\*** | Dependent types | Via extraction to JS | High |
| **TLA+** | Model checking | No (spec only) | Very High |

**Why Dafny for vers-agent**:
- SMT solver automation (less manual proof)
- Imperative style (closer to TypeScript)
- JavaScript target exists (even if experimental)
- Active development by Microsoft Research

---

## Related Documentation

- `verification/GF3Conservation.dfy` - Full Dafny specification
- `src/math/gf3.ts` - Core implementation
- `src/math/gf3-verified.ts` - Verified wrappers
- `src/math/gf3-verified.test.ts` - Test suite
- `docs/AGENTS.md` - Homoiconic EDN protocol (uses GF(3))
- `/Users/bob/ies/Gay.jl/verification/dafny/` - Original Dafny proofs from Gay.jl

---

## Conclusion

By mapping Dafny proofs to TypeScript assertions, we achieve:

1. **Formal verification** during development
2. **Runtime safety** in testing
3. **Performance** in production
4. **Traceability** from implementation to proof

This is a **pragmatic approach** to formal methods: verify mathematically, enforce selectively, trust conditionally.

**Next step**: Extend this pattern to other modules (triadic orchestration, EDN protocol, agent coordination).
