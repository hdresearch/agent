# vers-agent

A Claude Code agent harness that runs inside a VM, exposing both an interactive CLI and HTTP API for external control.

**Key Concept**: This tool wraps the Claude Agent SDK and Claude Code CLI to provide a dual-interface system where Claude can be controlled both interactively (via CLI) and programmatically (via HTTP API). Perfect for VM-based workflows where you need both human and machine interaction with the same agent instance.

## Features

- **Interactive CLI** with Claude Code-style UI (spinners, diffs, tool previews) built with Ink (React for terminals)
- **HTTP API** for programmatic control from outside the VM
- **Multi-turn conversations** with session continuity and state management
- **Continue last conversation** across restarts (sessions persisted in SQLite)
- **Multi-user session sync** - multiple CLI clients can share the same session
- **Session management** - list, switch, and resume sessions via `/sessions` and `/session`
- **Auto-compacting** when context fills up (configurable turn limits)
- **Self-contained bundle** with Claude Code CLI included (~127MB total)
- **Remote mode** - connect CLI to a remote server via `--url`
- **Dual-mode operation** - run server + CLI simultaneously or separately
- **Docker support** - run in containers with docker-compose

## Quick Reference

```bash
# Development
bun install                    # Install dependencies
bun run dev                    # Run with hot reload
bun run typecheck              # Type check
bun test                       # Run tests

# Building
bun run build                  # Standalone executable
bun run bundle                 # Self-contained bundle

# Running
./vers-agent                   # Both CLI + Server
./vers-agent --cli             # CLI only
./vers-agent --server          # Server only
./vers-agent --url http://vm:9999  # Connect to remote

# Docker
docker compose up              # Run in container (port 9999)

# Environment
export ANTHROPIC_API_KEY=xxx   # Required
export PORT=9999               # Optional (default: 9999)
export CLAUDE_CODE_EXECUTABLE=/path/to/claude  # Optional
```

## Quick Start

```bash
# Install dependencies
bun install

# Run in development
bun run dev

# Build standalone executable
bun run build

# Run the executable
./vers-agent
```

## Usage

### CLI Mode

```bash
./vers-agent --cli
```

```
  vers-agent v1.0.0

  Type a message to chat. Use /help for commands.

❯ list the files in this directory

  💻 Bash
  ┌──────────────────┐
  │ ls -la           │
  └──────────────────┘
  ┄┄┄ output ┄┄┄
  total 120
  drwxr-xr-x  14 user  staff  448 Jan  6 14:27 .
  ...
  ✓

Here are the files...

  ✓ 2.3s · $0.0042 · 1,234 tokens

❯ /continue
  Will continue last conversation. Type your message.

↩ now explain the package.json
```

**CLI Commands:**
- `/help`, `/h` - Show help
- `/model [opus|sonnet|haiku]` - View or change model
- `/thinking [on|off] [budget]` - Toggle extended thinking
- `/continue`, `/c` - Continue the last conversation
- `/new`, `/n` - Start a new conversation
- `/sessions`, `/s` - List all sessions
- `/session <id>` - Switch to a specific session
- `/compact` - Compact conversation history
- `/mcp add|remove|list` - Manage MCP servers
- `!command` - Execute bash command directly
- `exit`, `quit` - Exit

### HTTP API Mode

```bash
./vers-agent --server
```

Server runs on port 9999 (configurable via `PORT` env var).

**Endpoints:**

```bash
# Health check
GET /health

# List all tasks
GET /tasks

# Create a new task
POST /tasks
Content-Type: application/json
{
  "prompt": "List files in the current directory",
  "config": {
    "model": "claude-sonnet-4-20250514",
    "maxTurns": 10,
    "cwd": "/path/to/work"
  }
}

# Get task status
GET /tasks/:id

# Get task events
GET /tasks/:id/events

# Stream task events (SSE)
GET /tasks/:id/stream

# Stop a running task
POST /tasks/:id/stop

# Delete a task
DELETE /tasks/:id
```

**Example:**

```bash
# Start a task
curl -X POST http://localhost:9999/tasks \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Create a hello world script"}'

# Stream events
curl -N http://localhost:9999/tasks/{id}/stream
```

### API Reference

#### Task Management

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/tasks` | GET | List all tasks |
| `/tasks` | POST | Create and start a new task |
| `/tasks/:id` | GET | Get task details (includes events) |
| `/tasks/:id/events` | GET | Get all events for a task (JSON) |
| `/tasks/:id/stream` | GET | Stream task events (SSE) |
| `/tasks/:id/stop` | POST | Stop a running task |
| `/tasks/:id` | DELETE | Delete a task |

**Create Task Body:**
```json
{
  "prompt": "Write a hello world script",
  "config": {
    "model": "claude-sonnet-4-20250514",
    "maxTurns": 10,
    "cwd": "/workspace",
    "permissionMode": "bypassPermissions"
  }
}
```

**Task Response:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "prompt": "Write a hello world script",
  "status": "running",
  "createdAt": "2026-01-06T12:00:00Z",
  "startedAt": "2026-01-06T12:00:01Z",
  "eventCount": 5
}
```

#### Configuration

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/config` | GET | Get global config |
| `/config` | PATCH | Update global config |
| `/config/model` | GET | Get current model |
| `/config/model` | POST | Set model (body: `{"model": "..."}`) |
| `/config/thinking` | GET | Get thinking mode status |
| `/config/thinking` | POST | Set thinking mode (body: `{"enabled": true, "budget": 10000}`) |

#### Session Management

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/session` | GET | Get current session info (cost, tokens, turns) |
| `/session` | POST | Resume a specific session (body: `{"sessionId": "..."}`) |
| `/session/last` | POST | Resume last session |
| `/session/reset` | POST | Reset session (start fresh) |
| `/session/compact` | POST | Compact session context |

**RPC Methods (via `/rpc`):**

| Method | Description |
|--------|-------------|
| `session/list` | List all sessions with turn counts |
| `session/load` | Switch to a specific session |
| `session/outputs` | Get all outputs for current session |
| `session/sync` | Get sync info (count, lastSeq) for incremental sync |

#### Health & Status

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check (returns `{"status": "ok"}`) |

**Example: Streaming Task Events**
```bash
curl -N http://localhost:9999/tasks/550e8400-e29b-41d4-a716-446655440000/stream
```

Output (SSE format):
```
data: {"type":"started","timestamp":"2026-01-06T12:00:01Z"}

data: {"type":"tool_use","timestamp":"2026-01-06T12:00:02Z","data":{"toolName":"Bash","toolInput":{"command":"echo 'hello'"}}}

data: {"type":"assistant_message","timestamp":"2026-01-06T12:00:03Z","data":{"text":"I've created the script."}}

data: {"type":"completed","timestamp":"2026-01-06T12:00:04Z"}
```

### Both Modes (Default)

```bash
./vers-agent
```

Runs the HTTP server and CLI simultaneously. Use the terminal for interactive work while external tools can control via HTTP.

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | HTTP server port | `9999` |
| `ANTHROPIC_API_KEY` | API key for Claude | Required |
| `CLAUDE_CODE_EXECUTABLE` | Path to Claude Code CLI | Auto-set by launcher |

### Task Config Options

```typescript
{
  model?: string;              // Claude model to use
  systemPrompt?: string;       // Custom system prompt
  maxTurns?: number;           // Max conversation turns (default: 50)
  maxBudgetUsd?: number;       // Cost limit
  allowedTools?: string[];     // Whitelist of tools
  permissionMode?: string;     // "bypassPermissions" (default) | "acceptEdits" | "default"
  cwd?: string;                // Working directory
}
```

## Building

```bash
# Type check
bun run typecheck

# Build standalone executable (requires bun on target)
bun run build

# Build self-contained bundle with Claude Code CLI
bun run bundle
```

The build creates:
```
./vers-agent             # 59MB - Standalone executable
```

## Architecture

### High-Level Overview

```
┌─────────────────────────────────────────────────────────┐
│                      VM                                 │
│  ┌───────────────────────────────────────────────────┐  │
│  │              vers-agent                           │  │
│  │                                                   │  │
│  │   ┌─────────────┐       ┌─────────────────────┐   │  │
│  │   │   CLI       │       │    HTTP Server      │   │  │
│  │   │  (stdin)    │       │    (port 9999)      │   │  │
│  │   └──────┬──────┘       └──────────┬──────────┘   │  │
│  │          │                         │              │  │
│  │          └────────┬────────────────┘              │  │
│  │                   │                               │  │
│  │          ┌────────▼────────┐                      │  │
│  │          │  Claude Agent   │                      │  │
│  │          │      SDK        │                      │  │
│  │          └────────┬────────┘                      │  │
│  │                   │                               │  │
│  │          ┌────────▼────────┐                      │  │
│  │          │  Claude Code    │                      │  │
│  │          │     CLI         │                      │  │
│  │          └─────────────────┘                      │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
         ▲
         │ HTTP
         │
    External Control
    (orchestrator, scripts, etc.)
```

### Code Structure

```
vers-agent/
├── index.ts                    # Entry point: CLI arg parsing, mode selection
├── src/
│   ├── cli/                    # Interactive CLI (React/Ink UI)
│   │   ├── cli.tsx            # Entry point (42 lines)
│   │   ├── app.tsx            # Main App component (316 lines)
│   │   ├── types.ts           # CLI type definitions
│   │   ├── constants.ts       # Commands, icons, limits
│   │   ├── components/        # UI components (7 files)
│   │   │   ├── spinner.tsx
│   │   │   ├── output-area.tsx
│   │   │   ├── input-bar.tsx
│   │   │   ├── status-bar.tsx
│   │   │   ├── top-status-bar.tsx
│   │   │   ├── command-suggestions.tsx
│   │   │   └── path-suggestions.tsx
│   │   ├── hooks/             # React hooks (2 files)
│   │   │   ├── use-acp-client.ts
│   │   │   └── use-image-attachments.ts
│   │   ├── handlers/          # Command handlers (2 files)
│   │   │   ├── command-handlers.ts
│   │   │   └── bash-handler.ts
│   │   └── utils/             # Utilities (3 files)
│   │       ├── formatting.ts
│   │       ├── command-matching.ts
│   │       └── path-completion.ts
│   ├── server/                # ACP HTTP server
│   │   └── http-server.ts
│   ├── client/                # HTTP client for ACP
│   │   └── http-client.ts
│   ├── core/                  # Agent logic
│   │   ├── agent.ts
│   │   ├── query-runner.ts
│   │   ├── prompt-queue.ts
│   │   └── tasks.ts
│   ├── protocol/              # ACP type definitions
│   │   ├── acp-types.ts
│   │   └── jsonrpc.ts
│   └── utils/                 # Shared utilities
│       ├── config.ts
│       ├── history.ts
│       ├── keys.ts
│       ├── image-utils.ts
│       ├── project-docs.ts
│       └── session-store.ts   # SQLite session/output persistence
├── tests/                     # Test files
│   ├── session-sync.test.ts   # Session sync behavior tests
│   ├── server-output-storage.test.ts  # Server storage tests
│   └── cli/
│       ├── utils/             # Utility tests
│       ├── handlers/          # Handler tests
│       └── remote-submission.test.ts
├── Dockerfile                 # Docker support
├── docker-compose.yml
└── dist/                      # Built artifacts
```

### Key Components

#### 1. **Entry Point** (`index.ts`)
- Parses command-line arguments (`--cli`, `--server`, `--url`, etc.)
- Auto-detects Claude Code executable location
- Launches appropriate mode(s)

#### 2. **Query Runner** (`src/query-runner.ts`)
- Wraps `@anthropic-ai/claude-agent-sdk`'s `query()` function
- Manages session state (continue conversations, compaction)
- Event stream transformation (converts SDK events to app events)
- Handles cancellation via AbortController

#### 3. **Task System** (`src/tasks.ts`, `src/agent.ts`)
- **TaskStore**: In-memory task registry with event subscription
- **Agent**: Orchestrates query execution, updates task state
- Each task = one conversation with Claude
- Tasks can be pending/running/completed/failed/cancelled

#### 4. **HTTP Server** (`src/server.ts`)
- RESTful API built with Bun.serve
- Endpoints for task management, config, sessions
- Server-Sent Events (SSE) for streaming task updates
- No authentication (designed for local/VM use)

#### 5. **CLI** (`src/cli/`)
- Built with Ink (React for terminals)
- Modular architecture: components, hooks, handlers, utils
- Real-time UI updates via event streams
- Slash commands (/help, /model, /continue, etc.)
- Remote bash execution via server when connected
- Can connect to local or remote server via AcpClient

#### 6. **ACP Client** (`src/client/http-client.ts`)
- HTTP client using ACP (Agent Control Protocol) over JSON-RPC 2.0
- Used by CLI to communicate with server
- Handles SSE streaming for real-time notifications
- Supports remote bash execution and working directory queries

### Data Flow

```
User Input → CLI/HTTP → Task Created → Agent.runTask()
  → QueryRunner.runQuery() → Claude Agent SDK → Claude Code CLI
  → Tool Execution → Results → Events → TaskStore → Subscribers
  → CLI UI Update / HTTP Response
```

### Session Management

- **Config**: Model, thinking budget (global, survives restarts)
- **Session**: Conversation history, cumulative cost/tokens
- **SQLite Persistence**: Sessions and outputs stored in `bun:sqlite` database
- **Last Session ID**: Persisted to enable `/continue` across restarts
- **Compaction**: When context limit reached, old turns are summarized/removed

#### Multi-User Session Sync

When multiple CLI clients connect to the same server (remote mode), they can share sessions:

1. **Server stores all outputs** - User messages, assistant responses, tool calls, and tool results are stored in SQLite
2. **CLI syncs on connect** - When a CLI loads a session, it fetches all outputs from the server
3. **Incremental sync** - Uses sequence numbers for efficient sync after initial load
4. **Remote vs Local mode**:
   - **Local mode** (`--cli` without `--url`): History loaded from local file (`~/.vers-agent/history.json`)
   - **Remote mode** (`--url http://server:9999`): History loaded from server, local file ignored

This enables workflows where Person A starts a session, Person B connects and sees the full history, and both can continue the conversation.

## Development Guide

### Prerequisites

- **Bun** (not Node.js) - this project uses Bun runtime and APIs
- **Claude Code CLI** - auto-detected or set via `CLAUDE_CODE_EXECUTABLE`
- **TypeScript** - peer dependency for type checking

### Common Tasks

#### Running in Development
```bash
# Hot reload mode (CLI + Server)
bun run dev

# CLI only (connects to localhost:9999)
bun run index.ts --cli

# Server only
bun run index.ts --server
```

#### Type Checking
```bash
bun run typecheck
```

#### Building
```bash
# Build standalone executable (requires Bun on target system)
bun run build          # Creates ./vers-agent (59MB)

# Build self-contained bundle with Claude Code CLI
bun run bundle         # Creates dist/ directory (~127MB)
```

#### Testing the Build
```bash
./vers-agent --help
./vers-agent --cli
```

### Key Files to Modify

| Want to... | Edit this file |
|------------|----------------|
| Add new CLI slash commands | `src/cli/handlers/command-handlers.ts` |
| Add CLI command constants | `src/cli/constants.ts` (COMMANDS array) |
| Add new API endpoints | `src/server/http-server.ts` (fetch handler) |
| Change task lifecycle | `src/core/agent.ts` (runTask function) |
| Modify event handling | `src/core/query-runner.ts` (runQuery function) |
| Add task state fields | `src/core/tasks.ts` (Task interface) |
| Change session behavior | `src/utils/config.ts` |
| Change session storage | `src/utils/session-store.ts` |
| Add tool icons | `src/cli/constants.ts` (TOOL_ICONS object) |
| Add new CLI components | `src/cli/components/` directory |
| Add new CLI hooks | `src/cli/hooks/` directory |
| Change bash escape handling | `src/cli/handlers/bash-handler.ts` |

### Debugging Tips

#### CLI Not Connecting
```bash
# Check if server is running
curl http://localhost:9999/health

# Verify API client URL
echo $VERS_AGENT_URL  # Should be http://localhost:9999 or empty
```

#### Claude Code Not Found
```bash
# Manually set the path
export CLAUDE_CODE_EXECUTABLE=/path/to/claude

# Or use the bundled version
export CLAUDE_CODE_EXECUTABLE=./dist/claude-code/cli.js
```

#### Session Not Continuing
- Sessions are stored in SQLite (survives restarts)
- Check `src/utils/session-store.ts` for session storage logic
- Use `curl http://localhost:9999/session` to inspect session state
- In remote mode, ensure CLI is connecting to the correct server URL

#### Task Events Not Appearing
- Enable verbose logging in `src/agent.ts` (add console.log in event loop)
- Check browser DevTools if using SSE endpoint
- Verify task status: `curl http://localhost:9999/tasks/{id}`

### Understanding the Event System

Events flow through three layers:

1. **Claude Agent SDK events** (from `@anthropic-ai/claude-agent-sdk`)
   - Raw events from the SDK: `apiRequestStarted`, `apiResponseChunk`, etc.

2. **QueryRunner events** (`src/query-runner.ts`)
   - Normalized events: `text_delta`, `tool_use`, `result`, etc.
   - These are what the rest of the app consumes

3. **Task events** (`src/tasks.ts`)
   - Persisted events: `started`, `assistant_message`, `completed`, etc.
   - Stored in task.events array for API retrieval

### Architecture Decisions

#### Why Bun?
- Fast startup time (critical for CLI responsiveness)
- Built-in TypeScript support (no build step for dev)
- Modern APIs (Bun.serve, Bun.file, etc.)
- `--compile` flag for standalone executables

#### Why Ink (React for terminals)?
- Declarative UI updates (easier than imperative terminal manipulation)
- Handles complex layouts (spinners, multiline input, etc.)
- Hot reload in development

#### Why SQLite for Sessions?
- Lightweight (no external database)
- Persistent (survives restarts)
- Multi-user sync (multiple CLI clients can share sessions)
- Built-in to Bun (`bun:sqlite`)

#### Why In-Memory Task Storage?
- Tasks are ephemeral (short-lived agent executions)
- Fast (no I/O for real-time event streaming)
- Sessions handle long-term persistence separately

#### Why Separate CLI and Server?
- Flexibility (run headless, or interactive, or both)
- Remote mode (CLI on laptop, server in VM)
- Multiple clients (multiple CLIs, external scripts, etc.)

### Extending the Project

#### Adding a New Endpoint

1. Add route handler in `src/server.ts`:
```typescript
if (path === "/my-endpoint" && method === "GET") {
  return json({ data: "hello" });
}
```

2. Add client method in `src/api-client.ts`:
```typescript
async myEndpoint(): Promise<{ data: string }> {
  const res = await fetch(`${this.baseUrl}/my-endpoint`);
  return res.json();
}
```

3. Use in CLI (`src/cli.tsx`):
```typescript
const result = await apiClient.myEndpoint();
```

#### Adding a New CLI Command

1. Add to COMMANDS array in `src/cli/constants.ts`:
```typescript
{ name: "mycommand", alias: "mc", description: "Do something" }
```

2. Add handler in `src/cli/handlers/command-handlers.ts`:
```typescript
case "mycommand":
  ctx.addOutput({ type: "system", content: "Command executed" });
  return { handled: true };
```

3. Add tests in `tests/cli/handlers/command-handlers.test.ts`:
```typescript
test("handles /mycommand", () => {
  const ctx = createMockContext();
  const result = handleSlashCommand("/mycommand", ctx);
  expect(result.handled).toBe(true);
});
```

#### Adding a New Config Option

1. Add to `GlobalConfig` type in `src/config.ts`
2. Add getter/setter functions
3. Add API endpoint in `src/server.ts`
4. Add CLI command in `src/cli.tsx`

### Troubleshooting

#### "Claude Code executable not found"
- Install: `npm install -g @anthropic-ai/claude-code`
- Or build: `bun run build` and use `./vers-agent`
- Or set manually: `export CLAUDE_CODE_EXECUTABLE=/path/to/claude`

#### "Port 9999 already in use"
- Change port: `PORT=9998 bun run dev`
- Or kill existing process: `lsof -ti:9999 | xargs kill`

#### "Module not found" errors
- Run `bun install` to ensure dependencies are installed
- Check `package.json` for correct package names

#### Task stuck in "running" state
- Task was interrupted (Ctrl+C, process killed)
- Server restart clears in-memory tasks
- Or use stop endpoint: `curl -X POST http://localhost:9999/tasks/{id}/stop`

## Implementation Notes

### Important Gotchas

1. **CLI always connects to server** - Even in "CLI-only" mode, the CLI is an HTTP client. It connects to localhost:9999 by default or the URL specified with `--url`.

2. **Task vs Query vs Session** - These are different concepts:
   - **Task**: A single API request with prompt + config (lives in TaskStore)
   - **Query**: The execution of a task (handled by QueryRunner)
   - **Session**: Accumulated conversation history across multiple tasks

3. **Event types are duplicated** - There are three event type systems:
   - SDK events (from Claude Agent SDK)
   - QueryRunner events (`src/query-runner.ts`)
   - Task events (`src/types.ts`)

   This is intentional - each layer has different concerns.

4. **Sessions are SQLite-backed** - Sessions and outputs are stored in SQLite via `bun:sqlite`. This allows sessions to survive server restarts. See `src/utils/session-store.ts`.

5. **No authentication** - The HTTP API has no auth. This is by design (VM/localhost use case). Add middleware in `src/server.ts` if needed.

6. **Bun-specific APIs** - This code uses `Bun.serve`, `Bun.file`, etc. It won't work with Node.js without rewrites.

### Performance Considerations

- **Event streaming overhead**: Every task event is stored in memory. For long conversations, this can grow large. Consider adding an event limit or pruning old events.

- **No rate limiting**: The API has no rate limiting. External callers could overwhelm the server.

- **Single-threaded**: Bun is single-threaded. Heavy compute in handlers blocks everything. Use `Bun.$` for CPU-intensive work.

- **SSE connections**: Each SSE stream holds an open connection. Too many concurrent streams could exhaust resources.

### Security Notes

- **No input validation**: API endpoints trust input data. Add validation if exposing to untrusted clients.

- **Arbitrary code execution**: Claude can execute arbitrary bash commands. This is intentional but means the server should run in a sandboxed environment.

- **No CORS**: Server doesn't set CORS headers. Add if needed for browser-based clients.

### Future Improvements

Some ideas for extending this project:

- [x] Add database persistence (SQLite via `bun:sqlite`)
- [ ] Add authentication (API keys, JWT)
- [ ] Add task queuing (only run N tasks concurrently)
- [ ] Add metrics endpoint (Prometheus format)
- [ ] Add log streaming (tail -f style for debugging)
- [x] Add Docker support (Dockerfile, docker-compose)
- [x] Add tests (Bun has built-in test runner)
- [ ] Add web UI (Bun can serve HTML + React)
- [ ] Add cost tracking per user/session
- [x] Add support for multiple concurrent sessions
- [ ] Add transcript export (JSON, Markdown)

### Dependencies

Key dependencies and why they're used:

- **`@anthropic-ai/claude-agent-sdk`**: Core SDK for Claude Code agent functionality
- **`ink`**: React renderer for terminal UIs (powers the CLI)
- **`ink-multiline-input`**: Multiline text input for CLI
- **`chalk`**: Terminal color formatting
- **`boxen`**: Terminal boxes/borders
- **`ora`**: Terminal spinners

All dependencies are pinned in `bun.lock` for reproducibility.

### Testing

Run tests with:
```bash
bun test
```

Current test coverage:
- **`tests/session-sync.test.ts`** - Session output storage and multi-user sync
- **`tests/server-output-storage.test.ts`** - Server output storage integration
- **`tests/cli/utils/formatting.test.ts`** - formatTokens, formatToolArgs utilities
- **`tests/cli/utils/command-matching.test.ts`** - Command matching and path extraction
- **`tests/cli/handlers/command-handlers.test.ts`** - Slash command handler logic
- **`tests/cli/remote-submission.test.ts`** - Remote server submission flow

Test structure follows source structure:
```
tests/
├── session-sync.test.ts
├── server-output-storage.test.ts
└── cli/
    ├── utils/
    │   ├── formatting.test.ts
    │   └── command-matching.test.ts
    ├── handlers/
    │   └── command-handlers.test.ts
    └── remote-submission.test.ts
```

Adding new tests:
```typescript
import { describe, test, expect, mock, beforeEach } from "bun:test";

test("my test", () => {
  expect(myFunction()).toBe(expectedValue);
});
```

## License

MIT
