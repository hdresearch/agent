# Branch: pranav/visualize - Development Journey

This document captures the architectural decisions, features implemented, and lessons learned during development on the `pranav/visualize` branch starting Friday morning.

## Initial Goals

The primary objective was to create a **vers-agent** that provides:
1. An interactive CLI experience for chatting with Claude Code
2. VM orchestration capabilities using Vers VMs
3. A visual "canvas" for viewing VM branching/tree structures
4. Seamless experience where someone can clone the repo, run `./vers-agent`, and immediately interact with Claude Code + VMs

## Architecture Overview

### Core Design: ACP (Agent Client Protocol)

vers-agent implements the Agent Client Protocol using JSON-RPC 2.0:

```
┌─────────────────────────────────────────────────────────────────────┐
│                           vers-agent                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐  │
│  │    CLI      │────▶│   HTTP Client    │────▶│  Remote Server  │  │
│  │  (Ink/React)│     │  (http-client.ts)│     │  or localhost   │  │
│  └─────────────┘     └──────────────────┘     └─────────────────┘  │
│                              │                        │             │
│                              │ JSON-RPC               │             │
│                              │ + SSE                  │             │
│                              ▼                        ▼             │
│  ┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐  │
│  │  Handlers   │────▶│   HTTP Server    │────▶│  Agent Runner   │  │
│  │  (server/)  │     │  (http-server.ts)│     │  (subprocess)   │  │
│  └─────────────┘     └──────────────────┘     └─────────────────┘  │
│                                                       │             │
│                                                       ▼             │
│                                               ┌─────────────────┐  │
│                                               │  Claude Code    │  │
│                                               │  (subprocess)   │  │
│                                               └─────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Components

1. **HTTP Server** (`src/server/http-server.ts`)
   - Handles JSON-RPC requests at `/rpc`
   - SSE stream for real-time notifications at `/events`
   - Web shell UI at `/shell`
   - Claim/auth system for access control

2. **HTTP Client** (`src/client/http-client.ts`)
   - Connects to server via JSON-RPC
   - Subscribes to SSE events
   - Handles token-based authentication

3. **Agent Runner** (`src/agents/agent-runner.ts`)
   - Spawns Claude Code as subprocess (`claude-code-acp --dangerously-skip-permissions`)
   - Communicates via JSON-RPC over stdin/stdout
   - Maps ACP events to internal event system

4. **CLI** (`src/cli/`)
   - Built with Ink (React for terminal)
   - Components: TopStatusBar, OutputArea, InputBar, BranchTree, etc.
   - Hooks: useAcpClient for managing server connection

5. **VM Integration** (`src/vm/`)
   - Interfaces with Vers SDK for VM management
   - SSH execution on VMs
   - File upload/download

6. **Canvas/Tree Visualization** (`src/canvas/`)
   - TreeBuilder: Converts VM data to tree structure
   - TreeState: Manages tree state with subscriptions
   - BranchTree component: Terminal UI for tree visualization

## Features Implemented

### 1. Interactive CLI with Claude Code
- Server starts on port 9999 (or next available)
- CLI connects via HTTP and SSE
- Real-time streaming of Claude's responses
- Command history with up/down arrows
- Slash commands (`/new`, `/model`, `/connect`, etc.)
- Bash mode (prefix with `!`)

### 2. VM Orchestration
- Create VMs from golden images
- Branch VMs (copy-on-write snapshots)
- Execute commands on VMs
- Upload files to VMs
- `/orchestrate` skill for multi-VM workflows

### 3. Canvas/Tree Visualization
- Visual DAG of VM branching
- Status indicators (running, completed, failed)
- Clickable terminal hyperlinks to VM shells
- Real-time updates via SSE

### 4. Authentication System
- VERS_API_KEY for API access
- Localhost auto-authentication (no key needed locally)
- Token derivation for VM agents

## Key Decisions Made

### Decision 1: Ink for Terminal UI
**Choice:** Use Ink (React for terminal) for the CLI
**Rationale:**
- Declarative UI model
- Component reusability
- Hot reloading during development
- Rich ecosystem of Ink components

**Issue Discovered:** Ink's `useInput` hook is broken with Bun - it doesn't receive keyboard events at all. Raw stdin works, but Ink's abstraction fails silently.

### Decision 2: Separate Server + CLI
**Choice:** Run HTTP server and CLI together, CLI connects via HTTP
**Rationale:**
- Enables remote CLI connections
- Server can run headless (daemon mode)
- Same protocol for local and remote
- Web UI can use same endpoints

### Decision 3: Claude Code as Subprocess
**Choice:** Spawn `claude-code-acp` as subprocess, communicate via stdin/stdout
**Rationale:**
- Leverages Claude Code's existing capabilities
- ACP protocol is standardized
- Clean separation of concerns

### Decision 4: SSH Fallback for ed25519 Keys
**Issue:** The `ssh2` npm library couldn't parse ed25519 keys in OpenSSH format
**Solution:** Added fallback to system `ssh` command via subprocess when ssh2 fails

```typescript
// In src/vm/index.ts
export async function execute(vmId: string, command: string): Promise<ExecuteResult> {
  try {
    return await vm.execute(vmId, command);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("ed25519") || message.includes("Cannot parse privateKey")) {
      return executeViaSystemSSH(vmId, command);
    }
    throw err;
  }
}
```

### Decision 5: Golden Image Management
**Issue:** VMs restored from golden images had stale auth tokens
**Solution:**
- Clean VM state (remove auth.db, tokens.json, sessions.db)
- Upload fresh vers-agent binary
- Commit new golden image
- Store commit ID in `.env` as `VERS_GOLDEN_COMMIT_ID`

### Decision 6: Localhost Auto-Auth
**Issue:** CLI was prompting for token when connecting to localhost
**Solution:** Check `isLocalhostRequest()` BEFORE checking `hasAuth()` in claim endpoint

```typescript
// No key provided - localhost gets automatic access regardless of auth config
if (isLocal) {
  return Response.json({
    claimed: hasAuth(),
    isOwner: true,
    message: "Localhost access allowed without API key",
  }, { headers: corsHeaders });
}
```

## Files Modified/Created on This Branch

### Core Files
- `index.ts` - Entry point, CLI/server startup logic
- `src/server/http-server.ts` - HTTP server with auth fixes
- `src/client/http-client.ts` - HTTP client for ACP
- `src/vm/index.ts` - VM operations with SSH fallback

### CLI Components
- `src/cli/app.tsx` - Main CLI application
- `src/cli/cli.tsx` - CLI entry point
- `src/cli/components/branch-tree.tsx` - Tree visualization
- `src/cli/components/branch-popup.tsx` - VM creation popup
- `src/cli/components/top-status-bar.tsx` - Status bar with VM stats
- `src/cli/hooks/use-acp-client.ts` - ACP client hook

### Canvas/Tree
- `src/canvas/index.ts` - Canvas exports
- `src/canvas/tree-builder.ts` - Build tree from VM data
- `src/canvas/tree-state.ts` - Tree state management

## Issues Encountered

### 1. Ink + Bun Incompatibility (BLOCKING)
**Symptom:** `useInput` hook never receives keyboard events
**Impact:** CLI renders but user cannot type anything
**Root Cause:** Unknown - raw stdin works, but Ink's useInput abstraction fails
**Status:** Unresolved - considering ripping out Ink

### 2. SSH ed25519 Key Parsing
**Symptom:** `Cannot parse privateKey: Unsupported OpenSSH private key type: ssh-ed25519`
**Impact:** VM execution failed
**Solution:** System SSH fallback
**Status:** Resolved

### 3. Golden Image Auth Mismatch
**Symptom:** `Invalid token` when authenticating with derived token
**Impact:** Couldn't communicate with VMs
**Solution:** Updated golden image with new auth code
**Status:** Resolved

### 4. Claim Endpoint Localhost Detection
**Symptom:** CLI prompts for token even on localhost
**Impact:** Poor local development experience
**Solution:** Check localhost before checking hasAuth()
**Status:** Resolved

### 5. React Duplicate Key Warnings
**Symptom:** Console warnings about duplicate keys
**Impact:** Minor - cosmetic warnings
**Solution:** Fixed key generation in output-area.tsx
**Status:** Resolved

## What Works

1. **Server** - HTTP server starts correctly on port 9999
2. **Claude Code Integration** - Subprocess communication works
3. **Prompts** - Sending prompts and receiving responses works
4. **SSE Streaming** - Real-time event streaming works
5. **VM Operations** - Create, branch, execute all work
6. **Web Shell** - `/shell` endpoint serves web UI
7. **Auth** - Localhost auto-auth and API key auth work

## What Doesn't Work

1. **CLI Input** - Cannot type due to Ink/Bun incompatibility
2. **Interactive Canvas** - Keyboard navigation broken (same root cause)

## Recommended Next Steps

### Option A: Fix Ink
- Debug why `useInput` doesn't work with Bun
- File issue with Ink or Bun maintainers
- May require deep debugging of Ink internals

### Option B: Replace Ink (Recommended)
- Use raw terminal handling with ANSI escape codes
- Libraries to consider:
  - `blessed` / `blessed-contrib` - Full terminal UI toolkit
  - `terminal-kit` - Terminal manipulation library
  - Custom implementation with raw stdin + ANSI
- Would require rewriting CLI components

### Option C: Different Approach
- Focus on web UI instead of terminal UI
- The `/shell` endpoint already serves a web interface
- Could make this the primary interface

## Environment

- **Runtime:** Bun
- **Package Manager:** Bun
- **Build:** `bun build --compile`
- **Key Dependencies:**
  - ink: ^6.6.0
  - react: ^19.2.3
  - ink-multiline-input: ^0.1.0

## Test Commands

```bash
# Build
bun run build

# Run (server + CLI)
./vers-agent

# Run server only
./vers-agent --server

# Run from source
bun run start

# Test server endpoints
curl -X POST http://localhost:9999/claim
curl -X POST http://localhost:9999/rpc -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"test","version":"1.0.0"}}}'
```

## Configuration

Key environment variables in `.env`:
```
ANTHROPIC_API_KEY=...          # Claude API key
VERS_API_KEY=...               # Vers platform API key
VERS_BASE_URL=...              # Vers API endpoint
VERS_GOLDEN_COMMIT_ID=...      # Golden image commit ID
```

---

*Document created: January 26, 2026*
*Branch: pranav/visualize*
