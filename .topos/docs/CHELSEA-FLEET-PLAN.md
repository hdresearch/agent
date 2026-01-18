# Chelsea Fleet: Remote ACP VM Management | #c778ea

> Local TUI managing a fleet of remote VMs via ngrok with hdresearch/chelsea base

## Architecture Vision

```
┌─────────────────────────────────────────────────────────────────┐
│  Local vers-agent TUI                                           │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Fleet Manager + GF(3) Trit Routing                       │  │
│  │  - Session multiplexing                                   │  │
│  │  - Health monitoring dashboard                            │  │
│  │  - /vm and /fleet commands                                │  │
│  └───────────────────────────────────────────────────────────┘  │
└────────────────┬─────────────────────────────────────────────────┘
                 │ HTTPS (ngrok tunnels)
     ┌───────────┼───────────┐
     ▼           ▼           ▼
┌─────────┐ ┌─────────┐ ┌─────────┐
│ crimson │ │ indigo  │ │  azure  │
│ α.ngrok │ │ β.ngrok │ │ γ.ngrok │
│ trit:-1 │ │ trit:0  │ │ trit:+1 │
│ MINUS   │ │ ERGODIC │ │  PLUS   │
└─────────┘ └─────────┘ └─────────┘
  Remote VM   Remote VM   Remote VM
  (chelsea)   (chelsea)   (chelsea)
```

## Desiderata

### D1: Minimal Base Image
- **Chelsea standard**: hdresearch/chelsea base with minimal footprint
- **Target**: <200MB compressed image
- **Components**: Alpine/distroless + Bun + Claude Code binary + ngrok

### D2: Remote ACP Integration
- Full JSON-RPC 2.0 over HTTPS via ngrok tunnels
- SSE event streaming for real-time updates
- Auth/Claim handshake with IP whitelisting

### D3: GF(3) Trit Conservation
- Fleet balancing via `(trit_α + trit_β + trit_γ) ≡ 0 (mod 3)`
- Color-coded routing: crimson(-1), indigo(0), azure(+1)
- Deterministic color assignment via Gay.jl splittable RNG

### D4: Session Persistence
- Per-VM session storage in ~/.vers-agent/
- Cross-session Claude context preservation
- Distributed session sync (future: CRDT-based)

### D5: Secure by Default
- ngrok traffic policy with IP whitelisting
- Non-root user execution
- Anthropic IP range allowlisting for Claude Remote MCP

## Invariants

### I1: GF(3) Sum Conservation
```
∀ fleet_triads: Σ(trits) ≡ 0 (mod 3)
```

### I2: Health Check Liveness
```
∀ vm ∈ fleet: healthcheck(vm) → response < 10s
```

### I3: Session Isolation
```
∀ vm_i, vm_j: sessions(vm_i) ∩ sessions(vm_j) = ∅
```

### I4: Auth Token Validity
```
∀ session: valid_anthropic_key(session) ∧ valid_claim_token(session)
```

### I5: Tunnel Stability
```
∀ vm: ngrok_tunnel(vm) → auto_reconnect on disconnect
```

## Package Manifest

### Required Packages (Chelsea Base Extension)

```dockerfile
# Base Runtime
- alpine:3.19           # Minimal Linux base (~5MB)
- bun:1.1+              # JavaScript runtime (~90MB)

# Core Binaries
- claude-code           # Claude Code standalone (~50MB)
- ngrok                 # Tunnel client (~20MB)

# System Utilities
- curl                  # HTTP client for healthchecks
- sqlite-libs           # Auth database
- ca-certificates       # TLS verification
- jq                    # JSON processing for tunnel info

# Optional (dev builds only)
- expect                # PTY testing
- git                   # Version control
```

### Environment Variables

```bash
# Required
ANTHROPIC_API_KEY       # Claude API authentication
NGROK_AUTHTOKEN         # ngrok tunnel authentication
PORT=9999               # ACP server port

# Optional
NGROK_DOMAIN            # Reserved ngrok domain (e.g., vers-alpha.ngrok.io)
VERS_VM_ID              # VM identifier (alpha/bravo/charlie)
VERS_VM_TRIT            # GF(3) trit assignment (-1/0/+1)
VERS_VM_COLOR           # Hex color code
VERS_DEBUG              # Enable debug logging
```

## Fleet Configuration Schema

```json
{
  "fleet": [
    {
      "id": "alpha",
      "name": "crimson", 
      "color": "#DC143C",
      "trit": -1,
      "role": "verification",
      "remote": {
        "ngrok_domain": "vers-alpha.ngrok.io",
        "healthcheck": "https://vers-alpha.ngrok.io/health"
      },
      "resources": {
        "ram": 2048,
        "vcpu": 2
      }
    },
    {
      "id": "bravo",
      "name": "indigo",
      "color": "#4B0082", 
      "trit": 0,
      "role": "coordination",
      "remote": {
        "ngrok_domain": "vers-bravo.ngrok.io",
        "healthcheck": "https://vers-bravo.ngrok.io/health"
      }
    },
    {
      "id": "charlie",
      "name": "azure",
      "color": "#007FFF",
      "trit": 1,
      "role": "generation",
      "remote": {
        "ngrok_domain": "vers-charlie.ngrok.io",
        "healthcheck": "https://vers-charlie.ngrok.io/health"
      }
    }
  ],
  "balancing": {
    "strategy": "gf3-trit",
    "routing": {
      "verification": ["alpha"],
      "coordination": ["bravo"],
      "generation": ["charlie"],
      "default": "round-robin"
    }
  }
}
```

## Dockerfile.chelsea (Draft)

```dockerfile
# syntax=docker/dockerfile:1
# Chelsea Fleet: Remote ACP-enabled vers-agent
# Extends hdresearch/chelsea base standard

ARG CHELSEA_VERSION=latest
FROM hdresearch/chelsea:${CHELSEA_VERSION} AS base

# ─── Build Stage ────────────────────────────────────────────────
FROM base AS build
WORKDIR /app
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile --production
COPY . .
RUN bun run build:bundle

# ─── Production Stage ───────────────────────────────────────────
FROM base AS production
WORKDIR /app

# Install ngrok for remote tunnel
RUN apk add --no-cache curl ca-certificates jq \
    && curl -fsSL https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-amd64.tgz \
    | tar xz -C /usr/local/bin

# Copy application bundle
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/src/tunnel/policy.yml ./config/policy.yml

# Non-root user (chelsea base should provide this)
USER vers

# Environment
ENV PORT=9999
ENV NODE_ENV=production
ENV VERS_AGENT_HOME=/home/vers/.vers-agent

EXPOSE 9999

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:${PORT}/health || exit 1

# Entrypoint handles ngrok tunnel + vers-agent server
COPY --chown=vers:vers scripts/fleet-entrypoint.sh /entrypoint.sh
CMD ["/entrypoint.sh"]
```

## Implementation Phases

### Phase 1: Chelsea Base Image
- [ ] Create hdresearch/chelsea base image spec
- [ ] Bun + Claude Code binary + sqlite
- [ ] Non-root user, minimal system packages
- [ ] Publish to Docker Hub/GHCR

### Phase 2: Fleet Extension Image
- [ ] Extend chelsea with ngrok integration
- [ ] Fleet entrypoint script with auto-reconnect
- [ ] VM identity injection via env vars
- [ ] Health check endpoints

### Phase 3: Local TUI Integration
- [ ] Remote HTTP ACP client in TUI
- [ ] Fleet discovery via ngrok API
- [ ] /vm switch for remote VMs
- [ ] Color-coded output per VM

### Phase 4: Multi-VM Orchestration
- [ ] Parallel session management
- [ ] GF(3) trit-based task routing
- [ ] Session state sync
- [ ] Fleet-wide health dashboard

## ngrok Traffic Policy (Remote)

```yaml
# policy.yml for remote fleet VMs
on_http_request:
  - actions:
      - type: restrict-ips
        config:
          enforce: true
          allow:
            # Local TUI controller IPs
            - ${CONTROLLER_IP}/32
            
            # Anthropic Claude Remote MCP
            - 160.79.104.0/23
            
            # HDR team static IPs
            - 32.132.92.198/32
            
            # GitHub Actions (for CI)
            - 140.82.112.0/20
```

## References

- [Dockerfile.lean](../Dockerfile.lean) - Current lean image (~165MB)
- [docker-compose.ngrok.yml](../docker-compose.ngrok.yml) - ngrok integration
- [MULTI-VM-USAGE.md](../MULTI-VM-USAGE.md) - Local multi-VM guide
- [fleet-config.json](../fleet-config.json) - Fleet configuration
- [Gay.jl](https://github.com/bmorphism/Gay.jl) - Deterministic color RNG
