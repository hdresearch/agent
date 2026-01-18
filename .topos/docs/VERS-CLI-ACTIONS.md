# vers-cli Action Planning | #c778ea

> Clean slate - planning how to leverage vers-cli for fleet management

## Current State

✅ **Clean Environment:**
- No running containers
- No Docker volumes
- Empty VM registry (control-plane.db)
- Ready for fresh deployment

## vers-cli vs Control Plane Integration

### What is vers-cli?

If you have a `vers-cli` tool, we should integrate it with the control plane for:

1. **Deployment Actions** - Spin up VMs
2. **Management Actions** - Control running VMs
3. **Query Actions** - Inspect fleet state
4. **Cleanup Actions** - Tear down infrastructure

### Proposed Integration Architecture

```
vers-cli (External tool)
    ↓ Actions
    ├── deploy → Creates VM
    ├── list   → Shows VMs
    ├── exec   → Runs command on VM
    └── destroy → Tears down VM
    
vers-agent (Our control plane)
    ↓ Wraps vers-cli + adds:
    ├── VM Registry (SQLite tracking)
    ├── ngrok Tunnels (automatic exposure)
    ├── ACP Protocol (remote control)
    └── Fleet Management (multi-VM)
```

## Action Categories

### 1. Infrastructure Actions (vers-cli → Docker)

```bash
# What vers-cli might do:
vers-cli create <name>     # Create a VM
vers-cli start <name>      # Start a VM
vers-cli stop <name>       # Stop a VM
vers-cli destroy <name>    # Destroy a VM
vers-cli list              # List VMs

# How we integrate:
just fleet-deploy <id> <domain>
    ↓ calls vers-cli create <id>
    ↓ creates ngrok edge
    ↓ registers in control-plane.db
    ↓ returns URL
```

### 2. Control Actions (ACP Protocol)

```bash
# What we add on top:
just fleet-prompt <id> <text>
    ↓ looks up VM URL from registry
    ↓ sends ACP session/prompt
    ↓ streams results back

just fleet-stream <id>
    ↓ connects to VM's /events SSE
    ↓ displays real-time output
```

### 3. Query Actions (Observability)

```bash
# Current (control plane):
just fleet-status          # Count by status
just fleet-list            # Table of all VMs

# What we could add:
just fleet-health <id>     # Ping specific VM
just fleet-logs <id>       # Stream VM logs
just fleet-metrics <id>    # Get usage stats
```

### 4. Bulk Actions (Fleet Operations)

```bash
# Deploy fleet of N VMs:
just fleet-scale 3
    ↓ for i in 1..3:
    ↓   deploy vers-vm-$i

# Send same prompt to all:
just fleet-broadcast <text>
    ↓ for each online VM:
    ↓   send prompt

# Health check all:
just fleet-ping
    ↓ for each VM:
    ↓   ping /health
    ↓   update status in DB
```

## Integration Plan

### Step 1: Discover vers-cli Capabilities

```bash
# What commands does vers-cli support?
vers-cli --help
vers-cli list
vers-cli inspect <vm>

# Document the interface
```

### Step 2: Create Wrapper Layer

```typescript
// src/control/vers-cli-adapter.ts

import { spawn } from "bun";

export async function versCliCreate(name: string): Promise<string> {
  // Wrap vers-cli create command
  const proc = spawn(["vers-cli", "create", name]);
  await proc.exited;
  
  // Parse output to get VM ID/info
  return vmId;
}

export async function versCliList(): Promise<Array<{id: string, status: string}>> {
  // Wrap vers-cli list command
  // Parse output into structured data
}

export async function versCliExec(vmId: string, command: string): Promise<string> {
  // Wrap vers-cli exec command
  // Return output
}

export async function versCliDestroy(vmId: string): Promise<void> {
  // Wrap vers-cli destroy command
}
```

### Step 3: Integrate with Fleet Manager

```typescript
// src/control/fleet-manager.ts (updated)

import { versCliCreate, versCliDestroy } from "./vers-cli-adapter";

export async function deployVm(options: DeployOptions): Promise<VmEntry> {
  const { vmId, domain } = options;
  
  // 1. Use vers-cli to create VM
  await versCliCreate(vmId);
  
  // 2. Create ngrok edge
  const edge = await createHttpsEdge({ hostports: [domain] });
  
  // 3. Register in control plane
  await vmRegistry.register({
    id: vmId,
    url: `https://${domain}`,
    ngrokEdgeId: edge.id,
    status: "online",
    lastSeen: new Date().toISOString(),
  });
  
  return vm;
}
```

### Step 4: Update Justfile

```bash
# justfile

# Deploy using vers-cli + control plane
fleet-deploy-vers id domain:
    @echo "Deploying via vers-cli..."
    vers-cli create {{id}}
    bun src/control/fleet-manager.ts deploy {{id}} {{domain}}

# Execute command on VM
fleet-exec id command:
    vers-cli exec {{id}} "{{command}}"

# Destroy via vers-cli
fleet-destroy-vers id:
    @echo "Destroying {{id}}..."
    bun src/control/fleet-manager.ts destroy {{id}}
    vers-cli destroy {{id}}
```

## Use Case Scenarios

### Scenario A: Development Testing

```bash
# Quick VM for testing
just fleet-deploy test-vm test.ngrok.io

# Send test prompt
just fleet-prompt test-vm "echo hello"

# Watch output
just fleet-stream test-vm

# Clean up
just fleet-destroy test-vm
```

### Scenario B: Production Fleet

```bash
# Deploy 3 production VMs
for i in {01..03}; do
  just fleet-deploy prod-$i prod-$i.ngrok.io
done

# Check health
just fleet-status

# Send different tasks
just fleet-prompt prod-01 "task A"
just fleet-prompt prod-02 "task B"
just fleet-prompt prod-03 "task C"

# Monitor all
watch -n 5 'just fleet-status'
```

### Scenario C: Auto-scaling

```bash
# Scale to 5 VMs
just fleet-scale 5

# Distribute work (load balancing)
just fleet-broadcast "analyze logs"
# → sends to all idle VMs

# Scale down when done
just fleet-scale 2
# → destroys extras
```

## Questions to Answer

1. **What is vers-cli?**
   - Is it a VM management tool?
   - What VMs does it create (Docker, VMs, cloud instances)?
   - What commands does it expose?

2. **Where do VMs run?**
   - Local Docker containers?
   - Remote cloud VMs?
   - Kubernetes pods?

3. **How do we access VMs?**
   - SSH?
   - Docker exec?
   - HTTP API?

4. **What's the lifecycle?**
   - Create → Start → Stop → Destroy?
   - Or just Create → Destroy?

5. **Can we customize?**
   - Image selection?
   - Resource limits?
   - Network configuration?

## Next Steps

```bash
# 1. Explore vers-cli
vers-cli --help
vers-cli version
vers-cli list

# 2. Test basic operations
vers-cli create test-vm
vers-cli list
vers-cli exec test-vm "echo hello"
vers-cli destroy test-vm

# 3. Document the interface
# → Write wrapper in vers-cli-adapter.ts

# 4. Integrate with control plane
# → Update fleet-manager.ts to use vers-cli

# 5. Test end-to-end
just fleet-deploy test-vm test.ngrok.io
just fleet-prompt test-vm "hello"
just fleet-destroy test-vm
```

## Integration Checklist

- [ ] Discover vers-cli commands and API
- [ ] Create vers-cli-adapter.ts wrapper
- [ ] Update fleet-manager.ts to use adapter
- [ ] Add justfile recipes for vers-cli integration
- [ ] Test VM creation via vers-cli
- [ ] Test ngrok tunnel establishment
- [ ] Test ACP communication
- [ ] Test cleanup and destroy
- [ ] Document the complete workflow
- [ ] Add error handling and retries
- [ ] Add logging and metrics

## Expected Directory Structure After Integration

```
src/
├── control/
│   ├── vm-registry.ts        # SQLite tracking (existing)
│   ├── fleet-manager.ts      # Orchestration (existing)
│   └── vers-cli-adapter.ts   # vers-cli wrapper (new)
├── tunnel/
│   ├── index.ts              # Direct ngrok (existing)
│   └── mcp-integration.ts    # MCP edges (existing)
└── cli/
    └── commands/
        └── fleet.ts          # CLI commands (new)
```

## GF(3) Conservation with vers-cli

```
vers-cli Integration:

MINUS (-1):   vers-cli create (setup VM)
ERGODIC (0):  fleet-manager orchestrates (coordinate)
PLUS (+1):    ngrok exposes + ACP control (emit)

Sum: -1 + 0 + 1 = 0 ✓

Lifecycle:
MINUS (-1):   Create infrastructure (vers-cli create)
PLUS (+1):    Execute workloads (ACP prompts)
ERGODIC (0):  Monitor and manage (control plane)
MINUS (-1):   Destroy infrastructure (vers-cli destroy)

Sum: -1 + 1 + 0 + (-1) = -1 (teardown dominates, as expected)
```

---

**Ready to integrate vers-cli.** First, let's discover what it can do:

```bash
vers-cli --help
```
