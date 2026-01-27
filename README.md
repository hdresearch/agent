# vers-agent

[![CI](https://github.com/hdresearch/agent/actions/workflows/ci.yml/badge.svg)](https://github.com/hdresearch/agent/actions/workflows/ci.yml)

ACP-compliant agent harness with dual CLI/HTTP interface. Run AI coding agents like Claude Code through a unified protocol with session persistence, streaming updates, and multi-agent support.

## Quick Start

```bash
# Install via script (recommended)
curl -fsSL https://raw.githubusercontent.com/hdresearch/agent/main/install.sh | bash

# Or build from source
git clone https://github.com/hdresearch/agent.git && cd agent
bun install && bun run build
./vers-agent
```

## What is ACP?

[Agent Client Protocol](https://agentclientprotocol.com/) is a JSON-RPC 2.0 based protocol for controlling AI agents.

vers-agent implements ACP to provide:

- **Session management** - Create, load, list, and persist sessions with SQLite storage
- **Streaming notifications** - Real-time tool use, text deltas, thinking, and completion events via SSE
- **Capability negotiation** - Clients declare what they support (filesystem, terminal, MCP)
- **Multi-agent support** - Switch between different ACP-compatible agents (Claude Code, Codex, etc.)
- **Permission handling** - Interactive approval for file writes, command execution, etc.
- **Plan mode** - Toggle between planning and execution modes

## Architecture

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
│                                               │  (or other ACP  │  │
│                                               │   agents)       │  │
│                                               └─────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### Remote Mode

vers-agent can connect to remote servers (e.g., running on Vers VMs):

```bash
# Connect to remote server
./vers-agent --url http://34.204.180.108:9999

# Or use /connect command from CLI
/connect http://34.204.180.108:9999

# Return to local mode
/local
```

The CLI remembers your last server and auto-reconnects on restart.

## Modes

| Command | Description |
|---------|-------------|
| `vers` | HTTP server only (default) |
| `vers --cli` | Interactive CLI, connects to localhost:9999 |
| `vers --mcp` | MCP server for Claude integration (stdio) |
| `vers --mcp-install` | Install MCP config without starting server |
| `vers --url http://host:9999` | CLI connecting to remote server |
| `vers --local` | Clear saved remote server, use local |

### MCP Server

Run `vers --mcp` to expose VM orchestration tools to Claude via MCP.

**Auto-install**: The first time you run `vers --mcp`, it automatically configures both Claude Desktop and Claude Code:
- Claude Desktop: `~/.claude/claude_desktop_config.json`
- Claude Code: `~/.claude.json`

You can also run `vers --mcp-install` to configure MCP without starting the server (this runs automatically during `install.sh`).

**Available tools**: `vers_vms`, `vers_vm_create`, `vers_vm_run`, `vers_exec`, `vers_vm_sync`, `vers_vm_eval`, `vers_vm_status`, `vers_vm_wait`, `vers_run`, `vers_health`, `vers_config_get`, `vers_config_set`, `vers_cancel`

### CLI Subcommands

Run commands directly without the interactive CLI:

```bash
vers run "fix the bug"       # Send prompt and stream response
vers vms                     # List VMs
vers vm create "task"        # Create a new VM
vers vm run "prompt"         # Run prompt on all VMs
vers exec <vmId> "ls -la"    # Execute command on VM
vers vm sync <vmId>          # Sync git to VM
vers vm eval <vmId>          # Evaluate VM (build/test/lint)
vers health                  # Check server health
vers config                  # Show configuration
vers help                    # Show all commands
```

## vers-tui (Rust TUI)

A high-performance terminal UI built with [Ratatui](https://ratatui.rs/). Alternative to the Ink-based CLI with VM canvas visualization.

### Installation

```bash
cd vers-tui && cargo build --release
```

### Usage

```bash
# Connect to local vers-agent
./vers-tui/target/release/vers-tui --url http://localhost:9999

# Run on a fresh Vers VM (auto-creates VM)
./vers-tui/target/release/vers-tui --cloud

# Specify bootstrap server for VM creation
./vers-tui/target/release/vers-tui --cloud --bootstrap http://localhost:10000
```

### CLI Options

| Option | Description |
|--------|-------------|
| `-u, --url <URL>` | Server URL to connect to (default: `http://localhost:9999`) |
| `--cloud` | Create a fresh Vers VM and connect to it |
| `--bootstrap <URL>` | Bootstrap server URL for VM creation (default: `http://localhost:9999`) |
| `-d, --debug` | Enable debug logging |

### Features

- **Chat interface** - Streaming responses with markdown rendering
- **Canvas view** (`/canvas`) - DAG tree visualization of Vers VMs
- **VM actions** - Create, branch, delete, ping, connect to VMs
- **Keyboard navigation** - Vi-style keybindings (j/k for up/down)

### Canvas Keybindings

| Key | Action |
|-----|--------|
| `↑/k` | Move selection up |
| `↓/j` | Move selection down |
| `Enter` | Connect to selected VM |
| `c` | Create new VM |
| `b` | Branch from selected VM |
| `d` | Delete selected VM |
| `p` | Ping VM (check if alive) |
| `r` | Refresh VM list |
| `q/Esc` | Return to chat view |

---

## CLI Features

### Terminal UI

Built with [Ink](https://github.com/vadimdemedes/ink) (React for terminals):

- **Top status bar** - Model, connection status, session ID, agent name
- **Output area** - Windowed rendering with scroll support, tool collapsing
- **Input bar** - Multiline input with command/path suggestions
- **Permission dialog** - Interactive approval with keyboard navigation

### Keybindings

| Key | Action |
|-----|--------|
| `Enter` | Submit message |
| `Shift+Enter` | Newline in multiline mode |
| `Tab` | Autocomplete command or path |
| `Up/Down` | Navigate suggestions or history |
| `Ctrl+C` | Cancel running query / Clear input / Exit |
| `ESC` | Cancel running query |
| `Page Up/Down` | Scroll output |
| `Ctrl+A/E` | Beginning/end of line |
| `Ctrl+K/U` | Kill to end/beginning of line |
| `Ctrl+W` | Kill word backward |

### Commands

**Session Management:**
- `/new`, `/n` - Start new conversation
- `/continue`, `/c` - Continue last conversation
- `/sessions`, `/s` - List sessions
- `/session <id>` - Switch session (supports prefix matching)

**Configuration:**
- `/model`, `/m` - Change model (sonnet/opus/haiku)
- `/agent`, `/a` - List/select/check agent status
- `/mcp` - Manage MCP servers (list/add/remove)
- `/keys`, `/k` - Show/sync API keys
- `/reload`, `/r` - Re-inject CLAUDE.md/AGENT.md

**Other:**
- `/help`, `/h` - Show available commands
- `/clear` - Clear output
- `/plan`, `/p` - Toggle plan mode
- `/usage`, `/u` - Show token usage stats
- `/docs`, `/d` - Show loaded project docs
- `!<command>` - Execute bash command

### Path Completion

Type `@` followed by a path to get file/directory suggestions:
- `@src/` - Lists files in src directory
- `@./` - Lists files in current directory
- `@~/` - Lists files in home directory

## ACP Methods

### Core Protocol

| Method | Description |
|--------|-------------|
| `initialize` | Negotiate capabilities, exchange client/agent info |
| `authenticate` | Token-based auth (first client claims server) |

### Session Management

| Method | Description |
|--------|-------------|
| `session/new` | Create a new conversation session |
| `session/load` | Resume an existing session |
| `session/list` | List all sessions |
| `session/prompt` | Send a message, receive streaming response |
| `session/cancel` | Cancel an in-progress request |
| `session/set_mode` | Switch between default/plan modes |
| `session/outputs` | Get session output history |
| `session/sync` | Sync session state |

### Agent Management

| Method | Description |
|--------|-------------|
| `agent/list` | List available agents |
| `agent/select` | Switch to a different agent |
| `agent/status` | Get current agent status |

### File System (Bidirectional)

| Method | Description |
|--------|-------------|
| `fs/read_text_file` | Read file contents |
| `fs/write_text_file` | Write file contents |
| `fs/list_directory` | List directory contents |

### Terminal

| Method | Description |
|--------|-------------|
| `terminal/create` | Create a terminal subprocess |
| `terminal/output` | Get terminal output |
| `terminal/wait_for_exit` | Wait for terminal to exit |
| `terminal/kill` | Kill terminal subprocess |

### Permissions

| Method | Description |
|--------|-------------|
| `session/request_permission` | Request user permission for an action |
| `permission/respond` | Respond to a permission request |
| `permission/cancel` | Cancel a permission request |

## Streaming Notifications

Events sent via SSE (`GET /events`):

| Event | Description |
|-------|-------------|
| `content_chunk` | Streaming text with `final` flag |
| `tool_call` | Tool execution started |
| `tool_result` | Tool execution completed |
| `thinking` | Agent reasoning/planning |
| `permission_request` | Permission needed from user |
| `available_commands` | Agent command updates |
| `mode_update` | Session mode changed |
| `cost_update` | Token/cost metrics |
| `completed` | Task completed |
| `failed` | Task failed |
| `cancelled` | Task cancelled |

## Agent System

### Agent Registry

Agents are discovered from JSON files in `src/data/agents/`:

```json
{
  "identity": "claude.com",
  "name": "Claude Code",
  "shortName": "claude",
  "protocol": "acp",
  "type": "coding",
  "runCommand": { "*": "claude-code-acp" }
}
```

### Subprocess Management

- Agents run as subprocesses communicating via JSON-RPC over stdin/stdout
- Activity-based timeouts (resets on any message, allowing long tasks)
- Automatic agent installation if not present

### Permission Flow

1. Agent requests permission via `session/request_permission`
2. CLI displays interactive permission dialog
3. User selects: allow_once, allow_always, reject_once, reject_always
4. Response sent back to agent

## Development

```bash
bun install         # Install dependencies
bun run dev         # Run with hot reload
bun run typecheck   # Type check
bun test            # Run all tests
bun run build       # Compile to ./vers-agent
```

## Testing

### Unit Tests

```bash
bun test                              # Run all 456 tests
bun test tests/core/tasks.test.ts    # Run specific file
```

**Coverage areas:**
- Protocol: JSON-RPC 2.0 validation, request tracking, error codes
- Core: Task management, state transitions, event handling
- CLI: Input handling, command matching, path expansion
- Agents: ACP client/server, subprocess management, registry
- Utils: Config persistence, session storage, authentication

### Integration Tests

```bash
./vers-agent --server &   # Start server
bun test tests/integration/  # Run integration tests
```

Tests session persistence, resume behavior, output sync, and multi-agent scenarios.

### VT Sequence Tests

Interactive terminal parsing tests:

```bash
bun scripts/vt-spam.ts       # 146+ VT sequences (SGR, CSI, OSC, ESC, DCS)
bun scripts/vt-fuzz.ts       # Random/malformed sequence fuzzer
bun scripts/vt-live-parse.ts # Parser state machine visualization
bun scripts/vt-pty-test.ts   # PTY-based testing
```

## Project Structure

```
src/
├── protocol/           # ACP type definitions
│   ├── acp-types.ts    # Session, capabilities, methods (50+ types)
│   └── jsonrpc.ts      # JSON-RPC 2.0 message types
├── server/             # ACP HTTP server (Bun.serve)
│   ├── http-server.ts  # Main server and RPC router
│   ├── sse-manager.ts  # SSE client management
│   └── handlers/       # RPC method handlers
│       ├── queue.ts    # Queue management
│       ├── filesystem.ts # File system operations
│       ├── permission.ts # Permission handling
│       ├── bash.ts     # Bash execution
│       └── agent.ts    # Agent management
├── agents/             # Agent implementations
│   ├── agent-runner.ts # Subprocess agent orchestration
│   ├── acp-client.ts   # ACP client for subprocess communication
│   ├── acp-server.ts   # ACP server for handling agent requests
│   ├── subprocess-manager.ts # Process lifecycle and I/O
│   ├── event-mapper.ts # ACP event to PromptEvent mapping
│   ├── content-builder.ts # Content block construction
│   ├── registry.ts     # Agent registry and discovery
│   └── configs/        # Agent-specific configurations
├── client/             # HTTP client for ACP
│   └── http-client.ts  # ACP HTTP client with SSE support
├── cli/                # Terminal UI (Ink/React)
│   ├── app.tsx         # Main app component
│   ├── cli.tsx         # Entry point
│   ├── components/     # UI components
│   │   ├── input-bar.tsx
│   │   ├── output-area.tsx
│   │   ├── permission-dialog.tsx
│   │   └── ...
│   ├── handlers/       # Command handlers
│   └── hooks/          # React hooks (useAcpClient, etc.)
├── core/               # Agent orchestration
│   └── agent-manager.ts # High-level agent control
├── mcp/                # MCP server
│   └── server.ts       # MCP tools for Claude integration
└── utils/              # Shared utilities
    ├── config.ts       # Application configuration
    ├── session-store.ts # SQLite session persistence
    ├── log-stream.ts   # Rotating file logger
    └── string-utils.ts # String helpers
```

## HTTP Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/rpc` | POST | JSON-RPC request handler |
| `/events` | GET | SSE notification stream |
| `/health` | GET | Server health check |
| `/metrics` | GET | Prometheus metrics |
| `/commands` | GET | Available agent commands |
| `/claim` | POST | Server claiming |
| `/logs` | GET | Log streaming with level filter |

## Environment

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | Yes | - | API key for Claude |
| `PORT` | No | 9999 | Server port |
| `VERS_DEBUG` | No | false | Enable debug logging to console |

## Data Storage

All data stored in `~/.vers-agent/`:

| File | Purpose |
|------|---------|
| `sessions.db` | SQLite database for sessions and outputs |
| `tokens.json` | Authentication tokens |
| `config.json` | User configuration |
| `logs/vers-agent.log` | Rotating log files (5MB, 5 backups) |

## Auth Model

First client to connect claims the server and receives a token. Subsequent clients must provide this token.

```bash
# View stored tokens
cat ~/.vers-agent/tokens.json

# Reset server claim (requires server restart)
rm ~/.vers-agent/tokens.json
```

## License

MIT
