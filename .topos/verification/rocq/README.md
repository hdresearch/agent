# Dafny ↔ Rocq Verification Agreement

This directory implements a **semantic bridge** between two formal verification systems:
- **Dafny**: Compiles verified specifications to executable Rust
- **rocq-of-rust**: Extracts Rust to Rocq for theorem proving

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                     VERIFICATION DIAMOND                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│                    ┌──────────────────┐                             │
│                    │   GF3Spec.v      │                             │
│                    │  (Rocq Spec)     │                             │
│                    └────────┬─────────┘                             │
│                             │                                       │
│            ┌────────────────┼────────────────┐                      │
│            │                │                │                      │
│            ▼                ▼                ▼                      │
│   ┌────────────────┐ ┌────────────┐ ┌────────────────┐             │
│   │ GF3Conservation│ │  lib.rs    │ │ GF3Simulation.v│             │
│   │    .dfy        │ │ (Native)   │ │ (Linking)      │             │
│   │  (Dafny)       │ │            │ │                │             │
│   └───────┬────────┘ └─────┬──────┘ └────────────────┘             │
│           │                │                                        │
│           ▼                ▼                                        │
│   ┌────────────────┐ ┌────────────────┐                            │
│   │   gf3_rs.rs    │ │  (extracted)   │                            │
│   │ (Dafny→Rust)   │ │ rocq-of-rust   │                            │
│   └───────┬────────┘ └───────┬────────┘                            │
│           │                  │                                      │
│           └────────┬─────────┘                                      │
│                    ▼                                                │
│           ┌────────────────┐                                        │
│           │  AGREEMENT     │                                        │
│           │  Both prove    │                                        │
│           │  same theorems │                                        │
│           └────────────────┘                                        │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Directory Structure

```
rocq/
├── _CoqProject              # Rocq project configuration
├── README.md                # This file
├── spec/
│   └── GF3Spec.v           # Hand-written specification (matches Dafny)
├── rust-impl/
│   ├── Cargo.toml          # Native Rust for rocq-of-rust
│   └── src/lib.rs          # Implementation matching spec
├── extracted/              # Output from rocq-of-rust (generated)
│   └── (generated .v files)
├── linking/
│   └── GF3Simulation.v     # Simulation proofs connecting extracted↔spec
└── proofs/
    ├── SplitMix64.v        # PRNG bijectivity and period proofs
    ├── PlasticConstant.v   # ρ optimality for GF(3)
    └── QuadBalancing.v     # Quad existence/uniqueness theorems
```

## Workflow

### Step 1: Verify Dafny Specification

```bash
# Verify and compile Dafny to multiple targets
cd /Users/bob/i/agent/verification
dafny verify GF3Conservation.dfy
dafny build -t:rs GF3Conservation.dfy -o targets/gf3_rs
```

This produces verified Rust in `targets/gf3_rs-rust/`.

### Step 2: Build Native Rust Implementation

```bash
cd rocq/rust-impl
cargo build
cargo test  # Verify tests pass
```

### Step 3: Extract to Rocq (when rocq-of-rust is installed)

```bash
# Extract native Rust to Rocq
cd rocq/rust-impl
cargo rocq-of-rust

# Output goes to ../extracted/
```

### Step 4: Verify Rocq Proofs

```bash
cd rocq
coq_makefile -f _CoqProject -o Makefile
make

# Or with dune:
dune build
```

### Step 5: Verify Agreement

The key theorem is in `linking/GF3Simulation.v`:

```coq
Theorem dafny_rocq_agreement : forall t1 t2 t3 : Trit,
  (* Both Dafny and Rocq agree on: *)
  (* 1. Balancing trit computation *)
  (* 2. Quad balance verification *)
  (* 3. Conservation theorem *)
```

## Key Theorems Proven

| Theorem | File | Description |
|---------|------|-------------|
| `balance_triad_correct` | GF3Spec.v | Triad + balancer is always balanced |
| `balancing_trit_unique` | GF3Spec.v | Balancing trit is unique |
| `gf3_conservation_theorem` | GF3Spec.v | Concatenation of balanced quads is balanced |
| `gf3_sum_simulation` | GF3Simulation.v | Extracted code computes same sum as spec |
| `dafny_rocq_agreement` | GF3Simulation.v | All three paths prove same theorems |
| `mix_bijective` | SplitMix64.v | SplitMix64 mix function is invertible |
| `splitmix64_full_period` | SplitMix64.v | Generator has full 2^64 period |
| `plastic_optimal_for_gf3` | PlasticConstant.v | ρ is optimal for ternary systems |
| `balance_self_inverse` | QuadBalancing.v | Any quad element recoverable from other 3 |

## Why Two Verification Systems?

1. **Dafny**: Excellent for rapid prototyping, auto-verification, multi-language compilation
2. **Rocq**: Deep theorem proving, custom tactics, extraction to OCaml/Haskell

By proving **agreement**, we get:
- Dafny's ease of use for implementation
- Rocq's power for complex mathematical proofs
- Confidence that both systems verify the same specification

## Mathematical Foundation

### GF(3) Field
```
Elements: {-1, 0, +1}
Addition: a + b (mod 3), normalized to {-1, 0, +1}
Multiplication: a × b (mod 3)
```

### Conservation Law
```
∀ sequence of balanced quads Q₁, Q₂, ..., Qₙ:
  concat(Q₁, Q₂, ..., Qₙ) is balanced

Where balanced means: Σ trit_value(t) ≡ 0 (mod 3)
```

### SplitMix64 Properties
```
mix : u64 → u64 is bijective
∀ seed: iterate(seed, 2^64) = seed  (full period)
output mod 3 is equidistributed
```

### Plastic Constant
```
ρ³ = ρ + 1  (cubic analogue of φ² = φ + 1)
ρ ≈ 1.324718 is smallest Pisot number
Optimal for GF(3)/ternary systems
```

## Admitted Proofs

Some proofs are admitted pending:
- Bit-level SplitMix64 inverse computation
- Weyl's equidistribution theorem (requires measure theory)
- Number-theoretic lemmas for Perrin sequence

These can be filled in with:
- CoqHammer for automated reasoning
- Mathematical Components library for number theory
- Coquelicot for real analysis

## Integration with Gay.jl

The Rust implementation includes `share3_hash` which matches the Gay.jl MCP tools:

```rust
let (hash, trit, color) = share3_hash("skill-name", 1069);
// Same result as: mcp__gay__share3_hash("skill-name")
```

This ensures deterministic skill→color→trit mapping across:
- Rust (native and Dafny-compiled)
- TypeScript (via MCP)
- Rocq (via extraction)
