# Flox + Chelsea + Agent Integration Design

## Overview

This document describes how Flox environments integrate with Chelsea VM images and the vers-agent system to enable **user-driven, reproducible VM image design**.

## Architecture

The integration creates a pipeline:
1. User describes requirements conversationally
2. Agent generates Flox manifest.toml
3. Flox containerize produces OCI image
4. Chelsea converts to Ceph RBD base image
5. VMs can be cloned from the base image

## Integration Points

### 1. Flox MCP Server

The flox-mcp-server package enables MCP-based interaction:

**MCP Tools Available:**
- init_new_environment - Create new Flox environment
- install_package - Add packages to environment  
- search_packages - Search Nix package catalog
- show_package - Get package versions/details
- run_command - Execute commands in Flox context
- list_installed_packages - Show current packages

### 2. vers-agent Flox Environment

The agent has its own Flox environment (agent/.flox/) with:
- Runtime: bun, bash, sqlite
- Chelsea packages: curl, wget, e2fsprogs, squashfsTools
- Network: iproute2, netcat, openssh, ngrok
- Services: acp server, ngrok tunnel
- Containerize config for Chelsea compatibility

### 3. FloxHub for Environment Sharing

Published environments can be composed via include:
- bmorphism/effective-topos (606 man pages, guile, ghc)
- bmorphism/ies (babashka, julia, ffmpeg, tailscale)

## User-Driven Image Design Workflow

### Step 1: Conversational Requirements

User describes needs, agent parses and searches packages.

### Step 2: Flox Environment Generation

Agent uses Flox MCP to:
1. Search packages (e.g. pytorch variants)
2. Create environment in temp directory
3. Install packages via install_package
4. Configure services in manifest.toml

### Step 3: Containerization

Run flox containerize to produce OCI tar.

### Step 4: Chelsea Image Creation

POST to /api/images/create with upload source type.
Pipeline: Upload -> Extract -> Configure -> CreateRBD -> Snapshot

### Step 5: VM Deployment

Create VM from base image. Chelsea clones, resizes, spawns Firecracker.

## GF(3) Trit Assignment for Images

| Trit | Image Type | Example |
|------|------------|---------|
| -1 (MINUS) | Validation/Security | security-scanner-v1 |
| 0 (ERGODIC) | Infrastructure | load-balancer-v1 |
| +1 (PLUS) | Generation/ML | ml-workspace-v1 |

## Template Library

| Template | Packages | Services | Use Case |
|----------|----------|----------|----------|
| ml-pytorch | python312, pytorch, jupyter | jupyter | ML development |
| web-node | nodejs_20, postgresql | db, api | Web backend |
| rust-dev | rustc, cargo, rust-analyzer | - | Rust development |
| data-science | python312, pandas, duckdb | jupyter | Data analysis |
| vers-agent | bun, sqlite, ngrok | acp, tunnel | Agent deployment |

## Implementation Checklist

- [ ] Add /image CLI command to vers-agent
- [ ] Create src/utils/flox-client.ts wrapper
- [ ] Create src/utils/chelsea-client.ts for API
- [ ] Add image design templates
- [ ] Implement progress streaming
- [ ] Add FloxHub push/pull commands
- [ ] Create GF(3) trit assignment logic
- [ ] Write tests for full workflow

## References

- Flox: https://flox.dev/docs
- Chelsea: https://github.com/hdresearch/chelsea
- FloxHub: https://hub.flox.dev
- ACP Protocol: https://agentclientprotocol.com
