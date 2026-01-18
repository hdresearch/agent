# GF(3) Verified - Polyglot Implementation

Formally verified GF(3) field arithmetic with runtime assertions backed by Dafny proofs in `verification/GF3Conservation.dfy`.

**Supported languages:** TypeScript, Julia, Python, Go, C#, Java

## Formal Verification

All implementations derive from **proven Dafny theorems**:

1. **Associativity** (`GF3SumAssociative`): `Sum(A + B) = Sum(A) + Sum(B)`
2. **Concatenation** (`BalancedConcatenation`): `Balanced(A) ∧ Balanced(B) → Balanced(A ++ B)`
3. **Triad Balancing** (`BalanceTriadCorrectness`): `∀T. IsBalanced(T ++ [BalanceTriad(T)])`
4. **Conservation** (`GF3ConservationTheorem`): `∀i. Balanced(Q[i]) → Balanced(concat(Q))`

## Cross-Language API

All implementations provide identical APIs:

```
sumGF3(trits)              → Sum in GF(3), normalized to {-1, 0, 1}
isBalanced(trits)          → True if sum ≡ 0 (mod 3)
negateGF3(trit)            → Additive inverse
balanceTriad(a, b, c)      → 4th trit to form balanced quad

verifiedBalanceTriad(...)           → With Dafny proof backing
verifiedConcatenateBalanced(...)    → With Dafny proof backing
verifyQuadConservation(...)         → With Dafny proof backing
```

## Usage by Language

### TypeScript (Bun)

```bash
cd ../src/math
bun test gf3-verified.test.ts
```

```typescript
import { verifiedBalanceTriad, type Trit } from './gf3-verified';

const triad: [Trit, Trit, Trit] = [1, 1, -1];
const balancing = verifiedBalanceTriad(triad);
// [1, 1, -1, -1] → balanced
```

### Julia

```bash
cd ../Gay.jl
julia test/gf3_verified_test.jl
```

```julia
using GF3Verified

triad = (1, 1, -1)
balancing = verified_balance_triad(triad)
# (1, 1, -1, -1) → balanced
```

### Python

```bash
python3 gf3_verified.py
```

```python
from gf3_verified import verified_balance_triad

triad = (1, 1, -1)
balancing = verified_balance_triad(triad)
# [1, 1, -1, -1] → balanced
```

### Go

```bash
go run gf3_verified.go
```

```go
import "gf3_verified"

triad := [3]Trit{PLUS, PLUS, MINUS}
balancing, err := VerifiedBalanceTriad(triad)
// [1, 1, -1, -1] → balanced
```

### C#

```bash
dotnet script GF3Verified.cs
```

```csharp
using GF3Verified;

var triad = (TritValue.PLUS, TritValue.PLUS, TritValue.MINUS);
var balancing = GF3Operations.VerifiedBalanceTriad(triad);
// [1, 1, -1, -1] → balanced
```

### Java

```bash
javac GF3Verified.java
java GF3Verified
```

```java
import GF3Verified.Trit;

Trit balancing = GF3Verified.verifiedBalanceTriad(
    Trit.PLUS, Trit.PLUS, Trit.MINUS
);
// [1, 1, -1, -1] → balanced
```

## Running All Tests

```bash
./run_all_tests.sh
```

Expected output:

```
════════════════════════════════════════════════════════════════
GF(3) Cross-Language Verification Test Suite
Dafny-backed formal proofs in 6 languages
════════════════════════════════════════════════════════════════

TypeScript   ✓ PASS
Julia        ✓ PASS
Python       ✓ PASS
Go           ✓ PASS
C#           ✓ PASS
Java         ✓ PASS

════════════════════════════════════════════════════════════════
Results: 6 passed, 0 failed, 0 skipped
════════════════════════════════════════════════════════════════
```

## Semantic Meaning

Each trit represents a **role** in triadic coordination:

- **MINUS (-1)**: Verification, validation, analysis, testing
- **ERGODIC (0)**: Coordination, balance, infrastructure, mediation
- **PLUS (+1)**: Generation, creation, synthesis, building

Balanced quads form the basis of **GF(3)-conserved agent coordination** in vers-agent and Gay.jl.

## Files

```
polyglot/
├── README.md               # This file
├── run_all_tests.sh        # Cross-language test runner
├── gf3_verified.py         # Python implementation
├── gf3_verified.go         # Go implementation
├── GF3Verified.cs          # C# implementation
└── GF3Verified.java        # Java implementation

../src/math/
├── gf3-verified.ts         # TypeScript implementation
└── gf3-verified.test.ts    # TypeScript tests

../Gay.jl/src/
└── gf3_verified.jl         # Julia implementation

../Gay.jl/test/
└── gf3_verified_test.jl    # Julia tests

../verification/
└── GF3Conservation.dfy     # Dafny formal proofs
```

## Dafny Proof References

Every runtime assertion references the corresponding Dafny lemma:

```typescript
// TypeScript example
if (!isBalanced(quad)) {
  throw new Error(
    "Contradicts GF3Conservation.dfy:BalanceTriadCorrectness"
  );
}
```

This creates a **bidirectional bridge**:
- Dafny proves correctness mathematically (compile-time)
- Runtime assertions catch implementation bugs (runtime)

## Integration

These implementations are used in:

- **vers-agent**: Multi-VM fleet coordination via GF(3) trits
- **Gay.jl**: Deterministic color generation with GF(3) conservation
- **Agent-O-Rama**: Triadic agent orchestration (MINUS/ERGODIC/PLUS)

## License

MIT
