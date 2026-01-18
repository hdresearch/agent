# Control Plane Actions Guide | #c778ea

> Using vers-agent CLI with fleet control plane

## Clean Slate Status ✓

```bash
# Verified clean environment:
✓ No running containers
✓ No Docker volumes
✓ Empty VM registry (0 VMs)
✓ Ready for deployment
```

## vers-agent CLI Modes

The vers-agent binary has 4 modes:

```bash
# 1. Default mode (server + CLI, continue session)
./vers-agent

# 2. Server only (for VMs)
./vers-agent --server

# 3. CLI only (connect to server)
./vers-agent --cli

# 4. Remote CLI (connect to remote VM)
./vers-agent --url https://vm.ngrok.io
```

## Control Plane Integration

### Architecture

```
Local Machine                    Remote VMs
┌────────────────────┐          ┌────────────────────┐
│ ./vers-agent --cli │──HTTP──→│ vers-agent --server│
│                    │          │ (in Docker)        │
└────────────────────┘          └────────────────────┘
         ↓                               ↑
    [Control Plane]                 [ngrok tunnel]
         ↓                               ↑
┌────────────────────┐          ┌────────────────────┐
│ vm-registry.ts     │          │ vers.ngrok.io      │
│ (SQLite tracking)  │          │ (public access)    │
└────────────────────┘          └────────────────────┘
```

## Action Patterns

### Pattern 1: Deploy → Register → Control

```bash
# 1. Deploy a VM with server mode
just provision-vm prod-01 vers-prod-01.ngrok.io
# → Starts: vers-agent --server (port 9999)
# → Exposes: https://vers-prod-01.ngrok.io

# 2. Register in control plane
VM_URL=$(just vm-url prod-01)
EDGE_ID="edghts_abc123"  # From ngrok MCP
bun src/control/vm-registry.ts add prod-01 "$VM_URL" "$EDGE_ID"

# 3. Control remotely
./vers-agent --url "$VM_URL"
# → Opens interactive CLI connected to remote VM
# → Type prompts, see responses in real-time
```

### Pattern 2: Local CLI → Remote Server

```bash
# Start server on VM
docker run -d --name prod-01 \
  -p 9999:9999 \
  vers-agent:lean
# → Running: vers-agent --server

# Connect from local machine
./vers-agent --url https://vers-prod-01.ngrok.io
# → Interactive session with remote Claude

# Or via justfile
just fleet-connect prod-01
```

### Pattern 3: Programmatic Control (curl)

```bash
# Get VM URL from registry
VM_URL=$(bun src/control/vm-registry.ts list | grep prod-01 | awk '{print $3}')

# Send prompt via curl
curl -X POST "$VM_URL/rpc" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "session/prompt",
    "params": {"text": "analyze the codebase"},
    "id": 1
  }'

# Stream results
curl -N "$VM_URL/events"
```

### Pattern 4: Fleet Broadcasting

```bash
# Get all online VMs
VMS=$(bun src/control/vm-registry.ts list | tail -n +2 | awk '{print $3}')

# Send same prompt to all
for VM_URL in $VMS; do
  curl -X POST "$VM_URL/rpc" \
    -H "Content-Type: application/json" \
    -d '{
      "jsonrpc": "2.0",
      "method": "session/prompt",
      "params": {"text": "report system status"},
      "id": '$(date +%s)'
    }' &
done

wait
echo "All prompts sent"
```

## New Justfile Recipes

Add these to leverage vers-agent CLI:

```bash
# ── Control Plane + CLI Integration ───────────────────────────────────────────

# Connect to a VM interactively
fleet-connect id:
    @VM_URL=$(bun src/control/vm-registry.ts list | grep {{id}} | awk '{print $4}') && \
    echo "Connecting to {{id}} at $VM_URL..." && \
    ./vers-agent --url "$VM_URL"

# Send prompt via curl (for scripting)
fleet-send id text:
    @VM_URL=$(bun src/control/vm-registry.ts list | grep {{id}} | awk '{print $4}') && \
    curl -X POST "$VM_URL/rpc" -H "Content-Type: application/json" \
      -d '{"jsonrpc":"2.0","method":"session/prompt","params":{"text":"{{text}}"},"id":1}'

# Watch events from a VM
fleet-watch id:
    @VM_URL=$(bun src/control/vm-registry.ts list | grep {{id}} | awk '{print $4}') && \
    echo "Watching events from {{id}}..." && \
    curl -N "$VM_URL/events"

# Broadcast to all online VMs
fleet-broadcast text:
    #!/usr/bin/env bash
    for VM_URL in $(bun src/control/vm-registry.ts list | grep online | awk '{print $4}'); do
      echo "Sending to $VM_URL..."
      curl -X POST "$VM_URL/rpc" -H "Content-Type: application/json" \
        -d '{"jsonrpc":"2.0","method":"session/prompt","params":{"text":"{{text}}"},"id":'$(date +%s)'}' &
    done
    wait
    echo "✓ Broadcast complete"

# Interactive fleet dashboard
fleet-dashboard:
    #!/usr/bin/env bash
    while true; do
      clear
      echo "════════════════════════════════════════════════"
      echo "vers-agent Fleet Dashboard | $(date)"
      echo "════════════════════════════════════════════════"
      just fleet-status
      echo ""
      bun src/control/vm-registry.ts list
      echo ""
      echo "Commands: [C]onnect [B]roadcast [R]efresh [Q]uit"
      read -n1 -t 5 cmd || continue
      case $cmd in
        c|C) read -p "VM ID: " vmid; just fleet-connect "$vmid" ;;
        b|B) read -p "Message: " msg; just fleet-broadcast "$msg" ;;
        r|R) continue ;;
        q|Q) exit 0 ;;
      esac
    done
```

## Usage Scenarios

### Scenario 1: Interactive Development

```bash
# 1. Deploy a dev VM
just provision-vm dev-01 dev-01.ngrok.io

# 2. Register it
bun src/control/vm-registry.ts add dev-01 https://dev-01.ngrok.io edghts_dev123

# 3. Connect interactively
just fleet-connect dev-01

# 4. Work in the interactive CLI
vers> analyze the codebase
vers> fix the bug in auth.ts
vers> run the tests

# 5. Disconnect (Ctrl+D)

# 6. Clean up when done
just fleet-destroy dev-01
```

### Scenario 2: Production Fleet

```bash
# 1. Deploy 3 production VMs
for i in {01..03}; do
  just provision-vm prod-$i prod-$i.ngrok.io
  bun src/control/vm-registry.ts add prod-$i https://prod-$i.ngrok.io edghts_$i
done

# 2. Check fleet status
just fleet-status
# Total: 3, Online: 3

# 3. Assign different tasks
just fleet-send prod-01 "monitor logs for errors"
just fleet-send prod-02 "run integration tests"
just fleet-send prod-03 "generate performance report"

# 4. Watch one in real-time
just fleet-watch prod-01

# 5. Broadcast system health check
just fleet-broadcast "report system metrics"
```

### Scenario 3: CI/CD Integration

```bash
#!/bin/bash
# deploy-and-test.sh

# Deploy test VM
just provision-vm ci-test ci-test.ngrok.io
bun src/control/vm-registry.ts add ci-test https://ci-test.ngrok.io edghts_ci

# Run tests
just fleet-send ci-test "run full test suite"

# Wait for completion (poll /health for status)
while true; do
  STATUS=$(curl -s https://ci-test.ngrok.io/health | jq -r '.status')
  if [ "$STATUS" = "ok" ]; then
    break
  fi
  sleep 5
done

# Get results
RESULTS=$(curl -s https://ci-test.ngrok.io/rpc -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"session/outputs","params":{},"id":1}')

echo "$RESULTS" > test-results.json

# Clean up
just fleet-destroy ci-test

# Exit with test status
if echo "$RESULTS" | grep -q "PASS"; then
  exit 0
else
  exit 1
fi
```

### Scenario 4: Load Testing

```bash
# Deploy N VMs for load testing
N=10
for i in $(seq 1 $N); do
  just provision-vm load-$i load-$i.ngrok.io &
done
wait

# Register all
for i in $(seq 1 $N); do
  bun src/control/vm-registry.ts add load-$i https://load-$i.ngrok.io edghts_load_$i
done

# Send identical task to all (parallel execution)
just fleet-broadcast "process large dataset"

# Monitor completion rate
watch -n 5 'just fleet-status'

# Clean up fleet
for i in $(seq 1 $N); do
  just fleet-destroy load-$i &
done
wait
```

## Control Flow Diagrams

### Interactive Session

```
User                 Local CLI              Remote Server
 │                       │                        │
 │  just fleet-connect   │                        │
 ├──────────────────────>│                        │
 │                       │  GET /events           │
 │                       ├───────────────────────>│
 │                       │  <stream connected>    │
 │                       │<───────────────────────┤
 │                       │                        │
 │  Type: "hello"        │                        │
 ├──────────────────────>│                        │
 │                       │  POST /rpc             │
 │                       │  session/prompt        │
 │                       ├───────────────────────>│
 │                       │                        │
 │                       │  SSE: text_delta       │
 │                       │<───────────────────────┤
 │  See: "Hello..."      │                        │
 │<──────────────────────┤                        │
 │                       │  SSE: completed        │
 │                       │<───────────────────────┤
 │  Prompt complete      │                        │
 │<──────────────────────┤                        │
```

### Broadcast Flow

```
Control Plane           VM Fleet
     │                     │
     │  fleet-broadcast    │
     ├──────┬──────┬───────┤
     │      │      │       │
     │  POST│  POST│  POST │
     ├─────>├─────>├──────>│
     │  VM1 │  VM2 │  VM3  │
     │      │      │       │
     │  All execute in     │
     │  parallel           │
     │<─────┴──────┴───────┤
     │  Results aggregate  │
```

## Session Management

### Continue vs Fresh Session

```bash
# Continue last session (default)
./vers-agent --url https://vm.ngrok.io
# → Resumes conversation context

# Force fresh session
./vers-agent --url https://vm.ngrok.io --new
# → Starts clean, no prior context
```

### Session Persistence

VMs store session state in:
```
/home/vers/.vers-agent/
├── auth.db           # Claim state
├── sessions.db       # Session history
├── outputs.db        # Message history
└── logs/             # Debug logs
```

Persisted via Docker volume:
```bash
docker run -d \
  -v vers-prod-01-data:/home/vers/.vers-agent \
  vers-agent:lean
# → Sessions survive container restarts
```

## Health Checks

### Manual Health Check

```bash
# Check specific VM
VM_URL=$(bun src/control/vm-registry.ts list | grep prod-01 | awk '{print $4}')
curl -s "$VM_URL/health" | jq

# Output:
# {
#   "status": "ok",
#   "initialized": true,
#   "sessionId": "abc123",
#   "claimed": false
# }
```

### Automated Health Loop

```bash
# Run in background
while true; do
  bun src/control/fleet-manager.ts health-check
  sleep 30
done &

# Or via systemd timer
```

## GF(3) Conservation in Actions

```
Interactive Session:
  PLUS (+1):    User sends prompt (input)
  ERGODIC (0):  VM processes (transform)
  MINUS (-1):   Results stream back (output)
  Sum: +1 + 0 + (-1) = 0 ✓

Broadcast:
  PLUS (+1):    One prompt sent
  ERGODIC (0):  N VMs process (parallel)
  MINUS (-1):   N results aggregate
  Sum: +1 + 0 + (-1) = 0 ✓
  
Fleet Deploy:
  MINUS (-1):   Create infrastructure
  PLUS (+1):    Execute workloads
  MINUS (-1):   Destroy infrastructure
  Sum: -1 + 1 + (-1) = -1 (net teardown)
```

## Next Actions

1. **Add justfile recipes** for fleet-connect, fleet-send, fleet-watch, fleet-broadcast
2. **Test interactive connection** to a remote VM
3. **Build fleet-dashboard** TUI
4. **Add health check loop** as background process
5. **Document session management** best practices

## Current Capabilities Summary

✅ Deploy VMs via Docker + ngrok  
✅ Track VMs in SQLite registry  
✅ CLI modes (server/client/remote)  
✅ ACP JSON-RPC protocol  
✅ SSE event streaming  
✅ Session persistence  
✅ Health checks  

🚧 Interactive fleet dashboard (TUI)  
🚧 Automated health monitoring  
🚧 Load balancing  
🚧 Auto-scaling  

---

**You now have a clean slate and a plan for using vers-agent CLI with the control plane.**

Next: Add the new justfile recipes and test `just fleet-connect`.
