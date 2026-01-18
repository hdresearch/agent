# vers-agent

[![CI](https://github.com/hdresearch/agent/actions/workflows/ci.yml/badge.svg)](https://github.com/hdresearch/agent/actions/workflows/ci.yml)

ACP-compliant agent harness with dual CLI/HTTP interface. Run AI coding agents like Claude Code through a unified protocol with session persistence, streaming updates, and multi-agent support.

## Quick Start

    git clone https://github.com/hdresearch/agent.git && cd agent
    bun install && bun run build
    export ANTHROPIC_API_KEY=sk-ant-...
    ./vers-agent

## What is ACP?

[Agent Client Protocol](https://agentclientprotocol.com/) is a JSON-RPC 2.0 based protocol for controlling AI agents.

vers-agent implements ACP to provide:

- **Session management** - Create, load, list, and persist sessions with SQLite storage
- **Streaming notifications** - Real-time tool use, text deltas, thinking events via SSE
- **Multi-agent support** - Switch between agents (Claude Code, Codex, etc.)
- **Permission handling** - Interactive approval for file writes, command execution
- **Plan mode** - Toggle between planning and execution modes

## Modes

| Command | Description |
|---------|-------------|
| ./vers-agent | Server + CLI (default) |
| ./vers-agent --server | HTTP server only |
| ./vers-agent --cli | CLI only |
| ./vers-agent --url URL | Remote server |
| ./vers-agent --local | Local debug mode |

---

## VERS VM Fleet System

**VERS** (Virtual Environment Runtime System) is a multi-VM agent infrastructure with **GF(3) trit-based load balancing**.

### Fleet Configuration

Configure in fleet-config.json with triadic VMs:

| VM | Name | Color | Trit | Role |
|------|--------|---------|------|-------------|
| alpha | crimson | #DC143C | -1 | Validator |
| bravo | indigo | #4B0082 | 0 | Coordinator |
| charlie | azure | #007FFF | +1 | Generator |

**GF(3) Balance Property:** Sum of trits ≡ 0 (mod 3)

### Triadic VM Roles

| Trit | Role | Function |
|------|------|----------|
| -1 (MINUS) | Validator | Verification, validation, security |
| 0 (ERGODIC) | Coordinator | Load balancing, orchestration |
| +1 (PLUS) | Generator | Content creation, code generation |

### Fleet Manager

The fleet-manager.ts provides:
- Docker container discovery via labels
- Health monitoring with configurable intervals
- Automatic failover when VMs become unhealthy
- ngrok tunnel management for remote access

### VM Provisioning

VMs are provisioned with:
- Base image from Chelsea (see below)
- CPU/memory limits per role
- WireGuard networking for secure inter-VM communication
- Automatic registration with fleet coordinator

---

## Chelsea Image Creation Architecture

VERS integrates with [Chelsea](https://github.com/hdresearch/chelsea) for Firecracker microVM orchestration.

### Image Sources

| Source | Description | Use Case |
|--------|-------------|----------|
| **Docker** | Pull from registry, merge onto Ubuntu base | Standard containers |
| **S3** | Download complete rootfs tarball | Pre-built images |
| **Upload** | Use locally uploaded tarball | Custom filesystems |

**Docker Image Flow:**
1. Download pre-configured Ubuntu 24.04 base squashfs
2. Export Docker image layers to tarball
3. Extract and merge onto base (preserving boot files)
4. Configure with Chelsea network scripts and services

### Image Creation Pipeline

Pipeline stages:
- **Pending** - Request queued
- **Downloading** - Fetching source (Docker/S3/Upload)
- **Extracting** - Unpacking tarball to rootfs
- **Configuring** - Adding Chelsea scripts, systemd units
- **CreatingRbd** - Creating Ceph RBD image + ext4 format
- **CreatingSnapshot** - Protecting snapshot for cloning
- **Completed** - Ready for VM creation

### DeferAsync Pattern

Chelsea uses DeferAsync for robust error handling:
- Resources automatically cleaned up on failure
- Cleanup skipped on success via defer.commit()
- Each resource (network, volume, process) gets its own deferred cleanup

### Key VmManager Operations

| Operation | Description |
|-----------|-------------|
| create_new_vm() | Full VM creation: network + volume + process + boot wait |
| create_vm_from_commit() | Restore from snapshot: download state, recreate VM |
| commit_vm() | Pause, snapshot volume/process, upload to S3 |
| pause_vm() / resume_vm() | Firecracker state transitions |
| delete_vm() | Kill process, delete volume, release network |

### Storage Architecture

**Layers:**
1. **Application** - VmManager, BaseImageBuilder, CommitStore
2. **Ceph RBD** - image_create, snap_create, snap_protect, snap_clone
3. **Block Device** - /dev/rbd{N} mapped devices, ext4 filesystem
4. **Ceph Cluster** - Distributed object storage with replication

### RBD Operations Flow

**1. Base Image Creation:**

    image_create(name, 512M) -> device_map -> mkfs.ext4 -> mount
    -> cp rootfs/* -> umount -> device_unmap
    -> snap_create(@chelsea_base_image) -> snap_protect

**2. VM Volume Creation (Clone from Base):**

    snap_clone(base@chelsea_base_image, vm_uuid)
    -> resize(fs_size_mib) -> device_map -> mount for Firecracker

**3. Commit (Snapshot + Upload):**

    pause_vm -> snap_create(volume@commit_id)
    -> upload_to_s3 -> snap_protect -> resume_vm (optional)

### VERS to Chelsea Integration

| VERS Component | Chelsea Integration |
|----------------|---------------------|
| fleet-manager.ts | Discovers VMs via Docker labels, monitors health |
| multi-vm-manager.ts | Provisions VMs with GF(3) balanced distribution |
| Fleet Config | Specifies base images, resource limits per trit role |

**VM Creation Flow Example:**
1. VERS requests VM creation via Chelsea API
2. Chelsea clones base image snapshot
3. Resizes volume to requested size
4. Reserves network namespace + TAP device
5. Spawns Firecracker with CPU/memory limits
6. Waits for boot (ReadyService health check)
7. Returns success, VERS assigns trit role

### Filesystem Configuration

The configure-image.sh script injects:
- Network configuration scripts for VM networking
- Systemd service units for Chelsea agent
- Serial console configuration for Firecracker
- SSH host key generation on first boot
- Chelsea metadata endpoint integration

---

## CLI Features

### Keybindings

| Key | Action |
|-----|--------|
| Enter | Submit message |
| Shift+Enter | Newline |
| Tab | Autocomplete |
| Ctrl+C | Cancel/Exit |
| Page Up/Down | Scroll output |

### Commands

**Session:** /new, /sessions, /session ID

**Config:** /model, /agent, /mcp, /keys

**Other:** /help, /clear, /plan, !cmd

---

## ACP Protocol

| Method | Description |
|--------|-------------|
| session/new | Create session |
| session/prompt | Send message |
| session/cancel | Cancel request |
| fs/read_text_file | Read file |
| fs/write_text_file | Write file |
| terminal/create | Create subprocess |
| terminal/kill | Kill process |

---

## Streaming Events (SSE)

| Event | Description |
|-------|-------------|
| content_chunk | Streaming text |
| tool_call | Tool started |
| tool_result | Tool completed |
| thinking | Agent reasoning |
| completed | Task done |
| failed | Task failed |

---

## Development

    bun install         # Install dependencies
    bun run dev         # Run with hot reload
    bun test            # Run tests
    bun run build       # Compile to ./vers-agent

## Project Structure

    src/
    ├── protocol/       # ACP type definitions
    ├── server/         # HTTP server (Bun.serve)
    ├── agents/         # Agent implementations
    ├── fleet/          # Multi-VM fleet management
    │   ├── fleet-manager.ts    # Health monitoring
    │   └── multi-vm-manager.ts # GF(3) balancing
    ├── cli/            # Terminal UI (Ink/React)
    ├── core/           # Agent orchestration
    └── utils/          # Shared utilities

---

## HTTP Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| /rpc | POST | JSON-RPC handler |
| /events | GET | SSE stream |
| /health | GET | Health check |
| /metrics | GET | Prometheus metrics |

## Environment

| Variable | Required | Description |
|----------|----------|-------------|
| ANTHROPIC_API_KEY | Yes | Claude API key |
| PORT | No | Server port (default: 9999) |
| VERS_DEBUG | No | Enable debug logging |
| NGROK_AUTHTOKEN | No | ngrok auth for VM tunnels |

## Data Storage

All data stored in ~/.vers-agent/:

- sessions.db - SQLite database
- tokens.json - Authentication tokens
- config.json - User configuration
- logs/ - Rotating log files

## License

MIT
