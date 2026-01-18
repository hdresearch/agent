# Multi-VM TUI Usage Guide

This guide explains how to use the vers-agent TUI with multiple VMs, featuring Gay.jl color coding and GF(3) trit-based load balancing.

## Setup

### 1. Start the VMs

```bash
cd /Users/bob/i/agent
docker compose up -d
```

This starts 3 VMs:
- `agent-vers-alpha-1`
- `agent-vers-bravo-1`
- `agent-vers-charlie-1`

### 2. Configure Multi-VM Fleet

```bash
just vm-list  # Verify VMs are running
./scripts/setup-multi-vm-tui.sh
```

This creates `fleet-config.json` with Gay.jl color assignments:
- **crimson** (alpha): `#DC143C`, trit: `-1` (MINUS - verification/analysis)
- **indigo** (bravo): `#4B0082`, trit: `0` (ERGODIC - coordination/balance)
- **azure** (charlie): `#007FFF`, trit: `+1` (PLUS - generation/synthesis)

### 3. Launch the TUI

```bash
just cli
```

## Commands

### `/vm` - Multi-VM Management

#### View VM Status
```
/vm
/vm status
/vm list
```
Shows all VMs with Gay.jl color coding, trit assignments, and current status.

#### Switch VMs
```
/vm switch       # Rotate to next VM (round-robin)
/vm next         # Same as switch
/vm select alpha # Switch to specific VM by ID
```

#### Health Check
```
/vm health       # Check all VMs
/vm check        # Same as health
```

#### VM Information
```
/vm info alpha   # Show detailed info for specific VM
```

#### Session Statistics
```
/vm sessions     # Show session stats across all VMs
```

### `/fleet` - Fleet Management

The existing `/fleet` commands work with Docker-discovered VMs:

```
/fleet status    # Show fleet overview
/fleet refresh   # Refresh VM discovery
/fleet connect alpha # Connect to specific VM
/fleet health    # Check fleet health
```

## GF(3) Trit-Based Load Balancing

Each VM has a trit value from the Galois Field GF(3):

### Trit Values
- **-1 (MINUS)**: Verification, analysis, testing
- **0 (ERGODIC)**: Coordination, balance, infrastructure
- **+1 (PLUS)**: Generation, synthesis, creation

### Balancing Strategy

The fleet uses trit arithmetic for balanced distribution:
```
(trit_1 + trit_2 + trit_3) mod 3 = 0
```

This ensures complementary workload distribution across the 3-VM fleet.

## Gay.jl Color Coding

Colors are deterministically assigned based on Gay.jl's splittable RNG principles:

### Color Mappings
| VM      | Name    | Color     | Hex       | Trit | Role                    |
|---------|---------|-----------|-----------|------|-------------------------|
| alpha   | crimson | Red       | `#DC143C` | -1   | Verification/Analysis   |
| bravo   | indigo  | Purple    | `#4B0082` | 0    | Coordination/Balance    |
| charlie | azure   | Blue      | `#007FFF` | +1   | Generation/Synthesis    |

Colors appear in the TUI output for easy VM identification.

## ACP Integration

Each VM runs an ACP (Agent Communication Protocol) server over HTTP:

### Architecture
```
┌─────────────────┐
│   vers-agent    │  (local TUI)
│      CLI        │
└────────┬────────┘
         │
    ┌────┴────┐
    │  HTTP   │
    │  ACP    │
    └────┬────┘
         │
    ┌────┴──────────────┐
    │                   │
┌───▼────┐  ┌────▼───┐  ┌────▼─────┐
│ crimson│  │ indigo │  │  azure   │
│ (alpha)│  │(bravo) │  │(charlie) │
│ trit:-1│  │ trit:0 │  │ trit:+1  │
└────────┘  └────────┘  └──────────┘
```

### Session Management

- Sessions are tracked per VM
- Message counts and last-used timestamps
- Automatic session persistence
- Use `/vm sessions` to view stats

## Example Workflow

### 1. Start and Check VMs
```bash
just cli
/vm status
```

### 2. Check Health
```
/vm health
```
Output:
```
✓ crimson - online (45ms)
✓ indigo - online (38ms)
✓ azure - online (52ms)
```

### 3. Switch VMs
```
/vm switch
```
Output:
```
Switched to indigo (bravo)
URL: http://localhost:9999
Trit: 0 | Color: #4B0082
```

### 4. Send Prompts
Each prompt goes to the currently selected VM:
```
> Analyze this code for bugs    # Goes to current VM (e.g., crimson, trit: -1)
/vm switch
> Write a new feature           # Goes to next VM (e.g., azure, trit: +1)
```

### 5. View Session Stats
```
/vm sessions
```
Output:
```
VM Sessions:
──────────────────────────────────────────────────
crimson: 5 msgs, 120s ago
indigo: 3 msgs, 45s ago
azure: 7 msgs, 10s ago
```

## Advanced Usage

### Trit-Based Task Routing

Match task type to trit value for optimal distribution:

**Verification/Testing → crimson (trit: -1)**
```
/vm select alpha
> Run all tests and report failures
> Review this PR for security issues
```

**Coordination/Balance → indigo (trit: 0)**
```
/vm select bravo
> Refactor this module for better organization
> Set up CI/CD pipeline
```

**Generation/Creation → azure (trit: +1)**
```
/vm select charlie
> Implement new REST API endpoints
> Generate documentation from code
```

### Round-Robin Distribution

Use `/vm switch` between prompts for automatic load balancing:
```
> Task 1
/vm switch
> Task 2
/vm switch
> Task 3
/vm switch
```

This distributes tasks evenly across all 3 VMs.

## Troubleshooting

### VMs Not Showing Up
```bash
# Check Docker containers
just vm-list

# Verify they're healthy
docker ps --filter "name=vers-" --filter "status=running"

# Restart if needed
docker compose restart
```

### Fleet Config Not Found
```bash
# Regenerate config
./scripts/setup-multi-vm-tui.sh

# Verify it was created
cat fleet-config.json
```

### Connection Issues
```bash
# Check VM ports
just vm-list

# Test health endpoint
curl http://localhost:9999/health

# Check logs
just vm-logs agent-vers-alpha-1
```

### Type Errors
```bash
# Rebuild after changes
bun run build

# Check for type errors
bun run typecheck
```

## File Locations

- Fleet config: `/Users/bob/i/agent/fleet-config.json`
- Setup script: `/Users/bob/i/agent/scripts/setup-multi-vm-tui.sh`
- Multi-VM manager: `/Users/bob/i/agent/src/fleet/multi-vm-manager.ts`
- Command handlers: `/Users/bob/i/agent/src/cli/handlers/command-handlers.ts`

## Architecture Details

### Multi-VM Manager
`src/fleet/multi-vm-manager.ts` provides:
- Fleet configuration loading from JSON
- VM switching (round-robin, by ID)
- Health checking with latency measurement
- Session tracking per VM
- GF(3) trit-based load balancing
- ANSI color-coded terminal output

### Command Handlers
`src/cli/handlers/command-handlers.ts` implements:
- `/vm` command with 6 subcommands
- Gay.jl color formatting
- VM reconnection on switch
- Session statistics display
- Integration with existing `/fleet` commands

## References

- [Gay.jl](https://github.com/bmorphism/Gay.jl) - Splittable RNG with deterministic colors
- [GF(3) Field Theory](https://en.wikipedia.org/wiki/Finite_field) - Galois field mathematics
- [ACP Protocol](./docs/ACP.md) - Agent Communication Protocol
- [vers-agent](./README.md) - Main documentation

## Next Steps

1. **ngrok Integration**: Add ngrok tunnels for remote VM access
2. **Distributed Sessions**: Sync sessions across VMs via shared state
3. **Trit-Based Auto-Routing**: Automatically route tasks based on semantic analysis
4. **Color Visualization**: Enhanced terminal colors using Gay.jl RNG
5. **Performance Metrics**: Track and display per-VM performance stats
