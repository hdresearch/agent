# ACP and CLI Integration Points

> Deep dive into how ACP protocol and CLI interact in vers-agent, and how to bridge with duck

**Date**: 2026-01-12

---

## Table of Contents

1. [ACP Protocol Overview](#1-acp-protocol-overview)
2. [CLI Integration Architecture](#2-cli-integration-architecture)
3. [Integration Points Map](#3-integration-points-map)
4. [Message Flow Examples](#4-message-flow-examples)
5. [Extension Points](#5-extension-points)
6. [Duck Integration Strategy](#6-duck-integration-strategy)
7. [Implementation Patterns](#7-implementation-patterns)

---

## 1. ACP Protocol Overview

### What is ACP?

**ACP (Agent Client Protocol)** is a JSON-RPC 2.0-based protocol for bidirectional communication between:
- **Client**: CLI or HTTP client (the user interface)
- **Server**: Agent orchestration layer (manages AI agent processes)
- **Agent**: AI subprocess (Claude Code, OpenAI, etc.)

### Protocol Layers

```
┌─────────────────────────────────────────────────────────────┐
│                    PROTOCOL STACK                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Layer 4: User Interface (Ink CLI)                          │
│           ↕ TypeScript objects                              │
│  Layer 3: ACP Client (HTTP/SSE)                             │
│           ↕ JSON-RPC 2.0 over HTTP                          │
│  Layer 2: ACP Server (Bun HTTP)                             │
│           ↕ JSON-RPC 2.0 over stdin/stdout                  │
│  Layer 1: Agent Process (Claude Code)                       │
│           ↕ Tool executions & API calls                     │
│  Layer 0: External Systems (filesystem, APIs)               │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Key ACP Methods

| Method | Direction | Purpose | Response |
|--------|-----------|---------|----------|
| `initialize` | Client → Server | Capability negotiation | Server capabilities |
| `session/new` | Client → Server | Create conversation | Session ID |
| `session/load` | Client → Server | Resume conversation | Session outputs |
| `session/prompt` | Client → Server | Send user message | Task ID (streaming via SSE) |
| `session/cancel` | Client → Server | Stop execution | Success status |
| `notification/event` | Server → Client | Stream events | N/A (notification) |
| `request/permission` | Agent → Server → Client | Tool approval | Permission response |

---

## 2. CLI Integration Architecture

### Component Relationships

```
┌──────────────────────────────────────────────────────────────┐
│                    CLI APPLICATION (Ink/React)                │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  App Component (src/cli/app.tsx)                       │  │
│  │  ┌──────────────────────────────────────────────────┐  │  │
│  │  │  State Management                                 │  │  │
│  │  │  - output: OutputLine[]                           │  │  │
│  │  │  - input: string                                  │  │  │
│  │  │  - sessionId: string                              │  │  │
│  │  │  - isStreaming: boolean                           │  │  │
│  │  │  - permissionDialog: PermissionRequest?           │  │  │
│  │  └──────────────────────────────────────────────────┘  │  │
│  │                                                         │  │
│  │  ┌──────────────────────────────────────────────────┐  │  │
│  │  │  useAcpClient Hook                                │  │  │
│  │  │  - sendPrompt()                                   │  │  │
│  │  │  - cancelTask()                                   │  │  │
│  │  │  - createSession()                                │  │  │
│  │  │  - loadSession()                                  │  │  │
│  │  └────────────┬─────────────────────────────────────┘  │  │
│  └───────────────┼──────────────────────────────────────────┘  │
│                  │                                             │
│                  │ HTTP POST/GET                               │
│                  ↓                                             │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  ACP Client (src/client/http-client.ts)               │  │
│  │  ┌──────────────────────────────────────────────────┐  │  │
│  │  │  HTTP Transport                                   │  │  │
│  │  │  - POST /rpc (JSON-RPC requests)                  │  │  │
│  │  │  - GET /events (SSE stream)                       │  │  │
│  │  └──────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                               │
└───────────────────────────────────────────────────────────────┘
                             ↕
                    Network (localhost:9999)
                             ↕
┌───────────────────────────────────────────────────────────────┐
│                    ACP SERVER (Bun HTTP)                      │
├───────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  HTTP Server (src/server/http-server.ts)              │  │
│  │  ┌──────────────────────────────────────────────────┐  │  │
│  │  │  Route Handlers                                   │  │  │
│  │  │  - POST /rpc → handleRpcRequest()                 │  │  │
│  │  │  - GET /events → handleEventsStream()             │  │  │
│  │  └──────────────────────────────────────────────────┘  │  │
│  └────────────┬───────────────────────────────────────────┘  │
│               │                                               │
│               ↓                                               │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Method Handlers (src/server/handlers/)               │  │
│  │  - initialize.ts                                       │  │
│  │  - session-new.ts                                      │  │
│  │  - session-prompt.ts                                   │  │
│  │  - session-cancel.ts                                   │  │
│  └────────────┬───────────────────────────────────────────┘  │
│               │                                               │
│               ↓                                               │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Agent Manager (src/core/agent-manager.ts)            │  │
│  │  - initializeAgent()                                   │  │
│  │  - runTask()                                           │  │
│  │  - handlePermission()                                  │  │
│  └────────────┬───────────────────────────────────────────┘  │
│               │                                               │
│               ↓                                               │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  Subprocess Manager (src/agents/subprocess-manager.ts)│  │
│  │  - spawn agent process                                 │  │
│  │  - JSON-RPC stdin/stdout                               │  │
│  └────────────┬───────────────────────────────────────────┘  │
│               │                                               │
└───────────────┼───────────────────────────────────────────────┘
                │
                ↓
        Claude Code Process
```

---

## 3. Integration Points Map

### Integration Point 1: CLI → ACP Client

**Location**: `src/cli/hooks/use-acp-client.ts`

**Purpose**: Convert user actions into ACP method calls

**Key Functions**:

```typescript
// src/cli/hooks/use-acp-client.ts
export function useAcpClient(config: AcpClientConfig) {
  const [client] = useState(() => new AcpHttpClient(config.serverUrl));
  
  // Integration Point: User input → ACP request
  const sendPrompt = useCallback(async (prompt: string) => {
    // 1. Create prompt content
    const content: ContentBlock[] = [
      { type: 'text', text: prompt }
    ];
    
    // 2. Send via ACP
    const taskId = await client.request('session/prompt', {
      sessionId: config.sessionId,
      prompt: { role: 'user', content },
    });
    
    // 3. Listen for events via SSE
    const eventSource = client.streamEvents();
    eventSource.onmessage = (event) => {
      const promptEvent = JSON.parse(event.data);
      config.onEvent(promptEvent);
    };
    
    return taskId;
  }, [client, config]);
  
  return { sendPrompt, cancelTask, createSession, loadSession };
}
```

**Data Flow**:
```
User types input → sendPrompt() → ACP request → HTTP POST /rpc
                                               ↓
                                    JSON-RPC: session/prompt
```

---

### Integration Point 2: ACP Server → Agent Manager

**Location**: `src/server/handlers/session-prompt.ts`

**Purpose**: Route ACP requests to agent execution

**Key Code**:

```typescript
// src/server/handlers/session-prompt.ts
export async function handleSessionPrompt(
  params: PromptParams,
  context: HandlerContext
): Promise<PromptResult> {
  const { sessionId, prompt } = params;
  
  // Integration Point: ACP method → Agent execution
  const task: Task = {
    id: crypto.randomUUID(),
    prompt: extractTextFromContent(prompt.content),
    config: {
      model: context.config.model,
      cwd: context.config.cwd,
    },
    status: 'pending',
    createdAt: new Date(),
    events: [],
  };
  
  // Route to agent manager
  await context.agentManager.runTask(task);
  
  return { success: true };
}
```

**Data Flow**:
```
HTTP POST /rpc → handleRpcRequest() → handleSessionPrompt()
                                               ↓
                                    agentManager.runTask()
```

---

### Integration Point 3: Agent Process → Event Stream

**Location**: `src/agents/subprocess-manager.ts`

**Purpose**: Convert agent stdout to ACP events

**Key Code**:

```typescript
// src/agents/subprocess-manager.ts
export class SubprocessManager {
  private process: ChildProcess;
  
  async sendRequest<T>(method: string, params: any): Promise<T> {
    // Send JSON-RPC to agent stdin
    const request = {
      jsonrpc: '2.0',
      id: this.nextId++,
      method,
      params,
    };
    
    this.process.stdin.write(JSON.stringify(request) + '\n');
    
    // Integration Point: Agent stdout → ACP events
    return new Promise((resolve) => {
      this.process.stdout.on('data', (chunk) => {
        const lines = chunk.toString().split('\n');
        
        for (const line of lines) {
          if (!line.trim()) continue;
          
          try {
            const message = JSON.parse(line);
            
            // Response to our request
            if (message.id === request.id) {
              resolve(message.result);
            }
            
            // Notification (event)
            if (message.method === 'notification/event') {
              this.emit('event', message.params);
            }
          } catch (err) {
            logStream.error('Failed to parse agent message:', err);
          }
        }
      });
    });
  }
}
```

**Data Flow**:
```
Agent stdout → JSON-RPC notification → subprocess.emit('event')
                                               ↓
                                    EventMapper → PromptEvent
                                               ↓
                                    SSE → GET /events → CLI
```

---

### Integration Point 4: Event Stream → CLI Renderer

**Location**: `src/cli/app.tsx`

**Purpose**: Convert ACP events to UI updates

**Key Code**:

```typescript
// src/cli/app.tsx
const handlePromptEvent = useCallback((event: PromptEvent) => {
  // Integration Point: ACP event → UI update
  switch (event.type) {
    case 'text_delta':
      // Append text to current output line
      setOutput(prev => {
        const last = prev[prev.length - 1];
        if (last?.type === 'assistant') {
          return [
            ...prev.slice(0, -1),
            { ...last, content: last.content + event.text }
          ];
        }
        return [...prev, { type: 'assistant', content: event.text }];
      });
      break;
      
    case 'tool_use':
      // Add tool call to output
      setOutput(prev => [...prev, {
        type: 'tool_use',
        tool_name: event.name,
        input: event.input,
        collapsed: true,
      }]);
      break;
      
    case 'tool_result':
      // Update tool result
      setOutput(prev => {
        const toolIndex = prev.findIndex(
          line => line.type === 'tool_use' && line.tool_use_id === event.tool_use_id
        );
        if (toolIndex >= 0) {
          return [
            ...prev.slice(0, toolIndex + 1),
            { type: 'tool_result', content: event.output },
            ...prev.slice(toolIndex + 1),
          ];
        }
        return prev;
      });
      break;
      
    case 'done':
      setIsStreaming(false);
      // Save to session store
      sessionStore.updateSession(sessionId, {
        last_used_at: Date.now(),
        total_turns: totalTurns + 1,
      });
      break;
  }
}, [sessionId]);

// Register event handler
useEffect(() => {
  const eventSource = acpClient.streamEvents();
  eventSource.onmessage = (event) => {
    const promptEvent = JSON.parse(event.data);
    handlePromptEvent(promptEvent);
  };
  
  return () => eventSource.close();
}, [acpClient, handlePromptEvent]);
```

**Data Flow**:
```
SSE event → handlePromptEvent() → setOutput() → React render
                                               ↓
                                    OutputArea component updates
```

---

### Integration Point 5: Permission Dialog Flow

**Location**: `src/cli/components/permission-dialog.tsx`

**Purpose**: Handle tool approval requests

**Key Code**:

```typescript
// Agent requests permission
// src/agents/agent-runner.ts
async requestPermission(request: PermissionRequest): Promise<PermissionResponse> {
  // Integration Point: Agent → Server → CLI
  return new Promise((resolve) => {
    // Emit permission request event
    this.sseManager.broadcast({
      type: 'permission_request',
      request,
    });
    
    // Store resolver
    this.pendingPermissions.set(request.id, resolve);
  });
}

// CLI displays dialog and sends response
// src/cli/components/permission-dialog.tsx
const PermissionDialog = ({ request }: Props) => {
  useInput((input, key) => {
    let response: PermissionResponse;
    
    if (input === 'y') {
      response = { id: request.id, allowed: true, remember: false };
    } else if (input === 'a') {
      response = { id: request.id, allowed: true, remember: true };
    } else if (input === 'n') {
      response = { id: request.id, allowed: false, remember: false };
    }
    
    // Integration Point: CLI → Server → Agent
    acpClient.request('permission/response', response);
  });
  
  return (
    <Box borderStyle="round" borderColor="yellow">
      <Text>Tool: {request.tool_name}</Text>
      <Text>Allow? (y/n/a=always)</Text>
    </Box>
  );
};
```

**Data Flow**:
```
Agent needs approval → PermissionRequest → SSE → CLI dialog
                                                      ↓
User presses 'y' → PermissionResponse → HTTP POST → Agent proceeds
```

---

## 4. Message Flow Examples

### Example 1: User Sends Prompt

```
┌─────────┐                                                ┌─────────┐
│   CLI   │                                                │  Server │
└────┬────┘                                                └────┬────┘
     │                                                          │
     │ 1. User types: "Read the README file"                   │
     │                                                          │
     │ 2. sendPrompt("Read the README file")                   │
     │    POST /rpc                                             │
     │    {                                                     │
     │      "jsonrpc": "2.0",                                   │
     │      "id": 1,                                            │
     │      "method": "session/prompt",                         │
     │      "params": {                                         │
     │        "sessionId": "abc123",                            │
     │        "prompt": {                                       │
     │          "role": "user",                                 │
     │          "content": [                                    │
     │            {"type": "text", "text": "Read README"}       │
     │          ]                                               │
     │        }                                                 │
     │      }                                                   │
     │    }                                                     │
     ├─────────────────────────────────────────────────────────>│
     │                                                          │
     │                                                          │ 3. handleSessionPrompt()
     │                                                          │    agentManager.runTask()
     │                                                          │    subprocess.sendRequest()
     │                                                          │
     │ 4. Response (immediate)                                 │
     │    {                                                     │
     │      "jsonrpc": "2.0",                                   │
     │      "id": 1,                                            │
     │      "result": {"taskId": "task-456"}                    │
     │    }                                                     │
     │<─────────────────────────────────────────────────────────┤
     │                                                          │
     │ 5. Listen to SSE: GET /events                            │
     ├─────────────────────────────────────────────────────────>│
     │                                                          │
     │ 6. Event stream starts                                  │
     │    event: notification                                   │
     │    data: {"type":"text_delta","text":"I'll read"}        │
     │<─────────────────────────────────────────────────────────┤
     │                                                          │
     │ 7. Render: "I'll read"                                   │
     │                                                          │
     │    event: notification                                   │
     │    data: {"type":"tool_use","name":"Read",               │
     │           "input":{"file_path":"README.md"}}             │
     │<─────────────────────────────────────────────────────────┤
     │                                                          │
     │ 8. Render: ▼ Read(file_path="README.md")                │
     │                                                          │
     │    event: notification                                   │
     │    data: {"type":"tool_result",                          │
     │           "output":"# My Project\n..."}                  │
     │<─────────────────────────────────────────────────────────┤
     │                                                          │
     │ 9. Render tool result                                    │
     │                                                          │
     │    event: notification                                   │
     │    data: {"type":"text_delta",                           │
     │           "text":"The README contains..."}               │
     │<─────────────────────────────────────────────────────────┤
     │                                                          │
     │ 10. Render: "The README contains..."                     │
     │                                                          │
     │    event: notification                                   │
     │    data: {"type":"done","usage":{...}}                   │
     │<─────────────────────────────────────────────────────────┤
     │                                                          │
     │ 11. Mark complete, save to SQLite                        │
     │                                                          │
```

### Example 2: Session Resumption

```
┌─────────┐                                                ┌─────────┐
│   CLI   │                                                │  Server │
└────┬────┘                                                └────┬────┘
     │                                                          │
     │ 1. Load config: lastSessionId = "abc123"                │
     │                                                          │
     │ 2. POST /rpc                                             │
     │    {                                                     │
     │      "method": "session/load",                           │
     │      "params": {"sessionId": "abc123"}                   │
     │    }                                                     │
     ├─────────────────────────────────────────────────────────>│
     │                                                          │
     │                                                          │ 3. sessionStore.loadSession()
     │                                                          │    SELECT * FROM session_outputs
     │                                                          │    WHERE session_id = 'abc123'
     │                                                          │
     │ 4. Response with full history                           │
     │    {                                                     │
     │      "result": {                                         │
     │        "sessionId": "abc123",                            │
     │        "outputs": [                                      │
     │          {"seq": 1, "type": "user",                      │
     │           "content": "Hello"},                           │
     │          {"seq": 2, "type": "assistant",                 │
     │           "content": "Hi there!"},                       │
     │          ...                                             │
     │        ]                                                 │
     │      }                                                   │
     │    }                                                     │
     │<─────────────────────────────────────────────────────────┤
     │                                                          │
     │ 5. Render full conversation history                      │
     │    - Line 1: User: Hello                                 │
     │    - Line 2: Assistant: Hi there!                        │
     │    - ...                                                 │
     │                                                          │
     │ 6. Ready for new input                                   │
     │                                                          │
```

---

## 5. Extension Points

### Extension Point 1: Custom Event Types

**Add new event types** for specialized use cases:

```typescript
// src/protocol/acp-types.ts - Add new event type
export type PromptEvent =
  | ExistingEvents
  | { type: 'gf3_update'; trit: number; balanced: boolean };

// src/agents/event-mapper.ts - Map from ACP
export function mapAcpEvent(acpEvent: AcpEvent): PromptEvent {
  if (acpEvent.type === 'gf3_notification') {
    return {
      type: 'gf3_update',
      trit: acpEvent.trit,
      balanced: acpEvent.balanced,
    };
  }
  // ... existing mappings
}

// src/cli/app.tsx - Handle in CLI
const handlePromptEvent = (event: PromptEvent) => {
  if (event.type === 'gf3_update') {
    setGf3State({ trit: event.trit, balanced: event.balanced });
  }
  // ... existing handlers
};
```

### Extension Point 2: Custom Slash Commands

**Add new commands** that interact with ACP:

```typescript
// src/cli/handlers/command-handlers.ts
export async function handleGf3Command(args: string[], context: CommandContext) {
  const [subcommand] = args;
  
  if (subcommand === 'balance') {
    // Integration Point: Slash command → ACP request
    const result = await context.acpClient.request('gf3/check_balance', {});
    
    context.appendOutput({
      type: 'system',
      content: `GF(3) Balance: ${result.balanced ? '✓' : '⚠'} (sum: ${result.sum})`,
      color: result.balanced ? 'green' : 'yellow',
    });
  }
}

COMMANDS['gf3'] = handleGf3Command;
```

### Extension Point 3: Custom ACP Methods

**Add new server-side methods**:

```typescript
// src/server/handlers/gf3-balance.ts
export async function handleGf3Balance(
  params: {},
  context: HandlerContext
): Promise<Gf3BalanceResult> {
  // Integration Point: Custom ACP method
  const tracker = context.gf3Tracker;
  if (!tracker) {
    throw new Error('GF(3) tracking not enabled');
  }
  
  const balance = tracker.getBalance();
  return {
    balanced: balance.balanced,
    sum: balance.sum,
    operations: tracker.getOperations(),
  };
}

// src/server/http-server.ts - Register handler
const HANDLERS: Record<string, AcpHandler> = {
  // ... existing handlers
  'gf3/check_balance': handleGf3Balance,
};
```

---

## 6. Duck Integration Strategy

### Strategy: ACP Bridge Layer

**Goal**: Allow vers-agent CLI to communicate with duck VMs using ACP protocol

```
┌────────────────────────────────────────────────────────────┐
│              VERS-AGENT CLI (TypeScript)                   │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  useAcpClient                                        │  │
│  │  - sendPrompt() → POST /rpc                          │  │
│  │  - streamEvents() → GET /events                      │  │
│  └───────────────────┬──────────────────────────────────┘  │
│                      │                                     │
└──────────────────────┼─────────────────────────────────────┘
                       │ HTTP (localhost:9999)
                       ↓
┌────────────────────────────────────────────────────────────┐
│           VERS-AGENT SERVER (TypeScript)                   │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  HTTP Server + ACP Handlers                          │  │
│  └───────────────────┬──────────────────────────────────┘  │
│                      │                                     │
│                      ├─→ Normal agents (Claude Code, etc.) │
│                      │                                     │
│                      ├─→ NEW: Duck Bridge                  │
│  ┌───────────────────┴──────────────────────────────────┐  │
│  │  Duck Bridge Module                                  │  │
│  │  - Detects duck:// URLs                              │  │
│  │  - Converts ACP → S-expressions (EDN)                │  │
│  │  - Routes to duck VMs                                │  │
│  └───────────────────┬──────────────────────────────────┘  │
│                      │                                     │
└──────────────────────┼─────────────────────────────────────┘
                       │ HTTP + EDN (localhost:9000-9002)
                       ↓
┌────────────────────────────────────────────────────────────┐
│              DUCK VMs (nbb agents)                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │  MINUS (-1)  │  │ ERGODIC (0)  │  │  PLUS (+1)   │    │
│  │  Validator   │  │ Coordinator  │  │  Generator   │    │
│  │  :9000       │  │ :9001        │  │  :9002       │    │
│  └──────────────┘  └──────────────┘  └──────────────┘    │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### Implementation: Duck Bridge Module

**File**: `src/bridge/duck-bridge.ts`

```typescript
import { ContentBlock, PromptEvent } from '../protocol/acp-types';

interface DuckVmConfig {
  url: string;
  alias: string;
  trit: -1 | 0 | 1;
}

export class DuckBridge {
  private vms: Map<string, DuckVmConfig> = new Map();
  
  registerVm(config: DuckVmConfig) {
    this.vms.set(config.alias, config);
  }
  
  // Integration Point: ACP → Duck S-expressions
  async sendPrompt(
    vmAlias: string,
    prompt: ContentBlock[]
  ): AsyncGenerator<PromptEvent> {
    const vm = this.vms.get(vmAlias);
    if (!vm) throw new Error(`VM ${vmAlias} not registered`);
    
    // Extract text from content blocks
    const text = prompt
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');
    
    // Convert to S-expression (EDN)
    const sexp = `[:flow :inject :exec {:code "${text}"}]`;
    
    // Send to duck VM
    const response = await fetch(vm.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/edn' },
      body: sexp,
    });
    
    const result = await response.text();
    
    // Parse EDN result (simplified - use proper EDN parser)
    const parsed = JSON.parse(result);
    
    // Convert duck result to ACP events
    yield { type: 'text_delta', text: `[${vm.alias}] ` };
    yield { type: 'text_delta', text: JSON.stringify(parsed.result, null, 2) };
    yield { type: 'done', usage: { inputTokens: 0, outputTokens: 0 } };
  }
}
```

### Integration into Agent Manager

```typescript
// src/core/agent-manager.ts - Enhanced with duck support
export class AgentManager {
  private duckBridge?: DuckBridge;
  
  async initialize(config: AgentConfig) {
    // ... existing initialization
    
    // Check if duck mode enabled
    if (config.duckMode) {
      this.duckBridge = new DuckBridge();
      
      // Register duck VMs
      this.duckBridge.registerVm({
        url: 'http://localhost:9000',
        alias: 'validator',
        trit: -1,
      });
      this.duckBridge.registerVm({
        url: 'http://localhost:9001',
        alias: 'coordinator',
        trit: 0,
      });
      this.duckBridge.registerVm({
        url: 'http://localhost:9002',
        alias: 'generator',
        trit: 1,
      });
      
      logStream.info('Duck bridge initialized with 3 VMs');
    }
  }
  
  async runTask(params: RunTaskParams) {
    // Check if prompt targets duck VM
    const duckMatch = params.prompt.match(/^@duck:(\w+)\s+(.+)/);
    
    if (duckMatch && this.duckBridge) {
      const [, vmAlias, actualPrompt] = duckMatch;
      
      // Route to duck VM
      const events = this.duckBridge.sendPrompt(vmAlias, [
        { type: 'text', text: actualPrompt }
      ]);
      
      for await (const event of events) {
        this.sseManager.broadcast(event);
      }
      
      return;
    }
    
    // ... existing normal agent execution
  }
}
```

### CLI Usage

```bash
# In vers-agent CLI:
> @duck:validator verify this code is secure
# [validator] {"status": "executed", "result": {...}, "trit": -1}

> @duck:generator create a new authentication module
# [generator] {"status": "executed", "result": {...}, "trit": +1}

> @duck:coordinator route this request
# [coordinator] {"status": "executed", "result": {...}, "trit": 0}
```

---

## 7. Implementation Patterns

### Pattern 1: Request-Response via ACP

**Use case**: Synchronous operations (get config, load session)

```typescript
// Client side
const result = await acpClient.request('session/load', {
  sessionId: 'abc123'
});

// Server side
export async function handleSessionLoad(params, context) {
  const outputs = await sessionStore.loadSession(params.sessionId);
  return { sessionId: params.sessionId, outputs };
}
```

### Pattern 2: Streaming via SSE

**Use case**: Long-running operations with incremental updates

```typescript
// Client side
const eventSource = acpClient.streamEvents();
eventSource.onmessage = (event) => {
  const promptEvent = JSON.parse(event.data);
  handleEvent(promptEvent);
};

// Server side
for await (const event of agentRunner.runPrompt(params)) {
  sseManager.broadcast(event);
}
```

### Pattern 3: Bidirectional Request

**Use case**: Operations requiring user input (permissions)

```typescript
// Agent side (initiates request)
const permission = await requestPermission({
  id: crypto.randomUUID(),
  tool_name: 'Bash',
  input: { command: 'rm -rf /' },
});

// Server broadcasts to CLI
sseManager.broadcast({
  type: 'permission_request',
  request: permission,
});

// CLI responds
await acpClient.request('permission/response', {
  id: permission.id,
  allowed: false,
});

// Server resolves promise to agent
pendingPermissions.get(permission.id).resolve({ allowed: false });
```

### Pattern 4: State Synchronization

**Use case**: Keep CLI in sync with server state

```typescript
// Server emits state updates
sseManager.broadcast({
  type: 'state_update',
  sessionId: 'abc123',
  totalTurns: 5,
  totalCost: 0.15,
});

// CLI updates local state
const handleStateUpdate = (event: StateUpdateEvent) => {
  setSessionInfo({
    turns: event.totalTurns,
    cost: event.totalCost,
  });
};
```

---

## Summary: Key Integration Points

| # | Integration Point | Purpose | Files Involved |
|---|-------------------|---------|----------------|
| 1 | CLI → ACP Client | User input to ACP requests | `use-acp-client.ts`, `http-client.ts` |
| 2 | ACP Server → Agent | Route requests to execution | `session-prompt.ts`, `agent-manager.ts` |
| 3 | Agent → Event Stream | Convert stdout to events | `subprocess-manager.ts`, `event-mapper.ts` |
| 4 | Event Stream → CLI | Render events in UI | `app.tsx`, `output-area.tsx` |
| 5 | Permission Flow | Bidirectional approval | `agent-runner.ts`, `permission-dialog.tsx` |
| 6 | Duck Bridge | Interop with duck VMs | `duck-bridge.ts` (new) |

---

## Next Steps

1. **Review current ACP implementation** in `src/protocol/` and `src/server/`
2. **Test existing integration points** with unit tests
3. **Implement duck bridge module** following Pattern 6
4. **Add slash commands** for duck VM interaction
5. **Document new ACP methods** for duck compatibility
6. **Create integration tests** for full flow

---

*ACP-CLI Integration documentation created 2026-01-12*  
*For related documentation, see:*
- `docs/ARCHITECTURE.md` - System architecture
- `docs/COMPARATIVE-ANALYSIS.md` - vers-agent vs duck comparison
- `docs/INTEGRATION-PLAN.md` - Toad & nbb integration plan
