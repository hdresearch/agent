# vers-agent Control Plane | #c778ea

> Control remote ACP agents from local CLI via ngrok tunnels

## The Vision

```
┌─────────────────────────────────────────────────────────────┐
│  You (Local Machine)                                        │
│  ~/i/agent/                                                 │
│                                                             │
│  $ vers-agent control                                       │
│    ↓                                                        │
│  [Control Plane CLI]                                        │
│    - List VMs                                               │
│    - Deploy new VM                                          │
│    - Send prompt to VM                                      │
│    - Stream results back                                    │
│    - Manage fleet                                           │
└────────────────┬────────────────────────────────────────────┘
                 │ HTTPS (ACP JSON-RPC)
                 ▼
┌─────────────────────────────────────────────────────────────┐
│  ngrok Cloud (vers.ngrok.io)                                │
│  - Route to correct VM                                      │
│  - IP whitelisting                                          │
│  - Load balancing                                           │
└────────────────┬────────────────────────────────────────────┘
                 │ HTTP
                 ▼
┌─────────────────────────────────────────────────────────────┐
│  VM Fleet (Docker containers)                               │
│                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │ vers-vm-01  │  │ vers-vm-02  │  │ vers-vm-03  │        │
│  │ vers-agent  │  │ vers-agent  │  │ vers-agent  │        │
│  │ port 9999   │  │ port 9999   │  │ port 9999   │        │
│  └─────────────┘  └─────────────┘  └─────────────┘        │
└─────────────────────────────────────────────────────────────┘
```

## Architecture

### Layer 0: Local Control CLI

You run commands from your local machine:

```bash
# List all remote VMs
vers-agent fleet list

# Deploy a new VM
vers-agent fleet deploy vers-prod-01 vers-01.ngrok.io

# Send a prompt to a VM
vers-agent fleet prompt vers-prod-01 "fix the authentication bug"

# Stream results in real-time
vers-agent fleet stream vers-prod-01

# Get status of all VMs
vers-agent fleet status
```

### Layer 1: Control Plane Server

A persistent server tracks all VMs and their ngrok URLs:

```typescript
// Control plane state (SQLite)
interface VmRegistry {
  id: string;              // vers-prod-01
  name: string;            // Production ACP Server
  url: string;             // https://vers-01.ngrok.io
  status: "online" | "offline" | "busy";
  ngrokEdgeId: string;     // edghts_2abc123
  lastSeen: string;        // ISO timestamp
  capabilities: AgentCapabilities;
}
```

### Layer 2: Remote VMs

Each VM runs vers-agent server and exposes ACP:

```bash
# VM runs:
# - vers-agent --server (port 9999)
# - ngrok tunnel (→ vers-01.ngrok.io)
# - Claude Code subprocess
```

## Implementation

### 1. Control Plane CLI

```typescript
// src/cli/control-plane.ts

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { vmRegistry } from "../control/vm-registry";
import { createHttpsEdge, deleteHttpsEdge } from "../tunnel/mcp-integration";

export async function listVms(): Promise<void> {
  const vms = await vmRegistry.list();
  
  console.log("VM Fleet Status:");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  
  for (const vm of vms) {
    const status = vm.status === "online" ? "✓" : "✗";
    console.log(`${status} ${vm.id.padEnd(20)} ${vm.url}`);
    console.log(`   Last seen: ${vm.lastSeen}`);
  }
}

export async function deployVm(
  id: string,
  domain: string
): Promise<void> {
  console.log(`Deploying VM: ${id}`);
  
  // 1. Create ngrok edge via MCP
  console.log("Creating ngrok edge...");
  const edge = await createHttpsEdge({
    hostports: [domain],
    description: `vers-agent VM: ${id}`,
    metadata: JSON.stringify({ vmId: id, deployedAt: new Date().toISOString() }),
  });
  
  // 2. Build and start Docker container
  console.log("Starting Docker container...");
  const proc = Bun.spawn([
    "docker", "run", "-d",
    "--name", id,
    "-v", `${id}-data:/home/vers/.vers-agent`,
    "-v", `${process.env.HOME}/.topos:/home/vers/.topos:ro`,
    "-e", `NGROK_AUTHTOKEN=${process.env.NGROK_AUTHTOKEN}`,
    "-e", `NGROK_DOMAIN=${domain}`,
    "-p", "9999:9999",
    "vers-agent:lean",
  ]);
  await proc.exited;
  
  // 3. Wait for health
  console.log("Waiting for VM to be healthy...");
  const url = `https://${domain}`;
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) {
        console.log("✓ VM healthy");
        break;
      }
    } catch {
      await Bun.sleep(2000);
    }
  }
  
  // 4. Register in control plane
  await vmRegistry.register({
    id,
    name: id,
    url,
    status: "online",
    ngrokEdgeId: edge.id,
    lastSeen: new Date().toISOString(),
  });
  
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`✓ VM deployed: ${id}`);
  console.log(`  URL: ${url}`);
  console.log(`  Edge: ${edge.id}`);
}

export async function sendPrompt(
  vmId: string,
  prompt: string
): Promise<void> {
  const vm = await vmRegistry.get(vmId);
  if (!vm) {
    throw new Error(`VM not found: ${vmId}`);
  }
  
  console.log(`Sending prompt to ${vmId}...`);
  
  // Connect to remote ACP server
  const response = await fetch(`${vm.url}/rpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "session/prompt",
      params: { text: prompt },
      id: Date.now(),
    }),
  });
  
  const result = await response.json();
  
  if (result.error) {
    throw new Error(result.error.message);
  }
  
  console.log("✓ Prompt sent");
  
  // Stream results via SSE
  await streamResults(vm.url);
}

async function streamResults(vmUrl: string): Promise<void> {
  const response = await fetch(`${vmUrl}/events`);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Streaming results:");
  console.log("");
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    const chunk = decoder.decode(value);
    const lines = chunk.split("\n");
    
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = JSON.parse(line.slice(6));
        
        if (data.type === "content_chunk") {
          process.stdout.write(data.data.text);
        } else if (data.type === "tool_call") {
          console.log(`\n[Tool: ${data.data.toolName}]`);
        } else if (data.type === "completed") {
          console.log("\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
          console.log(`✓ Completed in ${data.data.durationMs}ms`);
          console.log(`  Tokens: ${data.data.inputTokens} in / ${data.data.outputTokens} out`);
          console.log(`  Cost: $${data.data.totalCostUsd.toFixed(4)}`);
          return;
        }
      }
    }
  }
}
```

### 2. VM Registry (SQLite)

```typescript
// src/control/vm-registry.ts

import Database from "bun:sqlite";
import { join } from "path";

const DB_PATH = join(process.env.HOME!, ".vers-agent", "control-plane.db");

export interface VmEntry {
  id: string;
  name: string;
  url: string;
  status: "online" | "offline" | "busy";
  ngrokEdgeId: string;
  lastSeen: string;
  capabilities?: string; // JSON
}

class VmRegistry {
  private db: Database;
  
  constructor() {
    this.db = new Database(DB_PATH);
    this.init();
  }
  
  private init() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS vms (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        status TEXT NOT NULL,
        ngrok_edge_id TEXT NOT NULL,
        last_seen TEXT NOT NULL,
        capabilities TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }
  
  async register(vm: VmEntry): Promise<void> {
    this.db.run(
      `INSERT OR REPLACE INTO vms 
       (id, name, url, status, ngrok_edge_id, last_seen, capabilities)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [vm.id, vm.name, vm.url, vm.status, vm.ngrokEdgeId, vm.lastSeen, vm.capabilities]
    );
  }
  
  async get(id: string): Promise<VmEntry | null> {
    return this.db.query("SELECT * FROM vms WHERE id = ?").get(id) as VmEntry | null;
  }
  
  async list(): Promise<VmEntry[]> {
    return this.db.query("SELECT * FROM vms ORDER BY created_at DESC").all() as VmEntry[];
  }
  
  async updateStatus(id: string, status: VmEntry["status"]): Promise<void> {
    this.db.run(
      "UPDATE vms SET status = ?, last_seen = ? WHERE id = ?",
      [status, new Date().toISOString(), id]
    );
  }
  
  async remove(id: string): Promise<void> {
    this.db.run("DELETE FROM vms WHERE id = ?", [id]);
  }
}

export const vmRegistry = new VmRegistry();
```

### 3. Fleet Management Commands

```typescript
// src/cli/commands/fleet.ts

export const fleetCommand = {
  name: "fleet",
  description: "Manage remote VM fleet",
  subcommands: [
    {
      name: "list",
      description: "List all VMs",
      handler: listVms,
    },
    {
      name: "deploy",
      description: "Deploy a new VM",
      args: ["<id>", "<domain>"],
      handler: deployVm,
    },
    {
      name: "prompt",
      description: "Send prompt to VM",
      args: ["<vm-id>", "<prompt>"],
      handler: sendPrompt,
    },
    {
      name: "stream",
      description: "Stream results from VM",
      args: ["<vm-id>"],
      handler: (vmId: string) => streamResults(vmId),
    },
    {
      name: "status",
      description: "Get status of all VMs",
      handler: fleetStatus,
    },
    {
      name: "destroy",
      description: "Destroy a VM",
      args: ["<vm-id>"],
      handler: destroyVm,
    },
  ],
};

async function fleetStatus(): Promise<void> {
  const vms = await vmRegistry.list();
  
  console.log("Fleet Status:");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  
  let online = 0;
  let offline = 0;
  let busy = 0;
  
  for (const vm of vms) {
    // Ping each VM
    try {
      const res = await fetch(`${vm.url}/health`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        await vmRegistry.updateStatus(vm.id, "online");
        online++;
      } else {
        await vmRegistry.updateStatus(vm.id, "offline");
        offline++;
      }
    } catch {
      await vmRegistry.updateStatus(vm.id, "offline");
      offline++;
    }
  }
  
  console.log(`Total: ${vms.length} VMs`);
  console.log(`  ✓ Online:  ${online}`);
  console.log(`  ✗ Offline: ${offline}`);
  console.log(`  ⧗ Busy:    ${busy}`);
}

async function destroyVm(vmId: string): Promise<void> {
  const vm = await vmRegistry.get(vmId);
  if (!vm) {
    throw new Error(`VM not found: ${vmId}`);
  }
  
  console.log(`Destroying VM: ${vmId}`);
  
  // 1. Stop Docker container
  console.log("Stopping container...");
  await Bun.spawn(["docker", "stop", vmId]).exited;
  await Bun.spawn(["docker", "rm", vmId]).exited;
  
  // 2. Delete ngrok edge
  console.log("Deleting ngrok edge...");
  await deleteHttpsEdge(vm.ngrokEdgeId);
  
  // 3. Remove from registry
  await vmRegistry.remove(vmId);
  
  console.log(`✓ VM destroyed: ${vmId}`);
}
```

### 4. Justfile Commands

```bash
# ── Fleet Control ─────────────────────────────────────────────────────────────
# List all remote VMs
fleet-list:
    vers-agent fleet list

# Deploy a new VM
fleet-deploy id domain:
    vers-agent fleet deploy {{id}} {{domain}}

# Send prompt to VM
fleet-prompt id prompt:
    vers-agent fleet prompt {{id}} "{{prompt}}"

# Get fleet status
fleet-status:
    vers-agent fleet status

# Destroy a VM
fleet-destroy id:
    vers-agent fleet destroy {{id}}

# Quick: deploy and test
fleet-quick-test:
    just fleet-deploy test-vm test.ngrok.io
    just fleet-prompt test-vm "echo hello from remote VM"
    sleep 5
    just fleet-destroy test-vm
```

## Usage Examples

### Deploy a Production Fleet

```bash
# Deploy 3 VMs
just fleet-deploy vers-prod-01 vers-01.ngrok.io
just fleet-deploy vers-prod-02 vers-02.ngrok.io
just fleet-deploy vers-prod-03 vers-03.ngrok.io

# Check status
just fleet-status
# Output:
# Fleet Status:
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Total: 3 VMs
#   ✓ Online:  3
#   ✗ Offline: 0
#   ⧗ Busy:    0
```

### Send Tasks to VMs

```bash
# Send different tasks to different VMs
just fleet-prompt vers-prod-01 "analyze logs and find errors"
just fleet-prompt vers-prod-02 "run test suite and report results"
just fleet-prompt vers-prod-03 "review PRs and suggest improvements"

# All run in parallel across the fleet
```

### Stream Results

```bash
# Watch results in real-time
vers-agent fleet stream vers-prod-01

# Output:
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Streaming results:
#
# Analyzing logs from /var/log/app.log...
# [Tool: Read]
# Found 3 errors:
# 1. Connection timeout at 14:32:01
# 2. Failed auth attempt at 14:35:12
# 3. Database deadlock at 14:38:45
#
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# ✓ Completed in 12.3s
#   Tokens: 1,234 in / 567 out
#   Cost: $0.0234
```

### Interactive Fleet Control

```bash
# Start interactive control plane
vers-agent control

# Interactive prompt:
# vers> list
# VM Fleet Status:
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# ✓ vers-prod-01       https://vers-01.ngrok.io
#    Last seen: 2 minutes ago
# ✓ vers-prod-02       https://vers-02.ngrok.io
#    Last seen: 1 minute ago
#
# vers> prompt vers-prod-01 fix authentication bug
# Sending prompt to vers-prod-01...
# ✓ Prompt sent
# [streaming results...]
#
# vers> status
# Fleet Status:
# Total: 2 VMs
#   ✓ Online:  2
#
# vers> exit
```

## GF(3) Trit Conservation

Control plane operations maintain balance:

```
Deploy workflow:
  MINUS (-1):   provision + create edge (setup)
  ERGODIC (0):  register in DB (record state)
  PLUS (+1):    VM online + serving requests (emit)
  Sum: -1 + 0 + 1 = 0 ✓

Destroy workflow:
  PLUS (+1):    stop container (cease emission)
  ERGODIC (0):  remove from DB (update state)
  MINUS (-1):   delete edge (teardown)
  Sum: +1 + 0 + (-1) = 0 ✓

Prompt/Response:
  PLUS (+1):    send prompt (input)
  ERGODIC (0):  process on VM (transform)
  MINUS (-1):   stream results back (output/consume)
  Sum: +1 + 0 + (-1) = 0 ✓
```

## Security Model

### Authentication Chain

```
Local CLI
  ↓ reads ~/.topos/.env (NGROK_AUTHTOKEN, ANTHROPIC_API_KEY)
  ↓ HTTPS with IP whitelist
ngrok Edge
  ↓ HTTP (internal)
  ↓ Token-based auth (claim protocol)
VM (vers-agent)
  ↓ spawns subprocess
Claude Code
```

### Token Hierarchy

1. **NGROK_AUTHTOKEN** - Creates/manages tunnels
2. **NGROK_API_KEY** - MCP operations (edge management)
3. **ANTHROPIC_API_KEY** - Claude API access
4. **ACP_TOKEN** - Per-VM claim token (generated on first connect)

All stored in `~/.topos/.env`, mounted read-only in containers.

## Monitoring Dashboard

```bash
# Watch fleet in real-time
watch -n 5 'vers-agent fleet status'

# Or build a TUI dashboard
vers-agent control --dashboard

# Shows:
# ┌─────────────────────────────────────────────────────────────┐
# │ vers-agent Control Plane                                    │
# ├─────────────────────────────────────────────────────────────┤
# │ VM                Status   URL                  Load        │
# ├─────────────────────────────────────────────────────────────┤
# │ vers-prod-01      ✓ Online https://vers-01...  42% CPU     │
# │ vers-prod-02      ✓ Online https://vers-02...  15% CPU     │
# │ vers-prod-03      ⧗ Busy   https://vers-03...  87% CPU     │
# └─────────────────────────────────────────────────────────────┘
# 
# [L]ist  [D]eploy  [P]rompt  [S]tatus  [Q]uit
```

## Next Steps

1. **Implement Control CLI** - Add `vers-agent fleet` subcommands
2. **Build VM Registry** - SQLite database for tracking VMs
3. **Add Health Checks** - Periodic pings to update status
4. **Load Balancing** - Distribute prompts across idle VMs
5. **Metrics Aggregation** - Collect metrics from all VMs
6. **Web Dashboard** - HTML UI for fleet management
7. **Auto-scaling** - Deploy/destroy VMs based on load

## The Complete Flow

```bash
# On your local machine:
cd ~/i/agent

# 1. Deploy a VM to the cloud
just fleet-deploy prod-01 vers.ngrok.io
# → Builds lean image
# → Creates ngrok edge via MCP
# → Starts Docker container
# → Registers in control plane DB

# 2. Send it a task
just fleet-prompt prod-01 "analyze the codebase and suggest improvements"
# → Connects to https://vers.ngrok.io/rpc
# → Sends ACP session/prompt
# → Streams results back via SSE

# 3. You see results in real-time
# → Tool calls appear as they happen
# → Text streams character by character
# → Complete with token/cost stats

# 4. Clean up when done
just fleet-destroy prod-01
# → Stops container
# → Deletes ngrok edge
# → Removes from registry
```

You control the entire fleet from your local machine. The VMs are ephemeral compute - spin up, run tasks, tear down. All state lives in your local control plane DB.

This is the vision: **Local control, remote execution, real-time streaming.**
