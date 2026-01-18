# Galois Connection Guarantees at Interface Handoffs

## The Four Adjunctions

Each interface in User -> Flox -> Container -> RBD -> VM is a Galois connection.



Adjunction Law: α(x) ≤ y ⟺ x ≤ γ(y)

## Interface 1: Requirements ↔ Packages

α₁ = floor (minimal packages satisfying requirements)
γ₁ = ceiling (maximal requirements from packages)

Guarantees:
- Soundness: packages satisfy requirements
- Completeness: requirements have packages
- Minimality: smallest package set

## Interface 2: Manifest ↔ Closure

α₂ = flox build (manifest to Nix derivations)
γ₂ = nix query (closure to dependency tree)

Guarantees:
- Reproducibility: deterministic builds
- Closure: all transitive deps
- Isolation: no leaks

## Interface 3: Container ↔ RBD

α₃ = extract + mkfs + copy (OCI to block device)
γ₃ = mount + read (RBD to container metadata)

Guarantees:
- Content preservation
- Filesystem integrity
- Snapshot immutability

## Interface 4: RBD ↔ VM

α₄ = clone + spawn (base to running VM)
γ₄ = commit (VM state to snapshot)

Guarantees:
- Instant clone (CoW)
- State capture
- Isolation
- Reversibility

## GF(3) Conservation

Each interface preserves triadic balance:



## Full Adjoint String

The pipeline forms: floor ⊣ round ⊣ ceiling

α = α₄∘α₃∘α₂∘α₁ (User -> VM: max concretization)
γ = γ₁∘γ₂∘γ₃∘γ₄ (VM -> User: max abstraction)

This guarantees:
1. No information loss (units injective)
2. No phantom capabilities (counits surjective)
3. GF(3) conservation (triadic balance)
4. Lawful conversions (floor/ceiling semantics)

