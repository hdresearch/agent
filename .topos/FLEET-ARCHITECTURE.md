# Fleet Architecture: ACP-Based Multi-VM Management

## Executive Summary

Successfully deployed and architected a **3-VM fleet** with color-generated domains, demonstrating how the Agent Client Protocol (ACP) enables scalable, distributed agent management. Each VM runs an independent ACP server accessible via unique ngrok tunnels, coordinated through a central control plane.

## Current Fleet Status

### 🌈 Color-Generated Domains

| VM | Color | Hex | Domain | VM ID | Status |
|----|-------|-----|--------|-------|--------|
| 1 | Crimson | `#CA3E0E` | `crimson-ca3e-vers.ngrok.io` | `adfd4fd6...665047` | ✅ Online |
| 2 | Indigo | `#97B2DD` | `indigo-97b2-vers.ngrok.io` | `5d2f18ea...de882cc` | ✅ Online |
| 3 | Azure | `#186FA5` | `azure-186f-vers.ngrok.io` | `5352719b...ac423408` | ✅ Online |

**Color Generation**: Deterministic sequence from color MCP with interaction entropy seed (`7449368709244611695`)

### 📊 Fleet Resources

**Per-VM Allocation:**
- Memory: 1024 MB (864 MB available per VM)
- vCPU: 2
- Disk: 2048 MB (1.5 GB available per VM)

**Fleet Totals:**
- Memory: 3 GB (2.5 GB available)
- vCPU: 6
- Disk: 6 GB (4.5 GB available)

**Current Utilization:** ~15% memory, ~20% disk per VM

## Architecture Overview

### 1. Topology

```
┌─────────────────────────────────────────────────────────────────┐
│                     Control Plane (Local)                        │
│  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────┐ │
│  │ VM Registry      │  │ Fleet Manager    │  │ Load Balancer │ │
│  │ (SQLite)         │  │                  │  │ (Future)      │ │
│  └──────────────────┘  └──────────────────┘  └───────────────┘ │
└──────────────┬─────────────────┬─────────────────┬──────────────┘
               │                 │                 │
         HTTPS │           HTTPS │           HTTPS │
               │                 │                 │
    ┌──────────▼─────┐  ┌───────▼──────┐  ┌──────▼──────────┐
    │ ngrok Tunnel   │  │ ngrok Tunnel │  │ ngrok Tunnel    │
    │ crimson-ca3e   │  │ indigo-97b2  │  │ azure-186f      │
    └──────────┬─────┘  └───────┬──────┘  └──────┬──────────┘
               │                 │                 │
    ┌──────────▼─────┐  ┌───────▼──────┐  ┌──────▼──────────┐
    │ VM 1 (Crimson) │  │ VM 2 (Indigo)│  │ VM 3 (Azure)    │
    │  ACP Server    │  │  ACP Server  │  │  ACP Server     │
    │  :9999         │  │  :9999       │  │  :9999          │
    └────────────────┘  └──────────────┘  └─────────────────┘
```

### 2. ACP Protocol Flow

Based on Agent Client Protocol specification:

#### Connection Initialization
```
Client                     Control Plane               VM (ACP Server)
  │                              │                            │
  │──1. Select VM from fleet───▶│                            │
  │                              │                            │
  │◀─2. Return VM URL────────────│                            │
  │    (https://crimson-ca3e-vers.ngrok.io)                  │
  │                              │                            │
  │──3. POST /rpc (initialize)─────────────────────────────▶│
  │                              │                            │
  │◀─4. agentInfo + capabilities───────────────────────────│
  │   {name, version, fileSystem, terminal, session}         │
```

#### Prompt Turn (Core Workflow)
```
Client                     VM (ACP Server)
  │                              │
  │──1. POST /rpc────────────────▶│
  │   {                          │
  │     method: "prompt/turn",   │
  │     params: {                │
  │       text: "...",           │
  │       sessionId: "..."       │
  │     }                        │
  │   }                          │
  │                              │
  │◀─2. SSE /events──────────────│
  │   ┌──────────────────────────│
  │   │ content_start            │
  │   │ content_delta (chunk 1)  │
  │   │ content_delta (chunk 2)  │
  │   │ tool_call_start          │
  │   │ tool_call_delta          │
  │   │ tool_call_result         │
  │   │ content_delta (chunk 3)  │
  │   │ turn_complete            │
  │   └──────────────────────────│
```

### 3. Fleet Management Patterns

#### Pattern A: Round-Robin Load Distribution
```typescript
class FleetLoadBalancer {
  private currentIndex = 0;
  private vms: VmEntry[];

  async getNextAvailableVm(): Promise<VmEntry> {
    const onlineVms = this.vms.filter(vm => vm.status === 'online');
    const vm = onlineVms[this.currentIndex % onlineVms.length];
    this.currentIndex++;
    return vm;
  }
}
```

#### Pattern B: Least-Loaded Selection
```typescript
async function selectLeastLoadedVm(vms: VmEntry[]): Promise<VmEntry> {
  const loads = await Promise.all(
    vms.map(async vm => ({
      vm,
      load: await getVmLoad(vm.url) // Check /health for metrics
    }))
  );
  return loads.sort((a, b) => a.load - b.load)[0].vm;
}
```

#### Pattern C: Capability-Based Routing
```typescript
async function selectVmByCapability(
  vms: VmEntry[], 
  required: string
): Promise<VmEntry> {
  for (const vm of vms) {
    const caps = await getVmCapabilities(vm.url);
    if (caps[required]) return vm;
  }
  throw new Error(`No VM with capability: ${required}`);
}
```

#### Pattern D: Session Affinity (Sticky Sessions)
```typescript
class SessionRouter {
  private sessionToVm = new Map<string, string>();

  async routeSession(sessionId: string): Promise<VmEntry> {
    if (this.sessionToVm.has(sessionId)) {
      const vmId = this.sessionToVm.get(sessionId)!;
      return await registry.get(vmId);
    }
    // New session - assign to least loaded
    const vm = await selectLeastLoadedVm(await registry.list());
    this.sessionToVm.set(sessionId, vm.id);
    return vm;
  }
}
```

## ACP Protocol Analysis for Fleet

### Core Methods (Required for Fleet)

#### 1. `initialize` - Connection Setup
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "clientInfo": {
      "name": "fleet-client",
      "version": "1.0.0"
    },
    "capabilities": {
      "fileSystem": {"read": true, "write": true},
      "terminal": {"create": true}
    }
  }
}
```

**Fleet Consideration**: Each VM must respond with its specific capabilities. Control plane should cache these per VM.

#### 2. `prompt/turn` - Main Workload
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "prompt/turn",
  "params": {
    "text": "Analyze this codebase",
    "sessionId": "session-123"
  }
}
```

**Fleet Consideration**: Session affinity required - same session must route to same VM.

#### 3. `session/new` - Create Session
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "session/new",
  "params": {
    "workingDirectory": "/workspace",
    "systemPrompt": "You are a code analysis expert"
  }
}
```

**Fleet Consideration**: Session creation can be load-balanced. Return `{sessionId, vmId}` to track placement.

#### 4. `session/list` - Session Management
```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "session/list"
}
```

**Fleet Consideration**: Control plane must aggregate sessions across all VMs or route to specific VM.

### Event Streaming (SSE)

All VMs expose `GET /events` for server-sent events:

```
GET /events HTTP/1.1
Host: crimson-ca3e-vers.ngrok.io

event: content_start
data: {"seq":0,"turnId":"turn-1"}

event: content_delta
data: {"seq":1,"delta":"Here is the analysis..."}

event: turn_complete
data: {"seq":10,"cost":0.05}
```

**Fleet Consideration**: Client must maintain one SSE connection per active session. Control plane should multiplex events if needed.

## Scaling Patterns

### Horizontal Scaling (Add More VMs)

**Current**: 3 VMs @ 1GB each = 3GB fleet capacity
**Scale to**: 10 VMs @ 1GB each = 10GB fleet capacity
**Scale to**: 100 VMs @ 1GB each = 100GB fleet capacity

**Color Domain Generation**:
```typescript
async function deployFleet(count: number): Promise<VmEntry[]> {
  const vms: VmEntry[] = [];
  
  for (let i = 0; i < count; i++) {
    const color = await getNextColor(); // From color MCP
    const domain = colorToDomain(color);
    const vm = await deployVm({ domain, resources: VM_DEFAULTS });
    vms.push(vm);
  }
  
  return vms;
}
```

### Vertical Scaling (Bigger VMs)

**Current**: 1GB RAM, 2 vCPU
**Medium**: 2GB RAM, 4 vCPU (for heavier workloads)
**Large**: 4GB RAM, 8 vCPU (for Claude Opus, complex reasoning)

Update `vers.toml`:
```toml
[machine]
  mem_size_mib = 2048
  vcpu_count = 4
  fs_size_vm_mib = 4096
```

### Auto-Scaling

```typescript
class AutoScaler {
  async scaleUp(reason: string): Promise<void> {
    const avgLoad = await this.getFleetAverageLoad();
    if (avgLoad > 0.8) {
      console.log(`Scaling up: ${reason}`);
      const color = await getNextColor();
      const domain = colorToDomain(color);
      await deployVm({ domain });
    }
  }

  async scaleDown(): Promise<void> {
    const avgLoad = await this.getFleetAverageLoad();
    if (avgLoad < 0.3 && this.fleet.length > 3) {
      const idleVm = await this.findMostIdleVm();
      await destroyVm(idleVm.id);
    }
  }
}
```

## Fleet Operations

### Health Monitoring

```typescript
async function healthCheckFleet(): Promise<FleetHealth> {
  const vms = await registry.list();
  const checks = await Promise.all(
    vms.map(async vm => {
      try {
        const res = await fetch(`${vm.url}/health`, { timeout: 5000 });
        const data = await res.json();
        return { vm: vm.id, status: 'online', latency: res.timing };
      } catch {
        return { vm: vm.id, status: 'offline', latency: null };
      }
    })
  );
  
  return {
    total: vms.length,
    online: checks.filter(c => c.status === 'online').length,
    avgLatency: avg(checks.map(c => c.latency).filter(Boolean))
  };
}
```

### Session Migration (Advanced)

```typescript
async function migrateSession(
  sessionId: string,
  fromVm: string,
  toVm: string
): Promise<void> {
  // 1. Export session state from source VM
  const state = await fetch(`${fromVm}/rpc`, {
    method: 'POST',
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'session/export',
      params: { sessionId }
    })
  });
  
  // 2. Import to destination VM
  await fetch(`${toVm}/rpc`, {
    method: 'POST',
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'session/import',
      params: { sessionId, state }
    })
  });
  
  // 3. Update routing table
  sessionRouter.updateMapping(sessionId, toVm);
}
```

## Cost Analysis

### Current Deployment (3 VMs)

**ngrok Costs:**
- Free tier: 1 reserved domain
- Paid tier: $8/month for 5 reserved domains (covers our 3)

**Compute Costs** (if using cloud VMs):
- AWS t3.medium (2 vCPU, 4GB): $0.0416/hr × 3 = $0.125/hr = $90/month
- DigitalOcean (2 vCPU, 2GB): $18/month × 3 = $54/month
- Vers.sh pricing: TBD (currently using local vers)

**Total**: $54-90/month for 3-VM fleet

### Scaling Economics

| Fleet Size | ngrok Cost | Compute Cost | Total/Month |
|------------|------------|--------------|-------------|
| 3 VMs | $8 | $54 | $62 |
| 10 VMs | $16 | $180 | $196 |
| 100 VMs | $160 | $1,800 | $1,960 |

**Cost Optimization**:
- Use spot instances (50-90% cheaper)
- Auto-scale during off-hours
- Pool idle VMs instead of destroying

## Implementation Roadmap

### Phase 1: Current State ✅
- [x] 3-VM fleet deployed
- [x] Color-generated domains
- [x] Control plane registry
- [x] Health checks working
- [x] ngrok tunnels stable

### Phase 2: Basic Fleet Management (Next)
- [ ] Load balancer implementation
- [ ] Session affinity routing
- [ ] Automated health monitoring
- [ ] VM failure detection & recovery

### Phase 3: Advanced Features
- [ ] Auto-scaling based on load
- [ ] Session migration
- [ ] Multi-region deployment
- [ ] Advanced metrics & monitoring

### Phase 4: Production Hardening
- [ ] Authentication & authorization
- [ ] Rate limiting per VM
- [ ] DDoS protection
- [ ] Encrypted session state
- [ ] Audit logging

## Key Architectural Decisions

### 1. **Session Affinity**: Required
ACP sessions maintain state (file system, terminal, conversation history). Sessions must stick to the same VM for their lifetime.

**Implementation**: Use session-to-VM mapping in control plane, stored in SQLite.

### 2. **Load Balancing**: Round-Robin + Health Checks
For new session creation, use round-robin among healthy VMs. Monitor health via `/health` endpoint.

**Implementation**: `FleetLoadBalancer` class with health-aware selection.

### 3. **Color-Based Naming**: Deterministic
Continue using color MCP for domain generation. Provides:
- Unique, memorable names
- Deterministic from seed
- Easy visual identification

**Implementation**: Already working, extend to N VMs.

### 4. **Control Plane**: Centralized
Single SQLite database tracks all VMs, sessions, and routing. Alternatives considered:
- Distributed (etcd, Consul): Overkill for <1000 VMs
- Redis: Adds dependency
- SQLite: Simple, sufficient for 100s of VMs

**Implementation**: Current `vm-registry.ts` is sufficient.

### 5. **Failure Handling**: Retry + Failover
If a VM fails mid-session, options:
- Retry on same VM (if transient)
- Migrate to new VM (if permanent failure)
- Return error to client (if migration not possible)

**Implementation**: Add retry logic in client, health checks in control plane.

## Testing Strategy

### Load Testing

```bash
# Generate 100 concurrent prompts across fleet
for i in {1..100}; do
  VM_URL=$(bun src/control/fleet-manager.ts get-next)
  curl -X POST "$VM_URL/rpc" \
    -d '{"jsonrpc":"2.0","method":"prompt/turn","params":{"text":"Hello","sessionId":"test-'$i'"}}' &
done
wait
```

### Failover Testing

```bash
# Kill VM 1, ensure sessions migrate to VM 2/3
vers execute adfd4fd6-1e03-499b-bbd9-27e415665047 pkill -9 bun
# Control plane should detect failure and reroute
```

### Capacity Testing

```bash
# Deploy 10 VMs, measure time and success rate
time bun src/control/fleet-manager.ts deploy --count 10
```

## Conclusion

The 3-VM fleet demonstrates that ACP-based architecture scales horizontally with:
- ✅ Independent VM deployment (vers branch)
- ✅ Unique domain generation (color MCP)
- ✅ Centralized control plane (SQLite registry)
- ✅ Health monitoring (HTTP /health)
- ✅ Protocol compliance (ACP JSON-RPC + SSE)

**Next Steps**: Implement load balancer, session router, and auto-scaling logic in `src/control/fleet-manager.ts`.

**Recommended Architecture**: Continue with current centralized control plane + stateless VM workers pattern. This matches standard Kubernetes/Docker Swarm architectures and is well-understood.
