# Agent Navigation Guide for .topos/

## Purpose

This directory extends vers-agent with experimental capabilities. Use this guide to find what you need quickly.

## Decision Tree

```
What are you trying to do?
│
├─ Implement capability-based security?
│  └─ Start: syrup/skill-capability.ts
│     Then: syrup/ocapn-server.ts, syrup/captp-session.ts
│
├─ Add multi-VM/fleet support?
│  └─ Start: src/fleet/fleet-manager.ts
│     Then: docs/MULTI-VM-USAGE.md, fleet-config/
│
├─ Understand the math/algebra?
│  └─ Start: docs/GF3-APPLICATION-ANALYSIS.md
│     Then: src/math/
│
├─ Deploy to Chelsea VMs?
│  └─ Start: docs/CHELSEA-FLEET-PLAN.md
│     Then: dockerfiles/Dockerfile.chelsea
│
├─ Add formal verification?
│  └─ Start: docs/DAFNY-INTEGRATION-SUMMARY.md
│     Then: verification/dafny/
│
└─ Run experiments?
   └─ Start: experiments/README.md
      Then: experiments/run-experiment.sh
```

## File Importance Ranking

### Critical (read first)
- `README.md` — Directory overview
- `syrup/syrup.ts` — Core serialization
- `src/fleet/fleet-manager.ts` — Fleet coordination
- `docs/INTEGRATION-PLAN.md` — How pieces fit together

### Important (read for context)
- `syrup/ocapn-server.ts` — OCapN implementation
- `docs/ACP-CLI-INTEGRATION.md` — CLI extension points
- `docs/COMPARATIVE-ANALYSIS.md` — Design decisions

### Reference (read as needed)
- `docs/DAFNY-*.md` — Formal verification details
- `dockerfiles/*` — Container configurations
- `fleet-config/*` — Deployment specifics

## Key Patterns

### Syrup Serialization
```typescript
// syrup/syrup.ts exports:
encode(value: SyrupValue): Uint8Array
decode(data: Uint8Array): SyrupValue
// Used for capability-secure message passing
```

### Fleet Coordination
```typescript
// src/fleet/fleet-manager.ts pattern:
class FleetManager {
  async spawnAgent(config: AgentConfig): Promise<AgentHandle>
  async broadcast(message: Message): Promise<void>
  async getHealth(): Promise<FleetHealth>
}
```

### GF(3) Trit Algebra
```typescript
// src/math/ pattern:
type Trit = -1 | 0 | 1  // MINUS | ERGODIC | PLUS
// Sum of balanced triad = 0 (mod 3)
```

## Integration Status

| Module | Status | Integration Path |
|--------|--------|------------------|
| `syrup/` | Working | Needs CapTP handshake completion |
| `src/fleet/` | Prototype | Blocked on VM provisioning API |
| `src/math/` | Complete | Ready for skill balancing |
| `verification/` | Partial | Dafny specs written, proofs WIP |

## Quick Commands

```bash
# Run syrup tests
bun test syrup

# Start local fleet (requires Docker)
docker-compose -f fleet-config/docker-compose.fleet.yml up

# Run nbb experiments
cd experiments && ./run-experiment.sh
```

## Related Core Files

These `.topos/` modules extend:
- `src/protocol/acp-types.ts` — ACP message types
- `src/agents/acp-client.ts` — Agent communication
- `src/cli/handlers/` — CLI command handlers
