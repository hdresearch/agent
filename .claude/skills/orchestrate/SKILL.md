---
name: orchestrate
description: Orchestrate multiple AI agents across Vers VMs for parallel task execution
---

# VM Orchestration Skill

You can orchestrate multiple AI agents running on Vers VMs. Each VM runs its own vers-agent instance that you can control via the CLI.

## Architecture

```
You (orchestrator)
  │
  │ vers-client.sh → localhost:9999
  │
  ├── VM-1 (vers-agent on :80) ─── works on task
  ├── VM-2 (vers-agent on :80) ─── works on task
  └── VM-N (vers-agent on :80) ─── works on task
```

## CLI Script

All commands use the vers-client.sh script:
```bash
./scripts/vers-client.sh <command> [args]
```

Environment variables:
- `VERS_HOST` - Server host (default: localhost)
- `VERS_PORT` - Server port (default: 9999)

## Golden Image

New VMs are created from a golden image with:
- Bun 1.3.6 pre-installed
- vers-agent with all dependencies
- Pre-configured .env with API keys

This makes VM creation fast (~2-3 seconds).

## Available Commands

### List VMs
```bash
./scripts/vers-client.sh vms
```

### Create a VM
Creates a new VM from the golden image.
```bash
./scripts/vers-client.sh vm-create "description of what this VM will work on"
```

Returns: `{ "vmId": "...", "agentUrl": "https://<vmId>.vm.vers.sh" }`

### Run a Prompt on VM(s)
Send a prompt to all VMs (fire-and-forget, doesn't wait for completion):
```bash
./scripts/vers-client.sh vm-run "your task here"
```

### Execute Command on VM (SSH)
Run arbitrary shell commands on a VM via SSH:
```bash
./scripts/vers-client.sh vm-exec <vmId> "ls -la /root"
```

Returns: `{ "stdout": "...", "stderr": "...", "exitCode": 0 }`

Use this to:
- Check agent status: `curl -s http://localhost:80/health`
- View logs: `tail -100 ~/.vers-agent/logs/vers-agent.log`
- Run git commands: `cd /root/vers-agent && git status`
- Start/restart agent: `cd /root/vers-agent && pkill -f vers-agent; bun run index.ts --server &`

### Upload Files to VM
Copy files or directories from local machine to VM:
```bash
# Upload a single file
./scripts/vers-client.sh vm-upload <vmId> /path/to/local/file /root/file

# Upload a directory (automatically uses tar)
./scripts/vers-client.sh vm-upload <vmId> /path/to/local/dir /root/dir
```

### Get VM Outputs
Get the conversation history from a VM:
```bash
# Get last 10 messages from a specific VM
./scripts/vers-client.sh vm-outputs <vmId> 10
```

### Get Status of All VMs
Quick overview of all VMs with their last messages:
```bash
# Get status with last message from each VM
./scripts/vers-client.sh vm-status

# Get status with last 5 messages from each VM
./scripts/vers-client.sh vm-status 5
```

### Wait for VM to Complete
Block until a VM finishes its current task:
```bash
./scripts/vers-client.sh vm-wait <vmId>

# With timeout (in milliseconds)
./scripts/vers-client.sh vm-wait <vmId> 60000
```

### Watch VM Events (SSE Stream)
Real-time streaming of events from all VMs, tagged by VM ID:
```bash
./scripts/vers-client.sh vm-watch

# Filter to specific VMs (comma-separated)
./scripts/vers-client.sh vm-watch "vm-id-1,vm-id-2"
```

Output shows VM ID prefix with color coding:
```
[a1c9d57b] Hello! I'm working on the task...
[df6f41fb] Starting implementation...
[a1c9d57b] ✓ Done
```

### Poll for Events (Alternative)
For non-streaming access to events:
```bash
# Get events since sequence 0
./scripts/vers-client.sh vm-events 0

# Filter to specific VMs
./scripts/vers-client.sh vm-events 0 "vm-id-1,vm-id-2"
```

Returns: `{ "events": [...], "lastSeq": 123, "connectionStatus": {...} }`

Use `lastSeq` from the response as the first argument in the next poll.

## Orchestration Patterns

### Pattern 1: Parallel Exploration
Create multiple VMs and try different approaches:
```bash
# 1. Create VMs for different approaches
./scripts/vers-client.sh vm-create "implement feature X - approach A"
./scripts/vers-client.sh vm-create "implement feature X - approach B"
./scripts/vers-client.sh vm-create "implement feature X - approach C"

# 2. Run task on all VMs
./scripts/vers-client.sh vm-run "implement feature X using your assigned approach"

# 3. Watch progress in real-time
./scripts/vers-client.sh vm-watch
```

### Pattern 2: Divide and Conquer
Split a large task across multiple VMs:
```bash
# Create VMs for each subtask
./scripts/vers-client.sh vm-create "implement auth module"
./scripts/vers-client.sh vm-create "implement database layer"
./scripts/vers-client.sh vm-create "implement API endpoints"

# Dispatch work to all
./scripts/vers-client.sh vm-run "implement your assigned module"

# Check status
./scripts/vers-client.sh vm-status
```

### Pattern 3: Code Sync & Deploy
Upload local changes to VMs and restart agents:
```bash
# Upload updated code to a VM
./scripts/vers-client.sh vm-upload <vmId> ./src /root/vers-agent/src

# Restart the agent to pick up changes
./scripts/vers-client.sh vm-exec <vmId> "cd /root/vers-agent && pkill -f vers-agent; bun run index.ts --server &"
```

### Pattern 4: Different Prompts to Different VMs
Send unique prompts to specific VMs using curl with vmIds filter:
```bash
# Get VM IDs first
./scripts/vers-client.sh vms

# Send different prompts (use curl for vmIds filtering)
curl -sX POST http://localhost:9999/rpc -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"vm/run","params":{"prompt":"Write a haiku","vmIds":["vm-id-1"]}}'

curl -sX POST http://localhost:9999/rpc -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"vm/run","params":{"prompt":"Explain recursion","vmIds":["vm-id-2"]}}'
```

## Key Principles

1. **Branches are cheap** - Fork VMs liberally to explore alternatives
2. **Commits cost money** - Only commit checkpoints when you need to preserve state long-term
3. **Side effects are real** - VMs have full network access, actions are not reversible
4. **Fire and forget** - vm-run dispatches work but doesn't wait for completion
5. **Check status** - Use `vm-status` for quick overview, `vm-watch` for real-time streaming
6. **Agent on port 80** - Each VM's vers-agent runs on port 80, use vm-exec + curl to interact
7. **Multiplexed events** - Use `vm-watch` to monitor all VMs in one stream, tagged by vmId

## When to Use This Skill

Use `/orchestrate` when you need to:
- Run the same task with different approaches in parallel
- Split a large task across multiple agents
- Explore a solution space (MCTS-style)
- Scale up compute for a complex problem
- Deploy code changes to remote VMs

$ARGUMENTS
