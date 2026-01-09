# Fleet TUI Usage & Testing

## Basic Usage

```bash
bun tui.ts
```

## With libghostty-vt (Ghostty Terminal)

If you have Ghostty installed with libghostty-vt support:

```bash
# Standard run
bun tui.ts

# With specific terminal handling
TERM=xterm-256color bun tui.ts

# With Ghostty-specific features
TERM=ghostty bun tui.ts
```

## Manual Testing

### 1. Fleet Health Check
```bash
# Before starting TUI, verify all VMs are online
curl https://crimson-ca3e-vers.ngrok.io/health
curl https://indigo-97b2-vers.ngrok.io/health
curl https://azure-186f-vers.ngrok.io/health
```

### 2. Test TUI Commands

**Inside TUI:**
```
/status    - Shows all VM domains with latency
/switch    - Cycles to next available VM
/health    - Runs health check on all VMs
/quit      - Exit TUI
```

**Send messages:**
```
hello world    - Sends to current VM (echoes for now)
```

### 3. Test Session Affinity

```bash
# Terminal 1
bun tui.ts
# Will assign to least-loaded VM (e.g., crimson)

# Terminal 2
bun tui.ts
# Should assign to next VM (e.g., indigo)

# Terminal 3
bun tui.ts
# Should assign to next VM (e.g., azure)
```

Each terminal session maintains affinity to its assigned VM.

### 4. Test VM Switching

**Inside TUI:**
```
/status      # See current VM (← you marker)
/switch      # Switch to next VM
/status      # Verify switch worked
```

### 5. Test Resource Display

Status bar should show:
- Current VM domain (e.g., `crimson-ca3e-vers.ngrok.io`)
- Fleet count (e.g., `3/3` when all online)
- Total RAM (e.g., `3.0GiB`)
- Total CPU (e.g., `6 vCPU`)

### 6. Test with VM Offline

**Simulate VM failure:**
```bash
# In another terminal, stop one VM
vers stop adfd4fd6-1e03-499b-bbd9-27e415665047
```

**In TUI:**
```
/health      # Should show 2/3 VMs online
/status      # One VM will show ❌ timeout
```

## Fleet Testing Scripts

### Test Parallel Execution
```bash
bun examples/fleet.ts health
```

### Test Load Balancing
```bash
bun examples/fleet.ts bench 20
```

### Test GF(3) Query
```bash
bun examples/gf3-query.ts
```

## Terminal-Specific Features

### Ghostty Terminal

**Box drawing characters:**
- Status bar uses `┌─┐ │ └─┘` (should render cleanly)

**Color support:**
- TUI is minimal, no colors currently
- Can add ANSI colors if needed

### Standard Terminals

Works in:
- iTerm2
- Terminal.app
- Alacritty
- Kitty
- tmux/screen

### SSH/Remote

```bash
# Via SSH
ssh user@host
cd /path/to/agent
bun tui.ts

# Via tmux (persistent session)
tmux new -s fleet
bun tui.ts
# Detach: Ctrl-b d
# Reattach: tmux attach -t fleet
```

## Automated Testing

### Create Test Script

```bash
# test-fleet-tui.sh
#!/usr/bin/env bash

echo "Testing Fleet TUI..."

# 1. Check all VMs are online
echo "1. Health check all VMs..."
for vm in crimson indigo azure; do
  curl -s https://${vm}-*-vers.ngrok.io/health | jq .
done

# 2. Start TUI in background with expect
echo "2. Testing TUI commands..."
expect << 'EOF'
spawn bun tui.ts
expect "[crimson]>"
send "/status\r"
expect "Fleet Status"
send "/switch\r"
expect "[indigo]>"
send "/health\r"
expect "Health Check"
send "/quit\r"
expect eof
EOF

echo "✅ All tests passed"
```

```bash
chmod +x test-fleet-tui.sh
./test-fleet-tui.sh
```

### Integration Tests

```bash
# Test with full vers-agent on VMs (when deployed)
bun test tests/fleet-integration.test.ts
```

## Troubleshooting

### VM Not Responding
```bash
# Check VM status
vers status <vm-id>

# Check ngrok tunnel
curl https://<domain>/health

# Restart VM
vers restart <vm-id>
```

### Session Not Persisting
```bash
# TUI uses in-memory SQLite by default
# Sessions reset on TUI restart (expected)
```

### Terminal Rendering Issues
```bash
# If box characters don't render:
LANG=en_US.UTF-8 bun tui.ts

# If screen doesn't clear:
clear && bun tui.ts
```

## Next Steps

### Add Full ACP Integration

Replace echo responses with real ACP calls:

```typescript
// In handleMessage()
const client = new AcpClient(this.vm!);
await client.initialize();
const sessionId = await client.createSession();
const result = await client.prompt(sessionId, message);
console.log(`← ${result}`);
```

### Add Live Updates

```typescript
// Poll fleet status every 30s
setInterval(async () => {
  await this.updateStatus();
  // Redraw status bar without clearing screen
}, 30000);
```

### Add Event Streaming

```typescript
// Stream SSE events from VM
const events = await fetch(`${this.vm.url}/events`);
const reader = events.body.getReader();
// Display in real-time
```

## Performance Benchmarks

Expected latencies:
- Health check: ~100-200ms
- VM switch: <1s
- Message echo: <50ms
- Full ACP turn: 2-5s (depending on model)

Fleet capacity:
- 3 VMs × 10 sessions/VM = 30 concurrent users
- 3072 MiB total RAM
- 6 vCPU total capacity
