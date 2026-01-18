# Managing Remote ACP Agents with Morph Cloud and Vers

> A pedagogical guide to running one local ACP client controlling any number of remote AI agents via vers VMs

**Color:** `#c778ea` (Lavender - Coordination/Ergodic)

---

## Overview

This guide shows how to build a distributed AI agent system where:

- **One local client** orchestrates multiple remote agents
- **vers VMs** provide ephemeral, branchable compute via Morph Cloud
- **ACP (Agent Client Protocol)** provides the communication layer
- **libghostty-vt** enables terminal capture and replay

```
┌─────────────────────────────────────────────────────────────────────┐
│  LOCAL CLIENT (your machine)                                         │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  vers-agent --cli                                              │  │
│  │  - Claim tokens for each remote                               │  │
│  │  - Session management                                          │  │
│  │  - ACP JSON-RPC dispatch                                       │  │
│  └──────────────────┬────────────────────────────────────────────┘  │
└─────────────────────┼───────────────────────────────────────────────┘
                      │ SSH tunnels / ngrok
          ┌───────────┼───────────┬───────────┐
          ▼           ▼           ▼           ▼
     ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐
     │ VM -1  │  │ VM  0  │  │ VM +1  │  │ VM  n  │
     │ MINUS  │  │ERGODIC │  │ PLUS   │  │  ...   │
     │Validate│  │ Route  │  │Generate│  │        │
     └────────┘  └────────┘  └────────┘  └────────┘
         ▲           ▲           ▲           ▲
         └───────────┴───────────┴───────────┘
                 vers VMs on Morph Cloud
```

---

## Prerequisites

### 1. Install vers CLI

```bash
# Install from Morph Cloud
curl -fsSL https://vers.sh/install | sh

# Verify
vers --version
```

### 2. Clone vers-agent

```bash
git clone https://github.com/hdresearch/agent.git vers-agent
cd vers-agent
bun install
bun run build
```

### 3. Set Environment Variables

```bash
# ~/.topos/.env
export ANTHROPIC_API_KEY="sk-ant-..."
export NGROK_AUTHTOKEN="..."  # For public URLs
export VERS_API_KEY="..."      # If using Morph Cloud API
```

---

## Part 1: Creating Remote VMs

### Single VM Creation

```bash
# Create a VM with an alias
vers run -N my-agent

# Check it exists
vers alias my-agent
# → fa21d04e-55e4-4fb5-997c-af0dcaaf1123

# Connect interactively
vers connect my-agent
```

### Deploy vers-agent to Remote VM

```bash
# Build the binary locally
cd vers-agent
bun run build

# Copy to VM
vers copy my-agent ./vers-agent /usr/local/bin/vers-agent
vers execute my-agent "chmod +x /usr/local/bin/vers-agent"

# Start the server on the VM
vers execute my-agent "nohup /usr/local/bin/vers-agent --server > /var/log/vers-agent.log 2>&1 &"
```

### Connect Local Client to Remote Server

```bash
# Open SSH tunnel
ssh -L 9999:localhost:9999 -N my-agent.vm.vers.sh &

# Run local CLI against tunnel
./vers-agent --url http://localhost:9999
```

---

## Part 2: Triadic VM Cluster (GF(3) Balanced)

The triadic pattern creates 3 VMs with complementary roles:

| Trit | Alias | Role | Color |
|------|-------|------|-------|
| -1 | `minus` | Validator - critiques, reviews, contracts | `#E74C3C` (Red) |
| 0 | `ergodic` | Coordinator - routes, transforms, bridges | `#F39C12` (Orange) |
| +1 | `plus` | Generator - creates, expands, produces | `#27AE60` (Green) |

**Conservation:** `-1 + 0 + 1 = 0` (GF(3) balanced)

### Create the Cluster

```bash
cd /path/to/duck
bb toaducken/triadic-acp-vms.bb create
```

Output:
```
🦆🐸 TRIADIC ACP VM CLUSTER

  Creating 3 VMs with GF(3) conservation:
  MINUS(-1) + ERGODIC(0) + PLUS(+1) = 0

🔑 Detected 2 API keys
═══════════════════════════════════════════════════════════
  Creating VM: validator (trit=-1)
  Role: MINUS: Validates, reviews, contracts state space
  Color: #E74C3C
═══════════════════════════════════════════════════════════
✅ VM created with alias: minus

[... creates ergodic and plus ...]

  Connect with:
    vers connect minus    # Validator agent
    vers connect ergodic  # Coordinator agent
    vers connect plus     # Generator agent
```

### ACP Configuration per VM

Each VM receives an ACP configuration file at `/etc/acp-agent.edn`:

```clojure
{:acp/version "1.0"
 :acp/agent {:name "validator"
             :trit -1
             :role "MINUS: Validates, reviews, contracts state space"}
 :acp/tools ["verify" "lint" "test" "review" "audit"]
 :acp/mode "critical"
 :acp/prompt "You are a rigorous validator. Question everything. Find flaws."
 :acp/endpoints {:jsonrpc "http://localhost:9000"
                 :health "http://localhost:9000/health"}}
```

---

## Part 3: ACP Protocol Basics

### Claim Flow

When connecting to a fresh server, you must claim it first:

```bash
# First connection claims the server
curl -X POST http://localhost:9999/claim \
  -H "Content-Type: application/json" \
  -d '{"client": {"name": "my-client", "version": "1.0"}}'

# Response:
# {"token": "abc123..."}  # Save this!
```

### Initialize + Session

```bash
# Initialize the agent
curl -X POST http://localhost:9999/rpc \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc": "2.0", "method": "initialize", "params": {"client": {"name": "cli", "version": "1.0"}}, "id": 1}'

# Create a session
curl -X POST http://localhost:9999/rpc \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc": "2.0", "method": "session/new", "params": {}, "id": 2}'

# Send a prompt
curl -X POST http://localhost:9999/rpc \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc": "2.0", "method": "session/prompt", "params": {"text": "What is 2+2?"}, "id": 3}'
```

### SSE Events Stream

```bash
# Subscribe to events (long-running)
curl -N http://localhost:9999/events \
  -H "Authorization: Bearer $TOKEN"

# Events:
# event: text_delta
# data: {"delta": "The answer"}
#
# event: tool_call
# data: {"tool": "calculator", "input": {"a": 2, "b": 2}}
#
# event: completed
# data: {"session_id": "..."}
```

---

## Part 4: Inter-VM Communication

### Dispatch via Babashka

```clojure
(defn acp-call
  "Make ACP JSON-RPC call to a VM"
  [vm-alias method params]
  (let [vm-id (-> (shell {:out :string} "vers" "alias" vm-alias)
                  :out str/trim)
        payload (json/generate-string
                  {:jsonrpc "2.0"
                   :method method
                   :params params
                   :id (gensym "acp-")})
        result (shell {:out :string}
                      "vers" "execute" vm-id
                      (str "curl -s -X POST http://localhost:9000 "
                           "-H 'Content-Type: application/json' "
                           "-d '" payload "'"))]
    (json/parse-string (:out result) true)))

;; Example usage:
(acp-call "plus" "session/prompt" 
          {:text "Generate 3 implementation ideas"})
```

### Triadic Dispatch Pattern

```clojure
(defn triadic-dispatch
  "Route task through all 3 agents"
  [task]
  ;; 1. Generator creates candidates
  (let [ideas (acp-call "plus" "session/prompt" 
                        {:text (str "Generate solutions for: " task)})]
    
    ;; 2. Coordinator routes and transforms
    (let [refined (acp-call "ergodic" "session/prompt"
                            {:text (str "Synthesize and prioritize: " (:result ideas))})]
      
      ;; 3. Validator reviews and approves
      (acp-call "minus" "session/prompt"
                {:text (str "Review for flaws: " (:result refined))}))))
```

---

## Part 5: libghostty-vt Integration

Capture and replay terminal output for agent introspection.

### Build libghostty-vt

```bash
git clone --depth 1 https://github.com/ghostty-org/ghostty.git /tmp/ghostty
cd /tmp/ghostty
zig build lib-vt       # Build library
zig build test-lib-vt  # Run 2826 tests
```

### Terminal Capture Architecture

```
Agent (VM)
    │
    │ stdout/stderr
    ▼
┌──────────────┐
│ libghostty-vt│
│  - OSC parse │  (clipboard, hyperlinks, notifications)
│  - SGR parse │  (colors, styles)
│  - CSI parse │  (cursor, screen control)
└──────────────┘
    │
    │ Structured events
    ▼
ACP Server
    │
    │ SSE stream
    ▼
Local Client
```

### Interactive VT Testing

```bash
cd vers-agent
just vt  # Interactive VT sequence explorer
```

This opens a TUI for testing:
- SGR (colors, bold, italic, underline)
- OSC (window title, clipboard, notifications)
- CSI (cursor movement, screen clear)
- DCS (device control strings)

---

## Part 6: Multi-VM TUI

### Fleet Configuration

Create `fleet-config.json`:

```json
{
  "vms": [
    {
      "id": "alpha",
      "name": "crimson",
      "url": "http://localhost:9997",
      "color": "#DC143C",
      "trit": -1,
      "role": "Verification/Analysis"
    },
    {
      "id": "bravo",
      "name": "indigo",
      "url": "http://localhost:9998",
      "color": "#4B0082",
      "trit": 0,
      "role": "Coordination/Balance"
    },
    {
      "id": "charlie",
      "name": "azure",
      "url": "http://localhost:9999",
      "color": "#007FFF",
      "trit": 1,
      "role": "Generation/Synthesis"
    }
  ]
}
```

### TUI Commands

```
/vm status      # Show all VMs with colors
/vm switch      # Round-robin to next VM
/vm select alpha  # Select specific VM
/vm health      # Check all VM health
/vm sessions    # Show per-VM session stats
```

### Load Balancing

Match task semantics to trit values:

```
Review this code       → crimson (trit: -1)
Refactor this module   → indigo (trit: 0)
Implement new feature  → azure (trit: +1)
```

---

## Part 7: Production Deployment

### Lean Docker Image (~165MB)

```dockerfile
FROM alpine:3.19
RUN apk add --no-cache curl sqlite-libs

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:$PATH"

# Copy built vers-agent
COPY dist/ /app/dist/
COPY package.json /app/

# Install ngrok
RUN curl -fsSL https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-amd64.tgz \
    | tar xz -C /usr/local/bin

EXPOSE 9999
CMD ["sh", "-c", "ngrok http 9999 & bun run /app/dist/index.js --server"]
```

### ngrok Traffic Policy

```yaml
# src/tunnel/policy.yml
on_http_request:
  - actions:
      - type: restrict-ips
        config:
          enforce: true
          allow:
            - 160.79.104.0/23  # Anthropic
            - YOUR_IP/32
      
      - type: rate-limit
        config:
          capacity: 100
          rate: 100/m
          bucket_key: req.ClientIP
```

### Provisioning Script

```bash
#!/bin/bash
# provision-vers-vm.sh

VM_NAME="${1:-vers-acp}"

# Create VM
vers run -N "$VM_NAME"
VM_ID=$(vers alias "$VM_NAME")

# Deploy
vers copy "$VM_ID" ./vers-agent /usr/local/bin/vers-agent
vers execute "$VM_ID" "chmod +x /usr/local/bin/vers-agent"

# Start server
vers execute "$VM_ID" "nohup /usr/local/bin/vers-agent --server &"

# Get public URL (if ngrok is configured)
NGROK_URL=$(vers execute "$VM_ID" "curl -s localhost:4040/api/tunnels | jq -r '.tunnels[0].public_url'")

echo "✅ Deployed: $NGROK_URL"
```

---

## Justfile Reference

```makefile
# Key recipes from vers-agent/justfile

# Build and run locally
build:
    bun run build

server:
    ./vers-agent --server

cli:
    ./vers-agent --cli

# Deploy to VM
deploy-vm vm_id:
    just build
    vers copy {{vm_id}} ./vers-agent /usr/local/bin/vers-agent
    vers execute {{vm_id}} "chmod +x /usr/local/bin/vers-agent"

vm-server-start vm_id:
    vers execute {{vm_id}} "nohup /usr/local/bin/vers-agent --server &"

vm-connect vm_id:
    ssh -L 9999:localhost:9999 -N {{vm_id}}.vm.vers.sh &
    ./vers-agent --url http://localhost:9999

# Chelsea fleet (3 balanced VMs)
chelsea-fleet:
    docker compose -f docker-compose.fleet.yml up -d

# Interactive VT testing
vt:
    bun run src/vt/interactive.ts
```

---

## Summary

| Component | Purpose |
|-----------|---------|
| `vers run -N alias` | Create ephemeral VM with Morph Cloud |
| `vers execute vm cmd` | Run command on remote VM |
| `vers copy src vm:dst` | Deploy files to VM |
| `vers-agent --server` | ACP server on VM (port 9999) |
| `vers-agent --cli` | Local client connecting to server |
| `triadic-acp-vms.bb` | Orchestrate 3 balanced agents |
| `libghostty-vt` | Parse and structure terminal output |
| ngrok | Expose VMs with TLS and IP whitelisting |

**Key insight:** The local client holds all the tokens and session state. VMs are stateless workers that can be created, branched, and destroyed freely.

---

## References

- [ACP Protocol Spec](./acp-llms-full.txt) (496KB)
- [libghostty-vt](./libghostty-vt.md)
- [Deployment Guide](./DEPLOYMENT.md)
- [Multi-VM Usage](../MULTI-VM-USAGE.md)
- [vers CLI docs](https://vers.sh/docs)
- [Morph Cloud](https://morphcloud.io)
