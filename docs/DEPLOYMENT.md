# vers-agent Deployment Architecture | #c778ea

> Lean, mean, ACP-only VM deployment via ngrok tunnel with vers.ngrok.io domain

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│  Client (Claude Desktop, CLI, Web)                          │
└────────────────┬────────────────────────────────────────────┘
                 │ HTTPS
                 ▼
┌─────────────────────────────────────────────────────────────┐
│  vers.ngrok.io (ngrok domain)                                │
│  - IP whitelisting (policy.yml)                              │
│  - TLS termination                                           │
│  - Traffic routing                                           │
└────────────────┬────────────────────────────────────────────┘
                 │ HTTP (internal)
                 ▼
┌─────────────────────────────────────────────────────────────┐
│  vers VM (minimal ACP server)                                │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  vers-agent server (port 9999)                        │  │
│  │  - ACP JSON-RPC (/rpc)                                │  │
│  │  - SSE events (/events)                               │  │
│  │  - Health check (/health)                             │  │
│  │  - Auth/Claim protocol                                │  │
│  └───────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  ngrok client (local tunnel)                          │  │
│  │  - Connects to vers.ngrok.io                          │  │
│  │  - Applies policy.yml                                 │  │
│  └───────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Claude Code (subprocess)                             │  │
│  │  - Spawned by agent-manager                           │  │
│  │  - Session management                                 │  │
│  │  - Tool execution                                     │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## The Lean VM Image

### What Gets Cut

**Current bloat in Dockerfile:**
```dockerfile
# Too much: Node.js, npm, global installs, expect, dev tools
RUN apt-get update && apt-get install -y curl expect \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g @anthropic-ai/claude-code @zed-industries/claude-code-acp
```

**Lean alternative:**
- Bun runtime only (no Node.js)
- Claude Code standalone binary (no npm)
- No dev tools (expect, curl can stay for health checks)
- Minimal base image (Alpine or distroless)

### Essential Components Only

```
vers VM minimal stack:
├── OS: Alpine Linux 3.19 (~5MB base)
├── Runtime: Bun 1.1.42 (~90MB)
├── Binary: Claude Code standalone (~50MB)
├── Binary: ngrok standalone (~20MB)
├── Config: policy.yml, .env
└── Data: ~/.vers-agent/ (auth.db, tokens.json, logs/)

Total: ~165MB vs current ~800MB+ Docker image
```

## Flox Environment Specification

Create `flox.toml` for reproducible deployment:

```toml
# flox.toml - vers-agent deployment environment
version = 1

[install]
# Bun runtime
bun.pkg-path = "bun"

# Claude Code (from binary release)
claude-code.pkg-path = "claude-code"
claude-code.systems = ["x86_64-linux", "aarch64-linux"]

# ngrok (from binary release)
ngrok.pkg-path = "ngrok"
ngrok.systems = ["x86_64-linux", "aarch64-linux"]

# Minimal system utilities
curl.pkg-path = "curl"
jq.pkg-path = "jq"
sqlite.pkg-path = "sqlite"

[profile.default.hook.on-activate]
# Set up environment
script = """
export VERS_AGENT_HOME="$HOME/.vers-agent"
export CLAUDE_CODE_EXECUTABLE="$(which claude-code)"
export NGROK_CONFIG="$VERS_AGENT_HOME/ngrok.yml"
mkdir -p "$VERS_AGENT_HOME/logs"
echo "vers-agent environment ready"
"""

[profile.default.vars]
PORT = "9999"
NODE_ENV = "production"
VERS_DEBUG = "false"
```

## VM Deployment Workflow

### 1. Build Lean Image

```bash
# New Dockerfile.lean
FROM alpine:3.19 AS base
RUN apk add --no-cache curl sqlite-libs

# Install Bun
FROM base AS bun
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:$PATH"

# Build stage
FROM bun AS build
WORKDIR /app
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile --production
COPY . .
RUN bun run build:bundle

# Production stage  
FROM bun AS production
WORKDIR /app

# Copy built artifacts
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./

# Install Claude Code binary (replace npm install)
RUN curl -fsSL https://storage.googleapis.com/anthropic-releases/claude-code/latest/claude-code-linux-x64 \
    -o /usr/local/bin/claude-code \
    && chmod +x /usr/local/bin/claude-code

# Install ngrok binary
RUN curl -fsSL https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-amd64.tgz \
    | tar xz -C /usr/local/bin

# Create vers user
RUN adduser -D -s /bin/sh vers \
    && mkdir -p /home/vers/.vers-agent \
    && chown -R vers:vers /home/vers /app

USER vers
ENV HOME=/home/vers
ENV CLAUDE_CODE_EXECUTABLE=/usr/local/bin/claude-code
ENV PORT=9999

EXPOSE 9999

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD curl -f http://localhost:9999/health || exit 1

# Start both ngrok and vers-agent
CMD ["sh", "-c", "ngrok http $PORT --config /home/vers/.vers-agent/ngrok.yml & bun run dist/index.js --server"]
```

### 2. ngrok Configuration

Create `~/.vers-agent/ngrok.yml`:

```yaml
version: "2"
authtoken: ${NGROK_AUTHTOKEN}
tunnels:
  vers-acp:
    proto: http
    addr: 9999
    domain: vers.ngrok.io  # Custom domain from ngrok dashboard
    traffic_policy_file: /app/src/tunnel/policy.yml
    inspect: false  # Disable web UI in production
    log: stdout
    log_level: info
```

### 3. Policy Configuration

Update `src/tunnel/policy.yml`:

```yaml
# ngrok Traffic Policy for vers.ngrok.io
on_http_request:
  - actions:
      # IP whitelist (Anthropic + HDR team)
      - type: restrict-ips
        config:
          enforce: true
          allow:
            # HDR team
            - 32.132.92.198/32
            
            # Anthropic (Claude Desktop, API)
            - 160.79.104.0/23
            
            # Add more as needed
            # - YOUR_IP/32
      
      # Rate limiting per IP
      - type: rate-limit
        config:
          name: per-ip-limit
          algorithm: sliding_window
          capacity: 100
          rate: 100/m  # 100 requests per minute
          bucket_key: req.ClientIP
      
      # Log all requests
      - type: log
        config:
          metadata:
            client_ip: ${conn.client_ip}
            user_agent: ${req.headers["user-agent"]}
            method: ${req.method}
            path: ${req.url.path}

on_http_response:
  - actions:
      # Add security headers
      - type: add-headers
        config:
          headers:
            X-Content-Type-Options: nosniff
            X-Frame-Options: DENY
            X-XSS-Protection: "1; mode=block"
```

### 4. VM Provisioning Script

```bash
#!/usr/bin/env bash
# provision-vers-vm.sh - Set up a vers-agent VM

set -euo pipefail

VM_NAME="${1:-vers-acp-01}"
NGROK_AUTHTOKEN="${NGROK_AUTHTOKEN:-}"
ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}"

if [[ -z "$NGROK_AUTHTOKEN" ]]; then
  echo "Error: NGROK_AUTHTOKEN required"
  exit 1
fi

echo "Provisioning vers-agent VM: $VM_NAME"

# 1. Pull lean image
docker pull hdresearch/vers-agent:lean

# 2. Create data volume
docker volume create vers-agent-data

# 3. Run container with ngrok
docker run -d \
  --name "$VM_NAME" \
  --restart unless-stopped \
  -v vers-agent-data:/home/vers/.vers-agent \
  -e NGROK_AUTHTOKEN="$NGROK_AUTHTOKEN" \
  -e ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
  -e PORT=9999 \
  -e VERS_DEBUG=false \
  -p 9999:9999 \
  hdresearch/vers-agent:lean

# 4. Wait for health
echo "Waiting for server to be healthy..."
for i in {1..30}; do
  if docker exec "$VM_NAME" curl -sf http://localhost:9999/health > /dev/null; then
    echo "✓ Server healthy"
    break
  fi
  sleep 2
  if [[ $i -eq 30 ]]; then
    echo "✗ Server failed to become healthy"
    docker logs "$VM_NAME"
    exit 1
  fi
done

# 5. Get ngrok URL
echo "Waiting for ngrok tunnel..."
sleep 5
NGROK_URL=$(docker exec "$VM_NAME" curl -s http://localhost:4040/api/tunnels | jq -r '.tunnels[0].public_url')

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✓ vers-agent VM deployed"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "VM Name:     $VM_NAME"
echo "Public URL:  $NGROK_URL"
echo "Local Port:  9999"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Test connection:"
echo "  vers-agent --remote $NGROK_URL"
echo ""
echo "Add to Claude Desktop:"
echo "  Settings → Integrations → Add: $NGROK_URL"
echo ""
```

## ACP Flow Over Ngrok

### Request Path

```
Client                    ngrok                     VM
  │                         │                        │
  │  POST /rpc (HTTPS)      │                        │
  ├────────────────────────>│                        │
  │                         │  Check policy.yml      │
  │                         │  - IP whitelist ✓      │
  │                         │  - Rate limit ✓        │
  │                         │                        │
  │                         │  POST /rpc (HTTP)      │
  │                         ├───────────────────────>│
  │                         │                        │  Check auth
  │                         │                        │  - Token valid ✓
  │                         │                        │  Handle RPC
  │                         │                        │  - session/new
  │                         │                        │  - session/prompt
  │                         │                        │  
  │                         │  JSON response         │
  │                         │<───────────────────────┤
  │  JSON response          │                        │
  │<────────────────────────┤                        │
```

### SSE Stream Path

```
Client                    ngrok                     VM
  │                         │                        │
  │  GET /events (HTTPS)    │                        │
  ├────────────────────────>│                        │
  │                         │  Establish tunnel      │
  │                         ├───────────────────────>│
  │                         │                        │  Register SSE client
  │                         │                        │  
  │                         │  SSE stream            │
  │  SSE stream             │<───────────────────────┤
  │<════════════════════════╪════════════════════════│
  │  event: text_delta      │                        │
  │  event: tool_call       │   (bidirectional)      │
  │  event: completed       │                        │
```

## Security Considerations

### 1. IP Whitelisting (policy.yml)

```yaml
# Strict: Only known IPs
restrict-ips:
  enforce: true
  allow:
    - 160.79.104.0/23  # Anthropic
    - YOUR_OFFICE_IP/32
    - YOUR_HOME_IP/32
```

### 2. Token-Based Auth

```typescript
// Server already implements claim protocol:
// 1. First client claims server → gets token
// 2. Token stored in ~/.vers-agent/tokens.json (client)
// 3. Token hash stored in auth.db (server)
// 4. All subsequent requests require: Authorization: Bearer <token>
```

### 3. Rate Limiting

```yaml
# Per-IP rate limiting in policy.yml
rate-limit:
  algorithm: sliding_window
  capacity: 100
  rate: 100/m  # 100 req/min per IP
```

### 4. TLS Termination

ngrok handles TLS automatically with valid certificates for `vers.ngrok.io`.

## Deployment Scenarios

### Scenario A: Single Persistent VM

```bash
# One long-lived VM exposed via vers.ngrok.io
./provision-vers-vm.sh vers-production
# → https://vers.ngrok.io (stable)
```

### Scenario B: Ephemeral PR Previews

```yaml
# GitHub Actions (already exists)
# .github/workflows/ngrok-deploy-preview.yml
# Creates temporary tunnel per PR
# → https://random-subdomain.ngrok-free.app (25 min lifetime)
```

### Scenario C: Multi-VM Fleet

```bash
# Multiple VMs for different clients/teams
./provision-vers-vm.sh vers-team-alice
./provision-vers-vm.sh vers-team-bob
# Each gets a subdomain: alice.vers.ngrok.io, bob.vers.ngrok.io
```

## GF(3) Trit Conservation

Following MOMENTUM.md's trifold structure:

```
Deployment workflow preserves GF(3) balance:

MINUS (-1):   provision-vm.sh (setup)
ERGODIC (0):  vers-agent --server (process)
PLUS (+1):    ngrok tunnel (emit/expose)

Sum: -1 + 0 + 1 = 0 ✓
```

## Next Steps

1. **Build lean image** → `Dockerfile.lean` with Alpine + Bun + standalone binaries
2. **Set up vers.ngrok.io domain** → ngrok dashboard → reserve domain
3. **Floxify** → `flox init` → add dependencies → reproducible env
4. **Test deployment** → `./provision-vers-vm.sh test-vm`
5. **Document client setup** → How to connect Claude Desktop to vers.ngrok.io

## References

- ACP Spec: `docs/acp-llms-full.txt`
- ngrok Policies: https://ngrok.com/docs/traffic-policy/
- Current tunnel: `src/tunnel/index.ts`
- Docker: `Dockerfile` (current bloated version)
- Momentum: `MOMENTUM.md` (GF(3) conservation)
