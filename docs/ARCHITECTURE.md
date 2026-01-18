# Vers-Agent Architecture

> Comprehensive architectural overview of the vers-agent codebase

## Table of Contents

1. [Overview](#overview)
2. [System Architecture](#system-architecture)
3. [Module Breakdown](#module-breakdown)
4. [Data Flow Patterns](#data-flow-patterns)
5. [Protocol Communication](#protocol-communication)
6. [Extension Points](#extension-points)

---

## Overview

Vers-agent is a multi-agent orchestration system that provides:
- **Interactive CLI** - Terminal UI for conversing with AI agents
- **HTTP Server** - ACP (Agent Client Protocol) endpoint for remote access
- **Multi-agent Support** - Switch between different AI providers
- **Session Persistence** - SQLite-backed conversation history
- **Fleet Management** - Multi-VM agent coordination

### Technology Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Runtime | Bun | Fast TypeScript execution |
| HTTP Server | Bun.serve() | Lightweight ACP endpoint |
| Database | bun:sqlite | Session persistence |
| CLI UI | Ink (React) | Terminal rendering |
| IPC | JSON-RPC 2.0 | Agent subprocess communication |
| Config | JSON files | User settings in ~/.vers/ |
| Logging | Custom streams | Rotating file logs |

---

## System Architecture

### High-Level Component Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER INTERFACE                           │
├─────────────────────────────────────────────────────────────────┤
│  Interactive CLI (Ink/React)                                     │
│  ├── TopStatusBar     (model, status, session)                   │
│  ├── OutputArea       (windowed rendering, tool collapsing)      │
│  ├── InputBar         (multiline, completion)                    │
│  └── PermissionDialog (tool approval)                            │
└────────────────┬────────────────────────────────────────────────┘
                 │ HTTP Client (session/prompt)
                 ↓
┌─────────────────────────────────────────────────────────────────┐
│                      HTTP SERVER (Bun)                           │
├─────────────────────────────────────────────────────────────────┤
│  POST /rpc    → JSON-RPC 2.0 endpoint                            │
│  GET /events  → Server-Sent Events stream                        │
│                                                                   │
│  Methods:                                                         │
│  ├── initialize      (capability negotiation)                    │
│  ├── session/new     (create session)                            │
│  ├── session/load    (resume session)                            │
│  ├── session/prompt  (send message)                              │
│  ├── session/cancel  (cancel task)                               │
│  └── queue/*         (queue management)                          │
└────────────────┬────────────────────────────────────────────────┘
                 │ runTask()
                 ↓
┌─────────────────────────────────────────────────────────────────┐
│                    AGENT EXECUTION ENGINE                        │
├─────────────────────────────────────────────────────────────────┤
│  AgentManager                                                     │
│  ├── initializeAgent()  (setup agent runner)                     │
│  ├── runTask()          (execute prompt)                         │
│  └── cleanup()          (teardown)                               │
│                                                                   │
│  AgentRunner (unified interface)                                 │
│  ├── runPrompt()        (execute via ACP)                        │
│  ├── handlePermission() (approval flow)                          │
│  └── streamEvents()     (map to PromptEvents)                    │
└────────────────┬────────────────────────────────────────────────┘
                 │ JSON-RPC stdin/stdout
                 ↓
┌─────────────────────────────────────────────────────────────────┐
│                   AGENT SUBPROCESS (ACP)                         │
├─────────────────────────────────────────────────────────────────┤
│  SubprocessManager                                                │
│  ├── spawn()           (start agent process)                     │
│  ├── sendRequest()     (JSON-RPC over stdin)                     │
│  ├── readStdout()      (parse JSON-RPC responses)                │
│  └── handleStderr()    (command output stream)                   │
│                                                                   │
│  Agent Process (e.g., `claude --acp`)                            │
│  └── Claude Code, OpenAI, Goose, etc.                            │
└────────────────┬────────────────────────────────────────────────┘
                 │ Events (text_delta, tool_use, etc.)
                 ↓
┌─────────────────────────────────────────────────────────────────┐
│                    PERSISTENCE LAYER                             │
├─────────────────────────────────────────────────────────────────┤
│  SessionStore (SQLite)                                            │
│  ├── sessions          (id, name, created_at, turns, cost)       │
│  └── session_outputs   (seq, type, content, color, tool_name)    │
│                                                                   │
│  ConfigStore (JSON)                                               │
│  ├── model             (active model name)                       │
│  ├── lastSessionId     (resume target)                           │
│  ├── defaultAgent      (current agent)                           │
│  └── mcpServers        (server configs)                          │
│                                                                   │
│  AuthStore (in-memory)                                            │
│  └── claimToken        (server ownership)                        │
└─────────────────────────────────────────────────────────────────┘
```

---

## Module Breakdown

### 1. Entry Point (`index.ts`)

**Responsibilities:**
- Parse command-line arguments
- Discover Claude Code executable
- Choose mode: server-only, CLI-only, or both
- Handle remote vs. local connections
- Emergency exit handling (3x Ctrl+C)

**Key Functions:**
- `findClaudeCode()` - Locate Claude Code binary
- `spawnServer()` - Launch HTTP server subprocess
- `connectToServer()` - Establish CLI connection

**Execution Modes:**

| Command | Mode | Description |
|---------|------|-------------|
| `./vers-agent` | Both | Server + CLI locally |
| `./vers-agent --server` | Server | HTTP server only |
| `./vers-agent --cli` | CLI | Connect to localhost:9999 |
| `./vers-agent --url <url>` | CLI | Connect to remote server |

---

### 2. HTTP Server (`src/server/`)

#### `http-server.ts`

**Bun HTTP Server** with two routes:

```typescript
Bun.serve({
  port: 9999,
  fetch(req) {
    if (req.url.endsWith('/rpc')) {
      // JSON-RPC 2.0 endpoint
      return handleRpcRequest(req);
    }
    if (req.url.endsWith('/events')) {
      // SSE event stream
      return handleEventsStream(req);
    }
  }
});
```

**JSON-RPC Methods:**

| Method | Params | Result | Description |
|--------|--------|--------|-------------|
| `initialize` | capabilities | capabilities | Negotiate protocol features |
| `session/new` | model, cwd | sessionId | Create new session |
| `session/load` | sessionId | outputs[] | Resume existing session |
| `session/prompt` | sessionId, prompt | task events | Execute prompt |
| `session/cancel` | sessionId | success | Cancel running task |
| `queue/enqueue` | prompt | queueId | Add to queue |
| `queue/dequeue` | queueId | prompt | Remove from queue |
| `queue/list` | - | queued[] | List pending prompts |

#### `server-state.ts`

**Singleton pattern** for global server state:

```typescript
class ServerState {
  session: SessionStore | null;
  currentTask: Task | null;
  currentAgent: string;
  authToken: string | null;
}
```

#### `sse-manager.ts`

**Server-Sent Events** for real-time streaming:

```typescript
interface SSEManager {
  addClient(clientId: string, writer: Writer): void;
  broadcast(event: PromptEvent): void;
  removeClient(clientId: string): void;
}
```

---

### 3. Agent Execution Engine (`src/core/`)

#### `agent-manager.ts`

**Central orchestrator** for agent lifecycle:

```typescript
class AgentManager {
  // Initialize agent with configuration
  async initializeAgent(agentId: string): Promise<void>;
  
  // Execute a prompt through the agent
  async runTask(params: RunTaskParams): Promise<void>;
  
  // Handle permission requests
  async requestPermission(request: PermissionRequest): Promise<PermissionResponse>;
  
  // Cleanup resources
  async cleanup(): Promise<void>;
}
```

**Key Responsibilities:**
- Load agent from registry
- Create subprocess manager
- Enable session persistence
- Route events to SSE manager
- Handle stderr commands

#### `agent-runner.ts`

**Unified interface** for all agents:

```typescript
interface AgentRunner {
  // Execute prompt via ACP
  runPrompt(params: RunPromptParams): AsyncGenerator<PromptEvent>;
  
  // Request tool permission
  requestPermission(request: PermissionRequest): Promise<PermissionResponse>;
  
  // Create new session
  createSession(model: string, cwd: string): Promise<string>;
  
  // Load existing session
  loadSession(sessionId: string): Promise<void>;
}
```

**Event Mapping:**

```typescript
// Maps ACP events → PromptEvents for CLI rendering
ACP Event            → PromptEvent
─────────────────────────────────────────
text_delta           → { type: 'text_delta', text }
thinking             → { type: 'thinking', thinking }
tool_use             → { type: 'tool_use', tool_name, input }
tool_result          → { type: 'tool_result', output }
error                → { type: 'error', message }
done                 → { type: 'done' }
```

---

### 4. Subprocess Management (`src/agents/`)

#### `subprocess-manager.ts`

**JSON-RPC over stdin/stdout** for agent communication:

```typescript
class SubprocessManager {
  // Spawn agent process
  spawn(command: string, args: string[]): void;
  
  // Send JSON-RPC request
  async sendRequest<T>(method: string, params: any): Promise<T>;
  
  // Register event handler
  on(event: 'message' | 'stderr' | 'error', handler: Function): void;
  
  // Cleanup
  kill(): void;
}
```

**Message Flow:**

```
vers-agent                           Agent Process
    │                                      │
    │  {"jsonrpc":"2.0","id":1,           │
    │   "method":"session/new",           │
    │   "params":{...}}                   │
    ├─────────────────────────────────────>│
    │                                      │
    │  {"jsonrpc":"2.0","id":1,           │
    │   "result":{"sessionId":"abc123"}}  │
    │<─────────────────────────────────────┤
    │                                      │
    │  {"jsonrpc":"2.0",                  │
    │   "method":"notification/event",    │
    │   "params":{"type":"text_delta"}}   │
    │<─────────────────────────────────────┤
```

**Error Handling:**

```typescript
// Timeout after 60s
const timeout = setTimeout(() => {
  reject(new Error('Request timeout'));
}, 60000);

// Handle process errors
process.on('error', (err) => {
  logStream.error('Agent process error:', err);
});

// Handle unexpected exit
process.on('exit', (code) => {
  if (code !== 0) {
    logStream.error(`Agent exited with code ${code}`);
  }
});
```

#### `registry.ts`

**Agent discovery** from JSON definitions:

```typescript
// Load from src/data/agents/*.json
interface AgentDefinition {
  identity: string;        // "claude.com"
  name: string;            // "Claude Code"
  runCommand: string;      // "claude"
  args: string[];          // ["--acp"]
  models: string[];        // ["claude-opus-4", ...]
  requiredEnvVars?: string[]; // ["ANTHROPIC_API_KEY"]
}

// Platform-specific config
interface AgentConfig {
  darwin?: { path?: string };
  linux?: { path?: string };
  win32?: { path?: string };
}
```

---

### 5. Interactive CLI (`src/cli/`)

#### `app.tsx` (Root Component)

**React state management** for terminal UI:

```typescript
const App = () => {
  const [output, setOutput] = useState<OutputLine[]>([]);
  const [input, setInput] = useState('');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [model, setModel] = useState('claude-sonnet-4-5');
  const [isStreaming, setIsStreaming] = useState(false);
  const [permissionDialog, setPermissionDialog] = useState<PermissionRequest | null>(null);
  
  // ACP client hook
  const { sendPrompt, cancelTask } = useAcpClient({
    serverUrl,
    onEvent: handlePromptEvent,
    onPermissionRequest: handlePermission,
  });
  
  return (
    <Box flexDirection="column" height="100%">
      <TopStatusBar model={model} sessionId={sessionId} />
      <OutputArea lines={output} scrollOffset={scrollY} />
      {permissionDialog && <PermissionDialog request={permissionDialog} />}
      <InputBar value={input} onChange={setInput} onSubmit={handleSubmit} />
    </Box>
  );
};
```

#### CLI Components (`src/cli/components/`)

**TopStatusBar** (`top-status-bar.tsx`):
```typescript
// Displays: [Model] [Connection] [Session ID] [Agent]
<Text>
  <Text color="cyan">{model}</Text>
  <Text color={connected ? "green" : "red"}> ● </Text>
  <Text>Session: {sessionId}</Text>
  <Text color="magenta"> [{agentName}]</Text>
</Text>
```

**OutputArea** (`output-area.tsx`):
```typescript
// Windowed rendering for performance (only visible lines)
const visibleLines = output.slice(scrollOffset, scrollOffset + terminalHeight);

// Syntax highlighting for code blocks
{line.type === 'code' && <SyntaxHighlighter code={line.content} language={line.language} />}

// Tool collapsing (hide tool details until expanded)
{line.type === 'tool_use' && !expanded && <Text dimColor>▶ {toolName}</Text>}
```

**InputBar** (`input-bar.tsx`):
```typescript
// Multiline input with command completion
<TextInput
  value={input}
  onChange={setInput}
  onSubmit={handleSubmit}
  placeholder="Enter message or /command"
/>

// Auto-complete: /model <TAB> → /model claude-opus-4-5
// Auto-complete: @src/in <TAB> → @src/index.ts
```

**PermissionDialog** (`permission-dialog.tsx`):
```typescript
// Interactive approval UI
<Box borderStyle="round" borderColor="yellow">
  <Text>Tool: {request.toolName}</Text>
  <Text>Input: {JSON.stringify(request.input)}</Text>
  <Text>Allow? (y/n/always/never)</Text>
</Box>

// Keyboard handling
useInput((input, key) => {
  if (input === 'y') sendResponse({ allowed: true, remember: false });
  if (input === 'a') sendResponse({ allowed: true, remember: true });
  if (input === 'n') sendResponse({ allowed: false, remember: false });
});
```

#### Command Handlers (`src/cli/handlers/`)

**Slash Commands** (`command-handlers.ts`):

| Command | Function | Description |
|---------|----------|-------------|
| `/new` | `handleNewSession()` | Start fresh session |
| `/continue` | `handleContinue()` | Resume last session |
| `/model <name>` | `handleModel()` | Switch model |
| `/agent list` | `handleAgentList()` | Show available agents |
| `/agent select <name>` | `handleAgentSelect()` | Switch agent |
| `/sessions` | `handleSessions()` | List all sessions |
| `/mcp list` | `handleMcpList()` | Show MCP servers |
| `/mcp add <yaml>` | `handleMcpAdd()` | Add MCP server |
| `/help` | `handleHelp()` | Show help |

**Bash Commands** (`!<command>`):
```typescript
if (input.startsWith('!')) {
  const command = input.slice(1);
  const result = await executeCommand(command);
  appendOutput({ type: 'command_output', content: result });
}
```

**Path Completion** (`@<path>`):
```typescript
if (input.includes('@')) {
  const path = extractPath(input);
  const resolved = resolvePath(path);
  appendOutput({ type: 'path', content: resolved });
}
```

---

### 6. Protocol Layer (`src/protocol/`)

#### `jsonrpc.ts`

**JSON-RPC 2.0 utilities:**

```typescript
// Create request
function createRequest(id: string | number, method: string, params: any): JsonRpcRequest {
  return {
    jsonrpc: '2.0',
    id,
    method,
    params,
  };
}

// Create response
function createResponse(id: string | number, result: any): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    result,
  };
}

// Create error
function createError(id: string | number, code: number, message: string): JsonRpcError {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message },
  };
}
```

**Standard Error Codes:**

| Code | Meaning | Description |
|------|---------|-------------|
| -32700 | Parse error | Invalid JSON |
| -32600 | Invalid request | Missing required fields |
| -32601 | Method not found | Unknown method |
| -32602 | Invalid params | Parameter validation failed |
| -32603 | Internal error | Server error |

#### `acp-types.ts`

**ACP Protocol Types:**

```typescript
// Session methods
interface SessionNewParams {
  model: string;
  cwd: string;
  mcpServers?: McpServerConfig[];
}

interface SessionPromptParams {
  sessionId: string;
  prompt: {
    role: 'user';
    content: ContentBlock[];
  };
}

// Content blocks
type ContentBlock = 
  | { type: 'text'; text: string }
  | { type: 'image'; source: ImageSource }
  | { type: 'tool_use'; id: string; name: string; input: any }
  | { type: 'tool_result'; tool_use_id: string; content: any };

// Events
type PromptEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'tool_use'; id: string; name: string; input: any }
  | { type: 'tool_result'; tool_use_id: string; output: any }
  | { type: 'error'; message: string }
  | { type: 'done' };
```

---

### 7. Persistence Layer (`src/utils/`)

#### `session-store.ts`

**SQLite schema:**

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  name TEXT,
  created_at INTEGER,
  last_used_at INTEGER,
  total_turns INTEGER DEFAULT 0,
  total_cost REAL DEFAULT 0.0,
  mode TEXT DEFAULT 'chat'
);

CREATE TABLE session_outputs (
  session_id TEXT,
  seq INTEGER,
  type TEXT,
  content TEXT,
  color TEXT,
  tool_name TEXT,
  PRIMARY KEY (session_id, seq),
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX idx_last_used ON sessions(last_used_at DESC);
```

**Key Methods:**

```typescript
class SessionStore {
  // Create new session
  createSession(name?: string): string;
  
  // Append output line
  appendOutput(sessionId: string, output: OutputLine): void;
  
  // Load session history
  loadSession(sessionId: string): OutputLine[];
  
  // List all sessions
  listSessions(limit?: number): Session[];
  
  // Update session metadata
  updateSession(sessionId: string, updates: Partial<Session>): void;
}
```

#### `config.ts`

**User configuration** stored in `~/.vers/agent_config.json`:

```json
{
  "model": "claude-sonnet-4-5",
  "lastSessionId": "abc123",
  "lastServerUrl": "http://localhost:9999",
  "defaultAgent": "claude.com",
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem"],
      "env": {}
    }
  },
  "commandHistory": {
    "abc123": ["/model claude-opus-4-5", "/agent list"]
  }
}
```

**Configuration API:**

```typescript
interface Config {
  get(key: string): any;
  set(key: string, value: any): void;
  getSessionHistory(sessionId: string): string[];
  addToSessionHistory(sessionId: string, command: string): void;
}
```

---

## Data Flow Patterns

### Flow 1: User Prompt Execution

```
┌─────────────┐
│ User Input  │ (CLI)
└──────┬──────┘
       │ /continue "Fix the bug"
       ↓
┌──────────────────┐
│ Input Handler    │ (cli/app.tsx)
└──────┬───────────┘
       │ Not a slash command
       ↓
┌──────────────────┐
│ Queue Prompt     │ (cli/hooks/use-acp-client.ts)
└──────┬───────────┘
       │ HTTP POST /rpc
       │ {"method": "session/prompt", "params": {...}}
       ↓
┌──────────────────┐
│ HTTP Server      │ (server/http-server.ts)
└──────┬───────────┘
       │ Route to handler
       ↓
┌──────────────────┐
│ Handler          │ (server/handlers/session-prompt.ts)
└──────┬───────────┘
       │ agentManager.runTask()
       ↓
┌──────────────────┐
│ Agent Manager    │ (core/agent-manager.ts)
└──────┬───────────┘
       │ agentRunner.runPrompt()
       ↓
┌──────────────────┐
│ Agent Runner     │ (agents/agent-runner.ts)
└──────┬───────────┘
       │ subprocessManager.sendRequest()
       ↓
┌──────────────────┐
│ Subprocess Mgr   │ (agents/subprocess-manager.ts)
└──────┬───────────┘
       │ JSON-RPC stdin
       │ {"method": "session/prompt", "params": {...}}
       ↓
┌──────────────────┐
│ Agent Process    │ (Claude Code / OpenAI / etc.)
└──────┬───────────┘
       │ Execute prompt
       │ Generate events
       ↓
┌──────────────────┐
│ stdout           │ (JSON-RPC notifications)
└──────┬───────────┘
       │ {"method": "notification/event", 
       │  "params": {"type": "text_delta", "text": "..."}}
       ↓
┌──────────────────┐
│ Subprocess Mgr   │ (parse JSON-RPC)
└──────┬───────────┘
       │ Emit event
       ↓
┌──────────────────┐
│ Event Mapper     │ (agents/event-mapper.ts)
└──────┬───────────┘
       │ Map to PromptEvent
       ↓
┌──────────────────┐
│ SSE Manager      │ (server/sse-manager.ts)
└──────┬───────────┘
       │ Broadcast to SSE clients
       │ GET /events stream
       ↓
┌──────────────────┐
│ CLI              │ (cli/app.tsx)
└──────┬───────────┘
       │ handlePromptEvent()
       ↓
┌──────────────────┐
│ OutputArea       │ (cli/components/output-area.tsx)
└──────┬───────────┘
       │ Render event
       │ - text_delta → append text
       │ - tool_use → show tool
       │ - thinking → show thinking
       ↓
┌──────────────────┐
│ Session Store    │ (utils/session-store.ts)
└──────┬───────────┘
       │ appendOutput()
       │ Store in SQLite
       └─────────────
```

### Flow 2: Session Resumption

```
┌─────────────┐
│ User        │ ./vers-agent
└──────┬──────┘
       │
       ↓
┌──────────────────┐
│ index.ts         │ (entry point)
└──────┬───────────┘
       │ Load config
       ↓
┌──────────────────┐
│ config.ts        │ (~/.vers/agent_config.json)
└──────┬───────────┘
       │ lastSessionId = "abc123"
       ↓
┌──────────────────┐
│ CLI              │ (cli/app.tsx)
└──────┬───────────┘
       │ HTTP POST /rpc
       │ {"method": "session/load", "params": {"sessionId": "abc123"}}
       ↓
┌──────────────────┐
│ HTTP Server      │ (server/http-server.ts)
└──────┬───────────┘
       │ Route to handler
       ↓
┌──────────────────┐
│ Handler          │ (server/handlers/session-load.ts)
└──────┬───────────┘
       │ sessionStore.loadSession("abc123")
       ↓
┌──────────────────┐
│ Session Store    │ (utils/session-store.ts)
└──────┬───────────┘
       │ SELECT * FROM session_outputs
       │ WHERE session_id = 'abc123'
       │ ORDER BY seq ASC
       ↓
┌──────────────────┐
│ SQLite           │
└──────┬───────────┘
       │ Return OutputLine[]
       ↓
┌──────────────────┐
│ Handler          │ (return to client)
└──────┬───────────┘
       │ {"result": {"outputs": [...]}}
       ↓
┌──────────────────┐
│ CLI              │ (cli/app.tsx)
└──────┬───────────┘
       │ setOutput(outputs)
       ↓
┌──────────────────┐
│ OutputArea       │ (render restored conversation)
└──────────────────┘
```

### Flow 3: Permission Handling

```
┌──────────────────┐
│ Agent Process    │ (executing tool)
└──────┬───────────┘
       │ Requires approval
       │ {"method": "request/permission",
       │  "params": {"tool": "Bash", "input": "rm -rf /"}}
       ↓
┌──────────────────┐
│ Agent Runner     │ (agents/agent-runner.ts)
└──────┬───────────┘
       │ Pause execution
       │ requestPermission()
       ↓
┌──────────────────┐
│ Agent Manager    │ (core/agent-manager.ts)
└──────┬───────────┘
       │ Broadcast permission request
       ↓
┌──────────────────┐
│ SSE Manager      │ (server/sse-manager.ts)
└──────┬───────────┘
       │ Send to CLI via SSE
       ↓
┌──────────────────┐
│ CLI              │ (cli/app.tsx)
└──────┬───────────┘
       │ setPermissionDialog(request)
       ↓
┌──────────────────┐
│ Permission UI    │ (cli/components/permission-dialog.tsx)
└──────┬───────────┘
       │ User input: 'y' (allow)
       ↓
┌──────────────────┐
│ CLI              │ (send response)
└──────┬───────────┘
       │ HTTP POST /rpc
       │ {"method": "permission/response",
       │  "params": {"allowed": true}}
       ↓
┌──────────────────┐
│ Agent Runner     │ (receive response)
└──────┬───────────┘
       │ Resume execution
       ↓
┌──────────────────┐
│ Agent Process    │ (execute tool)
└──────────────────┘
```

---

## Protocol Communication

### JSON-RPC 2.0 Format

All communication uses JSON-RPC 2.0:

**Request:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "session/prompt",
  "params": {
    "sessionId": "abc123",
    "prompt": {
      "role": "user",
      "content": [
        {"type": "text", "text": "Hello"}
      ]
    }
  }
}
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "taskId": "task-456"
  }
}
```

**Error:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32602,
    "message": "Invalid sessionId"
  }
}
```

**Notification (no response expected):**
```json
{
  "jsonrpc": "2.0",
  "method": "notification/event",
  "params": {
    "type": "text_delta",
    "text": "Hello, world!"
  }
}
```

### ACP Protocol Examples

#### Initialize

**Request:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "capabilities": {
      "streaming": true,
      "tools": ["Read", "Write", "Bash"],
      "multimodal": ["image/png", "image/jpeg"]
    }
  }
}
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "capabilities": {
      "streaming": true,
      "sessionPersistence": true,
      "queueManagement": true
    }
  }
}
```

#### Create Session

**Request:**
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "session/new",
  "params": {
    "model": "claude-sonnet-4-5",
    "cwd": "/Users/bob/project",
    "mcpServers": [
      {
        "name": "filesystem",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem"]
      }
    ]
  }
}
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "sessionId": "session-abc123",
    "agentSessionId": "claude-internal-xyz789"
  }
}
```

#### Send Prompt

**Request:**
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "session/prompt",
  "params": {
    "sessionId": "session-abc123",
    "prompt": {
      "role": "user",
      "content": [
        {"type": "text", "text": "Read the README.md file"}
      ]
    }
  }
}
```

**Response (immediate):**
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "taskId": "task-456"
  }
}
```

**Event Stream (via SSE):**

```
event: notification
data: {"type":"text_delta","text":"I'll read the README.md file for you."}

event: notification
data: {"type":"tool_use","id":"tool_1","name":"Read","input":{"file_path":"README.md"}}

event: notification
data: {"type":"tool_result","tool_use_id":"tool_1","output":"# My Project\n\nWelcome..."}

event: notification
data: {"type":"text_delta","text":"The README contains project documentation..."}

event: notification
data: {"type":"done","usage":{"input_tokens":150,"output_tokens":50}}
```

---

## Extension Points

### 1. Adding New Agents

**Create agent definition** in `src/data/agents/`:

```json
{
  "identity": "custom.ai",
  "name": "Custom AI",
  "runCommand": "custom-ai-cli",
  "args": ["--acp"],
  "models": ["custom-model-1", "custom-model-2"],
  "requiredEnvVars": ["CUSTOM_API_KEY"],
  "config": {
    "darwin": {
      "path": "/usr/local/bin/custom-ai-cli"
    }
  }
}
```

**Requirements:**
- Agent must support ACP protocol (JSON-RPC over stdin/stdout)
- Must implement: `session/new`, `session/prompt`, `session/cancel`
- Must emit events: `text_delta`, `tool_use`, `tool_result`, `done`

### 2. Adding New Slash Commands

**Edit `src/cli/handlers/command-handlers.ts`:**

```typescript
export async function handleCustomCommand(
  args: string[],
  context: CommandContext
): Promise<void> {
  // Validate args
  if (args.length === 0) {
    throw new Error('Usage: /custom <arg>');
  }
  
  // Execute logic
  const result = await doCustomThing(args[0]);
  
  // Update UI
  context.appendOutput({
    type: 'system',
    content: `Custom result: ${result}`,
    color: 'cyan',
  });
}

// Register in command map
const COMMANDS: Record<string, CommandHandler> = {
  // ...existing commands
  custom: handleCustomCommand,
};
```

### 3. Adding New Tools

**Agents inherit tools from their runtime** (e.g., Claude Code provides Read, Write, Bash).

To add custom tools:
1. Implement tool in agent process
2. Return tool in `session/new` response
3. Handle `tool_use` events in agent runner

### 4. Custom Event Types

**Extend `PromptEvent` in `src/core/types.ts`:**

```typescript
type PromptEvent =
  | ExistingEvents
  | { type: 'custom_event'; data: CustomData };
```

**Handle in event mapper** (`src/agents/event-mapper.ts`):

```typescript
function mapAcpEvent(acpEvent: AcpEvent): PromptEvent {
  if (acpEvent.type === 'custom_acp_event') {
    return { type: 'custom_event', data: acpEvent.data };
  }
  // ...existing mappings
}
```

**Render in CLI** (`src/cli/components/output-area.tsx`):

```typescript
{line.type === 'custom_event' && (
  <CustomEventRenderer data={line.data} />
)}
```

### 5. Custom Persistence Backends

**Implement `StorageAdapter` interface:**

```typescript
interface StorageAdapter {
  createSession(name?: string): string;
  appendOutput(sessionId: string, output: OutputLine): void;
  loadSession(sessionId: string): OutputLine[];
  listSessions(limit?: number): Session[];
}

class PostgresAdapter implements StorageAdapter {
  // Implementation using pg client
}

// Use in session-store.ts
const adapter = new PostgresAdapter(config);
const sessionStore = new SessionStore(adapter);
```

### 6. Custom Authentication

**Extend `auth-store.ts`:**

```typescript
class OAuth2AuthStore implements AuthStore {
  async authenticate(req: Request): Promise<boolean> {
    const token = extractBearerToken(req);
    return await validateOAuth2Token(token);
  }
}

// Use in http-server.ts
const authStore = new OAuth2AuthStore(config);
server.use(authStore.middleware);
```

---

## Additional Resources

- **ACP Protocol Spec**: See `docs/acp-llms.txt` for full protocol documentation
- **Deployment Guide**: See `docs/DEPLOYMENT.md` for Docker/production setup
- **Multi-VM Guide**: See `docs/MULTI-VM-USAGE.md` for fleet management
- **Contributing**: See `CONTRIBUTING.md` for contribution guidelines

---

## Glossary

| Term | Definition |
|------|------------|
| **ACP** | Agent Client Protocol - JSON-RPC protocol for agent communication |
| **SSE** | Server-Sent Events - HTTP streaming for real-time notifications |
| **Subprocess** | External agent process spawned via `Bun.spawn()` |
| **Session** | Persistent conversation with history stored in SQLite |
| **Queue** | Pending prompts waiting for execution |
| **Tool** | Function callable by agent (Read, Write, Bash, etc.) |
| **MCP Server** | Model Context Protocol server for extended capabilities |
| **Fleet** | Collection of agent VMs managed together |

---

*Generated 2026-01-12 for vers-agent codebase*
