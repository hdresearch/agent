# vers Integration with Control Plane | #c778ea

> vers VM management + vers-agent ACP server + ngrok tunnels = Complete control plane

## Clean Slate ✓

```bash
✓ All vers VMs deleted (5 removed)
✓ No containers running
✓ Empty VM registry
✓ Ready for integrated deployment
```

## Architecture: Three Tools, One System

```
┌─────────────────────────────────────────────────────────────┐
│  vers (VM Management)                                       │
│  - vers run → Create VM                                     │
│  - vers execute → Run commands in VM                        │
│  - vers connect → SSH into VM                               │
│  - vers delete → Destroy VM                                 │
│  - vers mcp serve → Expose as MCP tools                     │
└────────────────┬────────────────────────────────────────────┘
                 │ Controls
                 ▼
┌─────────────────────────────────────────────────────────────┐
│  VM (running vers-agent --server)                          │
│  - ACP JSON-RPC on port 9999                                │
│  - Claude Code subprocess                                   │
│  - Session management                                       │
└────────────────┬────────────────────────────────────────────┘
                 │ Exposed via
                 ▼
┌─────────────────────────────────────────────────────────────┐
│  ngrok Tunnel (vers.ngrok.io)                               │
│  - HTTPS termination                                        │
│  - IP whitelisting                                          │
│  - Public access                                            │
└────────────────┬────────────────────────────────────────────┘
                 │ Tracked by
                 ▼
┌─────────────────────────────────────────────────────────────┐
│  Control Plane (vm-registry.ts)                             │
│  - SQLite fleet tracking                                    │
│  - Health monitoring                                        │
│  - Fleet operations                                         │
└─────────────────────────────────────────────────────────────┘
```

## vers Capabilities

### Core Commands

```bash
# Create and run a VM
vers run [--image <image>] [--name <name>]

# Execute command in VM
vers execute <vm-id> <command>

# Connect interactively
vers connect <vm-id>

# List VMs
vers status [vm-id]

# Delete VMs
vers delete -y <vm-id>...

# Branch from existing VM
vers branch <source-vm-id>

# Commit VM state
vers commit
```

### MCP Server

```bash
# Expose vers operations as MCP tools
vers mcp serve --transport stdio
vers mcp serve --transport http --addr :3920

# Tools exposed:
# - vers_run
# - vers_execute
# - vers_connect
# - vers_delete
# - vers_status
# - etc.
```

## Integration Strategy

### Strategy 1: vers Creates VM, vers-agent Runs Inside

```bash
# 1. Use vers to create VM
VM_ID=$(vers run --name acp-server | grep -oP 'VM: \K[a-f0-9-]+')

# 2. Install vers-agent in VM
vers execute $VM_ID "curl -L https://github.com/hdresearch/agent/releases/latest/download/vers-agent -o /usr/local/bin/vers-agent"
vers execute $VM_ID "chmod +x /usr/local/bin/vers-agent"

# 3. Start vers-agent server in VM
vers execute $VM_ID "vers-agent --server" &

# 4. Create ngrok tunnel (from local machine)
EDGE=$(bun src/tunnel/mcp-integration.ts create vers-acp.ngrok.io)

# 5. Register in control plane
bun src/control/vm-registry.ts add acp-server https://vers-acp.ngrok.io $EDGE_ID
```

### Strategy 2: vers MCP Server + Control Plane

```bash
# 1. Start vers MCP server (background)
vers mcp serve --transport http --addr :3920 &

# 2. Control plane calls vers via MCP
# src/control/vers-adapter.ts wraps MCP calls

# 3. Unified fleet management
just fleet-deploy-vers <name>
# → Calls vers via MCP
# → Installs vers-agent
# → Creates ngrok tunnel
# → Registers in control plane
```

### Strategy 3: Docker with vers Inside (Hybrid)

```bash
# Dockerfile.vers-hybrid
FROM vers/base:latest
RUN curl -L .../vers-agent -o /usr/local/bin/vers-agent
CMD ["vers-agent", "--server"]

# Deploy
docker run -d --name acp-01 \
  -e NGROK_AUTHTOKEN=$NGROK_AUTHTOKEN \
  vers-agent-hybrid:latest
```

## Implementation Plan

### Phase 1: vers MCP Adapter

Create `src/control/vers-adapter.ts`:

```typescript
/**
 * Adapter for vers MCP server
 */

const VERS_MCP_URL = "http://localhost:3920";

export async function versRun(options: {
  name?: string;
  image?: string;
}): Promise<string> {
  const response = await fetch(VERS_MCP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        name: "vers_run",
        arguments: options,
      },
      id: Date.now(),
    }),
  });
  
  const result = await response.json();
  return result.result.vmId;
}

export async function versExecute(
  vmId: string,
  command: string
): Promise<string> {
  const response = await fetch(VERS_MCP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        name: "vers_execute",
        arguments: { vmId, command },
      },
      id: Date.now(),
    }),
  });
  
  const result = await response.json();
  return result.result.output;
}

export async function versDelete(vmId: string): Promise<void> {
  await fetch(VERS_MCP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        name: "vers_delete",
        arguments: { vmId },
      },
      id: Date.now(),
    }),
  });
}

export async function versStatus(): Promise<Array<{ vmId: string }>> {
  const response = await fetch(VERS_MCP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/call",
      params: {
        name: "vers_status",
        arguments: {},
      },
      id: Date.now(),
    }),
  });
  
  const result = await response.json();
  return result.result.vms;
}
```

### Phase 2: Integrated Deployment

Update `src/control/fleet-manager.ts`:

```typescript
import { versRun, versExecute, versDelete } from "./vers-adapter";

export async function deployVersVm(options: {
  name: string;
  domain: string;
}): Promise<VmEntry> {
  const { name, domain } = options;
  
  // 1. Create VM via vers
  const vmId = await versRun({ name });
  
  // 2. Install vers-agent in VM
  await versExecute(vmId, 
    "curl -L https://github.com/.../vers-agent -o /usr/local/bin/vers-agent && chmod +x /usr/local/bin/vers-agent"
  );
  
  // 3. Start vers-agent server
  await versExecute(vmId, "vers-agent --server &");
  
  // 4. Create ngrok edge
  const edge = await createHttpsEdge({ hostports: [domain] });
  
  // 5. Register in control plane
  const vm = {
    id: vmId,
    name,
    url: `https://${domain}`,
    ngrokEdgeId: edge.id,
    status: "online" as const,
    lastSeen: new Date().toISOString(),
    metadata: JSON.stringify({ versVmId: vmId }),
  };
  
  await vmRegistry.register(vm);
  
  return vm;
}
```

### Phase 3: Justfile Integration

```bash
# ── vers Integration ──────────────────────────────────────────────────────────

# Start vers MCP server (background)
vers-mcp-start:
    vers mcp serve --transport http --addr :3920 &
    echo $! > /tmp/vers-mcp.pid
    echo "vers MCP server started on :3920"

# Stop vers MCP server
vers-mcp-stop:
    kill $(cat /tmp/vers-mcp.pid) 2>/dev/null || true
    rm -f /tmp/vers-mcp.pid

# Deploy VM using vers
fleet-deploy-vers name domain:
    @echo "Deploying {{name}} via vers..."
    @VM_ID=$(vers run --name {{name}} | grep -oP 'VM: \K[a-f0-9-]+') && \
    echo "VM created: $VM_ID" && \
    echo "Installing vers-agent..." && \
    vers execute $VM_ID "curl -L .../vers-agent -o /usr/local/bin/vers-agent && chmod +x /usr/local/bin/vers-agent" && \
    echo "Starting ACP server..." && \
    vers execute $VM_ID "vers-agent --server &" && \
    echo "Creating ngrok tunnel..." && \
    EDGE_ID=$(bun src/tunnel/mcp-integration.ts create {{domain}} | jq -r '.id') && \
    echo "Registering in control plane..." && \
    bun src/control/vm-registry.ts add {{name}} https://{{domain}} $EDGE_ID && \
    echo "✓ Deployed {{name}} at https://{{domain}}"

# Execute command in vers VM
vers-exec vm-id command:
    vers execute {{vm-id}} "{{command}}"

# Connect to vers VM
vers-connect vm-id:
    vers connect {{vm-id}}

# Delete vers VM and cleanup
fleet-destroy-vers name:
    @VM_ID=$(bun src/control/vm-registry.ts list | grep {{name}} | awk '{print $2}') && \
    EDGE_ID=$(bun src/control/vm-registry.ts list | grep {{name}} | awk '{print $5}') && \
    echo "Destroying {{name}}..." && \
    vers delete -y $VM_ID && \
    bun src/tunnel/mcp-integration.ts delete $EDGE_ID && \
    bun src/control/vm-registry.ts remove {{name}} && \
    echo "✓ Destroyed {{name}}"
```

## Usage Examples

### Example 1: Quick Test VM

```bash
# Start vers MCP server
just vers-mcp-start

# Deploy test VM
just fleet-deploy-vers test-vm test.ngrok.io

# Send a prompt
./vers-agent --url https://test.ngrok.io

# Clean up
just fleet-destroy-vers test-vm
just vers-mcp-stop
```

### Example 2: Production Fleet

```bash
# Deploy 3 VMs via vers
for i in {01..03}; do
  just fleet-deploy-vers prod-$i prod-$i.ngrok.io
done

# Check status
just fleet-status

# Use them
./vers-agent --url https://prod-01.ngrok.io
```

### Example 3: Direct vers Commands

```bash
# Create VM manually
VM_ID=$(vers run --name manual-vm)

# Execute in VM
vers execute $VM_ID "apt-get update && apt-get install -y bun"

# Connect interactively
vers connect $VM_ID

# Delete
vers delete -y $VM_ID
```

## GF(3) Conservation with vers

```
Complete Stack:

MINUS (-1):   vers run (create VM)
ERGODIC (0):  vers-agent --server (process)
PLUS (+1):    ngrok tunnel (emit/expose)

Sum: -1 + 0 + 1 = 0 ✓

With Control Plane:

MINUS (-1):   Create (vers + ngrok)
ERGODIC (0):  Track (vm-registry.ts)
PLUS (+1):    Execute (ACP prompts)
MINUS (-1):   Destroy (cleanup)

Sum: -1 + 0 + 1 + (-1) = -1 (teardown)
```

## Next Actions

1. **Start vers MCP server**: `vers mcp serve --transport http --addr :3920`
2. **Create vers-adapter.ts**: Wrap MCP calls
3. **Test basic flow**: Create VM → Install vers-agent → Connect
4. **Add justfile recipes**: fleet-deploy-vers, vers-exec, etc.
5. **Document vers image requirements**: What does vers VM need?

## Benefits of vers Integration

✅ **Native VM management** - vers handles lifecycle  
✅ **Branch/commit support** - vers git-like operations  
✅ **MCP integration** - vers operations as tools  
✅ **SSH access** - vers connect for debugging  
✅ **Lightweight** - vers VMs are optimized  
✅ **Composable** - vers + vers-agent + ngrok + control plane  

---

**You now have a clean slate and vers ready for integration.**

Next: Start vers MCP server and test the flow.
