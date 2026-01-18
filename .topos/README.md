# .topos/ — Extensions & Experimental Context

This directory contains **extensions, experiments, and contextual artifacts** for vers-agent development. It's structured to help AI agents understand the design space and ongoing work.

## Directory Structure

```
.topos/
├── README.md           # This file - start here
├── AGENTS.md           # Agent-specific guidance for navigating .topos/
│
├── src/                # Extended source modules (not yet in core)
│   ├── fleet/          # Multi-VM fleet coordination
│   ├── math/           # GF(3) algebra, Galois connections
│   └── shared/         # Cross-module utilities
│
├── syrup/              # OCapN/Syrup protocol implementation
│   ├── syrup.ts        # Core Syrup serialization (Scheme s-expressions)
│   ├── syrup-sets.ts   # Set operations over Syrup
│   ├── syrup-skill-stream.ts  # Streaming skill capabilities
│   ├── ocapn-server.ts # OCapN capability server
│   ├── ocapn-skill-server.ts  # Skill-aware OCapN endpoints
│   ├── captp-session.ts       # CapTP session management
│   ├── skill-capability.ts    # Capability-based skill access
│   └── bicomodule-encoding.ts # Categorical encoding patterns
│
├── docs/               # Design documents & research
│   ├── ACP-*.md        # ACP protocol extensions
│   ├── CHELSEA-*.md    # Chelsea VM integration
│   ├── DAFNY-*.md      # Formal verification mapping
│   ├── GF3-*.md        # GF(3) triadic analysis
│   ├── MULTI-VM-*.md   # Fleet/multi-VM architecture
│   └── SECURITY-*.md   # Security analysis
│
├── experiments/        # Runnable experiments
│   ├── README.md       # Experiment index
│   ├── nbb/            # nbb (Node Babashka) ClojureScript experiments
│   └── run-experiment.sh
│
├── dockerfiles/        # Extended Docker configurations
│   ├── Dockerfile.chelsea      # Chelsea VM image
│   ├── Dockerfile.flox-chelsea # Flox + Chelsea
│   ├── Dockerfile.security     # Security-hardened image
│   └── captp-server.Dockerfile # CapTP server image
│
├── fleet-config/       # Fleet deployment configurations
│   ├── fleet-config.json       # Fleet topology
│   ├── docker-compose.fleet.yml
│   ├── captp-container-start.sh
│   └── chelsea-fleet.tar       # Pre-built fleet image
│
├── scripts/            # Auxiliary scripts
│   ├── build-chelsea-image.sh
│   ├── fleet-entrypoint.sh
│   └── setup-multi-vm-tui.sh
│
├── polyglot/           # Multi-runtime experiments
│   └── ...             # Hy, Clojure, Scheme interop
│
├── verification/       # Formal verification
│   └── dafny/          # Dafny proofs for protocol invariants
│
└── [status files]      # Deployment/test status snapshots
    ├── DEPLOYMENT-SUCCESS.md
    ├── FLEET-ARCHITECTURE.md
    ├── MOMENTUM.md
    └── ...
```

## For AI Agents

### Quick Orientation

1. **Core vers-agent** is in `src/` at repo root — CLI, ACP protocol, engines
2. **This directory (.topos/)** contains extensions not yet integrated into core
3. **Key extension points**:
   - `syrup/` → OCapN capability protocol (Spritely-compatible)
   - `src/fleet/` → Multi-VM coordination
   - `src/math/` → GF(3) algebraic structures

### When to Look Here

- Implementing capability-based features → `syrup/`
- Adding fleet/multi-VM support → `src/fleet/`, `docs/MULTI-VM-*.md`
- Understanding formal properties → `verification/`, `docs/DAFNY-*.md`
- Extending Docker deployment → `dockerfiles/`, `fleet-config/`

### Key Concepts

| Concept | Location | Description |
|---------|----------|-------------|
| **Syrup** | `syrup/syrup.ts` | S-expression serialization for OCapN |
| **CapTP** | `syrup/captp-session.ts` | Capability Transport Protocol sessions |
| **GF(3)** | `src/math/`, `docs/GF3-*.md` | Triadic algebra for skill balancing |
| **Chelsea** | `dockerfiles/`, `docs/CHELSEA-*.md` | Secure VM execution environment |
| **Fleet** | `src/fleet/`, `fleet-config/` | Multi-agent coordination |

## Status

These extensions are **experimental** — they work but aren't integrated into the main vers-agent build. The goal is progressive integration as patterns stabilize.

See `MOMENTUM.md` for current development priorities.
