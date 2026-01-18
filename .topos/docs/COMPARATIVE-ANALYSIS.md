# Comparative Analysis: vers-agent vs duck

> A detailed comparison of two complementary agent orchestration systems

**Date**: 2026-01-12  
**Codebase Locations**:
- vers-agent: `/Users/bob/i/agent`
- duck: `/Users/bob/i/duck`

---

## Executive Summary

**vers-agent** and **duck** are two distinct yet complementary approaches to agent orchestration:

- **vers-agent** is a **production-ready, user-facing CLI** built with TypeScript/Bun, focused on providing an intuitive terminal interface for multi-agent conversations with session persistence and real-time streaming.

- **duck** is a **research-oriented, mathematically rigorous framework** built with Babashka/Clojure, focused on triadic VM orchestration with enforced GF(3) conservation laws and category-theoretic foundations.

Both systems share common infrastructure (Vers CLI for VM management, ACP protocol) but diverge significantly in philosophy, implementation, and use cases.

---

## Table of Contents

1. [Architectural Comparison](#1-architectural-comparison)
2. [Technology Stack](#2-technology-stack)
3. [Data Flow Patterns](#3-data-flow-patterns)
4. [Protocol & Communication](#4-protocol--communication)
5. [State Management](#5-state-management)
6. [User Experience](#6-user-experience)
7. [Mathematical Foundations](#7-mathematical-foundations)
8. [Extension & Integration](#8-extension--integration)
9. [Use Cases](#9-use-cases)
10. [Strengths & Weaknesses](#10-strengths--weaknesses)
11. [Convergence & Divergence](#11-convergence--divergence)

---

## 1. Architectural Comparison

### High-Level Architecture

#### vers-agent: Monolithic Agent with Rich CLI

```
┌────────────────────────────────────────────────────────────┐
│                    VERS-AGENT ARCHITECTURE                  │
├────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────┐                                       │
│  │   Ink CLI (UI)  │  (React-based terminal interface)     │
│  │  - StatusBar    │                                       │
│  │  - OutputArea   │                                       │
│  │  - InputBar     │                                       │
│  │  - Permissions  │                                       │
│  └────────┬────────┘                                       │
│           │ HTTP Client (POST /rpc, GET /events)           │
│           ↓                                                 │
│  ┌─────────────────┐                                       │
│  │  Bun HTTP       │  (JSON-RPC 2.0 endpoint)              │
│  │  Server :9999   │                                       │
│  │  - POST /rpc    │                                       │
│  │  - GET /events  │  (SSE streaming)                      │
│  └────────┬────────┘                                       │
│           │ agent-manager.runTask()                        │
│           ↓                                                 │
│  ┌─────────────────┐                                       │
│  │  AgentManager   │  (Lifecycle, session management)      │
│  │  - Agent Runner │                                       │
│  │  - Subprocess   │                                       │
│  │  - Event Stream │                                       │
│  └────────┬────────┘                                       │
│           │ JSON-RPC stdin/stdout                          │
│           ↓                                                 │
│  ┌─────────────────┐                                       │
│  │  Claude Code    │  (Single AI agent subprocess)         │
│  │  Process        │                                       │
│  └────────┬────────┘                                       │
│           │                                                 │
│  ┌────────┴────────┐                                       │
│  │ SQLite Storage  │  (Sessions, outputs)                  │
│  │ JSON Config     │  (Settings in ~/.vers/)               │
│  └─────────────────┘                                       │
└────────────────────────────────────────────────────────────┘

Architecture: Centralized, single-agent, UI-focused
```

#### duck: Triadic VM Cluster with Harness

```
┌────────────────────────────────────────────────────────────┐
│                     DUCK ARCHITECTURE                       │
├────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────┐                                       │
│  │  Toad (CLI)     │  (API key detection, banner)          │
│  │  bb duck.bb     │                                       │
│  └────────┬────────┘                                       │
│           │ vers execute                                    │
│           ↓                                                 │
│  ┌─────────────────────────────────────────────┐           │
│  │         HARNESS (bb/nbb bridge)             │           │
│  │  - INJECT (+1): outside → inside            │           │
│  │  - EMIT   (-1): inside → outside            │           │
│  │  - BRIDGE ( 0): bidirectional transform     │           │
│  │                                             │           │
│  │  GF(3) Conservation: +1 + 0 + -1 ≡ 0       │           │
│  └────────┬────────────────────────────────────┘           │
│           │                                                 │
│     ┌─────┴──────┐                                         │
│     │  S-EXPR    │  (sexp.bb - AlephNotation)              │
│     │  Protocol  │                                         │
│     └─────┬──────┘                                         │
│           │ JSON-RPC over HTTP:9000                        │
│           ↓                                                 │
│  ┌────────────────────────────────────────┐                │
│  │      TRIADIC VM CLUSTER                │                │
│  │                                        │                │
│  │  ┌────────┐    ┌────────┐    ┌──────┐ │                │
│  │  │MINUS(-1│    │ERGODIC │    │PLUS  │ │                │
│  │  │Validate│◄───┤  (0)   ├───►│ (+1) │ │                │
│  │  │  (Red) │    │Coord.  │    │Gen.  │ │                │
│  │  │        │    │(Orange)│    │(Grn) │ │                │
│  │  └────────┘    └────────┘    └──────┘ │                │
│  │                                        │                │
│  │  Each VM: nbb agent.cljs on :9000     │                │
│  └────────┬───────────────────────────────┘                │
│           │                                                 │
│  ┌────────┴────────┐                                       │
│  │  DuckDB         │  (bootstrap.duckdb, xm.duckdb)        │
│  │  - Interaction  │                                       │
│  │  - GF(3) logs   │                                       │
│  │  - Analytics    │                                       │
│  └─────────────────┘                                       │
└────────────────────────────────────────────────────────────┘

Architecture: Distributed, triadic, math-enforced balance
```

### Key Architectural Differences

| Aspect | vers-agent | duck |
|--------|-----------|------|
| **Agent Count** | Single agent per session | 3 agents per cluster (MINUS, ERGODIC, PLUS) |
| **UI Layer** | Rich Ink/React terminal UI | Minimal Toad banner + REPL |
| **Communication** | HTTP client ↔ server | Harness (bb ↔ nbb via vers execute) |
| **State Balance** | None enforced | GF(3) conservation mandatory |
| **VM Abstraction** | Hidden from user | First-class (triadic cluster) |
| **Entry Point** | Single executable (`./vers-agent`) | Command dispatcher (`just duck`) |
| **Configuration** | JSON files in ~/.vers/ | vers.toml + DuckDB |

---

## 2. Technology Stack

### Runtime & Languages

| Component | vers-agent | duck |
|-----------|-----------|------|
| **Primary Runtime** | Bun (JavaScript/TypeScript) | Babashka (Clojure, JVM-less) |
| **Agent Runtime** | Node.js (Claude Code process) | nbb (Node.js + ClojureScript) |
| **UI Framework** | Ink (React for terminal) | None (direct terminal output) |
| **HTTP Server** | Bun.serve() | nbb HTTP server (:9000) |
| **Database** | bun:sqlite (embedded) | DuckDB (embedded, columnar) |
| **Process IPC** | JSON-RPC stdin/stdout | JSON-RPC HTTP + vers execute |
| **Configuration** | JSON | TOML + EDN |
| **Build System** | Bun scripts | Justfile |

### Dependencies

#### vers-agent Dependencies
- **Bun**: Runtime for TypeScript
- **Ink**: Terminal UI framework
- **Zod**: Schema validation
- **sqlite**: Session persistence
- **Vers CLI**: VM management
- **Claude Code**: AI agent subprocess

#### duck Dependencies
- **Babashka**: Clojure scripting
- **nbb**: Node.js for ClojureScript
- **DuckDB**: Analytics database
- **Vers CLI**: VM orchestration
- **NATS** (optional): Event pub/sub
- **Gay.jl** (via skill): Color semantics
- **Rhizome** (optional): Haskell integration

### Lines of Code

| System | Total LOC | Primary Language | Files |
|--------|-----------|------------------|-------|
| **vers-agent** | ~15,000 | TypeScript | 150+ |
| **duck** | ~2,863 | Babashka/Clojure | ~15 core |

**Observation**: duck achieves complex triadic orchestration with **~5x less code** through Clojure's expressiveness and homoiconicity.

---

## 3. Data Flow Patterns

### vers-agent: Linear Request-Response

```
User Input (CLI)
   ↓
Input Handler (parse slash commands)
   ↓
Queue Prompt → HTTP POST /rpc (session/prompt)
   ↓
Server Handler (route by method)
   ↓
AgentManager.runTask()
   ↓
AgentRunner.runPrompt() → SubprocessManager
   ↓
Claude Code Process (stdin/stdout JSON-RPC)
   ↓
Events Stream (text_delta, tool_use, tool_result)
   ↓
SSE Manager → GET /events → CLI
   ↓
OutputArea Renderer (Ink components)
   ↓
SQLite Persistence (session_outputs table)
```

**Characteristics**:
- **Synchronous request**: User waits for response
- **Streaming response**: Events flow via SSE
- **Single agent**: One AI at a time
- **Persistent history**: SQLite storage

### duck: Cyclic Harness with GF(3) Conservation

```
Outside (bb)                    Inside (nbb)
    │                                │
    │  INJECT (+1)                   │
    │  [:flow :inject :exec {...}]   │
    ├───────────────────────────────►│
    │                                │ Execute code
    │                                │ update-trit! +1
    │                                │
    │  EMIT (-1)                     │
    │  [:flow :emit :state nil]      │
    ├───────────────────────────────►│
    │                                │ Return state
    │  {:status :ok :state {...}}    │ update-trit! -1
    │◄───────────────────────────────┤
    │                                │
    │  BRIDGE (0)                    │
    │  [:flow :bridge :transform {}] │
    ├───────────────────────────────►│
    │◄───────────────────────────────┤ Bidirectional
    │                                │ update-trit! 0
    │                                │
    └────── GF(3) CHECK ─────────────┘
    (+1) + (-1) + (0) ≡ 0 (mod 3) ✓

DuckDB logging: all flows recorded
```

**Characteristics**:
- **Asynchronous cycles**: Multiple INJECT/EMIT passes
- **Triadic balance**: GF(3) conservation enforced
- **Three agents**: MINUS, ERGODIC, PLUS work in parallel
- **Analytical storage**: DuckDB for queries

---

## 4. Protocol & Communication

### vers-agent: ACP via JSON-RPC Subprocess

**Method**: JSON-RPC 2.0 over stdin/stdout

**Example Request**:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "session/prompt",
  "params": {
    "sessionId": "abc123",
    "prompt": {
      "role": "user",
      "content": [{"type": "text", "text": "Hello"}]
    }
  }
}
```

**Example Response** (via notification):
```json
{
  "jsonrpc": "2.0",
  "method": "notification/event",
  "params": {
    "type": "text_delta",
    "text": "Hello! How can I help you?"
  }
}
```

**Transport**: stdin (write) → stdout (read)

### duck: S-Expressions via HTTP Harness

**Method**: EDN S-expressions over JSON-RPC HTTP

**Example Flow**:
```clojure
;; Outside (bb) sends:
[:flow :inject :exec {:code "(+ 1 2)"}]

;; Serialized as JSON-RPC:
{
  "jsonrpc": "2.0",
  "method": "handle_flow",
  "params": {
    "direction": "inject",
    "op": "exec",
    "payload": {"code": "(+ 1 2)"}
  }
}

;; Inside (nbb) responds:
{
  "status": "executed",
  "result": 3,
  "trit": 1
}
```

**Transport**: HTTP POST → :9000

### Protocol Philosophy

| Dimension | vers-agent | duck |
|-----------|-----------|------|
| **Protocol** | JSON-RPC (ACP standard) | S-expressions (EDN + ACP) |
| **Data Format** | JSON objects | Homoiconic S-expressions |
| **Transport** | stdin/stdout + HTTP | HTTP + vers execute |
| **Streaming** | SSE (Server-Sent Events) | Request-response cycles |
| **Directionality** | Unidirectional (client→agent) | Bidirectional (harness) |

**Key Insight**: duck's S-expressions enable **code-as-data**, allowing outside (bb) to inject arbitrary Clojure expressions into inside (nbb) VMs. vers-agent treats prompts as strings, not executable code.

---

## 5. State Management

### vers-agent: SQLite Session Persistence

**Schema**:
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
  PRIMARY KEY (session_id, seq)
);
```

**Access Pattern**:
- **Write**: Append output line after each event
- **Read**: Load full session history on resume
- **Query**: List sessions ordered by last_used_at

**Location**: `~/.vers-agent/sessions.db`

### duck: DuckDB Analytics Storage

**Schema** (simplified):
```sql
CREATE TABLE xm_key_spend (
  ts TIMESTAMP,
  vm_alias TEXT,
  trit INTEGER,  -- GF(3) value
  cost_usd REAL,
  tokens INTEGER
);

CREATE TABLE xm_flows (
  flow_id TEXT,
  direction TEXT,  -- 'inject', 'emit', 'bridge'
  trit INTEGER,
  op TEXT,
  payload JSON
);

CREATE TABLE bootstrap_log (
  event_type TEXT,
  data JSON
);
```

**Access Pattern**:
- **Write**: Log every flow with trit value
- **Read**: Aggregate queries (SUM, GROUP BY)
- **Analytics**: GF(3) conservation checks, cost analysis

**Location**: `~/i/duck/xm.duckdb`, `bootstrap.duckdb`

### State Philosophy

| Dimension | vers-agent | duck |
|-----------|-----------|------|
| **Purpose** | Conversation history | Analytics + auditing |
| **Structure** | Relational (normalized) | Columnar (analytical) |
| **Primary Query** | Load session by ID | Aggregate by trit/VM |
| **Conservation** | None | GF(3) balance checks |
| **Size** | ~10MB per 100 sessions | ~170MB (playlist_transcripts.duckdb) |

---

## 6. User Experience

### vers-agent: Rich Interactive CLI

**Features**:
- **Real-time rendering**: Ink/React components
- **Syntax highlighting**: Code blocks with language detection
- **Tool collapsing**: Hide/show tool details
- **Progress indicators**: Spinners for long operations
- **Permission dialogs**: Interactive approval UI
- **Command history**: Per-session recall with arrow keys
- **Slash commands**: `/new`, `/continue`, `/model`, `/agent`, etc.
- **Path completion**: `@src/in<TAB>` → `@src/index.ts`
- **Status bar**: Model, session ID, connection status

**Example Session**:
```
┌────────────────────────────────────────────────────────┐
│ claude-sonnet-4-5 ● Session: abc123 [Claude Code]     │
├────────────────────────────────────────────────────────┤
│ User: Help me refactor the authentication module      │
│                                                        │
│ Assistant: I'll analyze the authentication code and   │
│ suggest refactoring improvements.                     │
│                                                        │
│ ▼ Read(file_path="src/auth.ts")                       │
│   [219 lines, 5.2KB]                                  │
│                                                        │
│ I recommend extracting the password hashing logic...  │
├────────────────────────────────────────────────────────┤
│ > _                                                    │
└────────────────────────────────────────────────────────┘
```

### duck: Minimal REPL + Toad Banner

**Features**:
- **Toad banner**: ASCII art + API key detection
- **S-expression REPL**: Direct EDN evaluation
- **GF(3) feedback**: Trit balance displayed
- **VM routing**: Explicit cluster member selection
- **Justfile commands**: 30+ targets for operations
- **DuckDB queries**: SQL analytics via `just duck query`

**Example Session**:
```bash
$ just duck validator

🐸 The duck inhabits the toad

Detected API keys: ✓ ANTHROPIC_API_KEY, ✓ OPENAI_API_KEY

Starting ACP server on :9000...

duck> [:flow :inject :exec {:code "(map inc [1 2 3])"}]
{:status :executed :result [2 3 4] :trit 1}

duck> [:flow :emit :state nil]
{:status :ok :state {...} :trit -1}

duck> (check-conservation)
GF(3) Balance: (+1) + (-1) ≡ 0 (mod 3) ✓
```

### UX Philosophy

| Dimension | vers-agent | duck |
|-----------|-----------|------|
| **Target User** | End users, developers | Researchers, system architects |
| **Learning Curve** | Low (familiar chat interface) | High (requires Clojure/GF(3) knowledge) |
| **Feedback** | Visual (colors, spinners, dialogs) | Textual (trits, S-expressions) |
| **Discoverability** | `/help` command, autocomplete | `just --list`, documentation |
| **Error Messages** | User-friendly | Technical (stack traces) |

---

## 7. Mathematical Foundations

### vers-agent: Operational (Implicit Math)

**Mathematical Properties**:
- **Determinism**: Same inputs → same outputs (via seeded RNG in tools)
- **Idempotency**: Session resume is idempotent
- **Concurrency**: Task queue prevents race conditions

**Not Enforced**:
- No explicit conservation laws
- No category-theoretic structure
- No trit balancing

### duck: Category-Theoretic (Explicit Math)

**Mathematical Foundations**:

#### 1. **GF(3) Conservation**
Every sequence of operations must satisfy:
```
∑ trits ≡ 0 (mod 3)
```

Where:
- INJECT: +1
- EMIT: -1
- BRIDGE: 0

**Why**: Prevents ergodicity breaking. Unbalanced flows trap systems in local optima.

#### 2. **Galois Connection** (Color Semantics)
```
WorldRuntime × Branch ⇄ Color
```

Bidirectional mapping via Gay.jl:
- Forward: (vm-id, branch) → color (deterministic)
- Backward: color → possible (vm-id, branch) pairs

#### 3. **Open Game Structure**
```haskell
data OpenGame o c a b x s y r = OpenGame
  { play   :: a → o x s y r    -- Forward: action
  , coplay :: a → c x s y r → b -- Backward: evaluation
  }
```

Every interaction has:
- **Forward pass**: Computation (play)
- **Backward pass**: Evaluation (coplay)

#### 4. **Frobenius Algebra**
```
μ: A ⊗ A → A   (multiplication)
η: I → A       (unit)
Δ: A → A ⊗ A   (comultiplication)
ε: A → I       (counit)
```

Ensures:
- Associativity: (a ⊗ b) ⊗ c = a ⊗ (b ⊗ c)
- Unit laws: η ⊗ id = id = id ⊗ η
- Frobenius law: (μ ⊗ id) ∘ (id ⊗ Δ) = Δ ∘ μ = (id ⊗ μ) ∘ (Δ ⊗ id)

Used for copy-on-interact semantics.

#### 5. **AlephNotation** (Cardinality-Driven Trits)
Operations classified by cardinality:

| Aleph | Cardinality | Trit | Examples |
|-------|------------|------|----------|
| ℵ₀ | Countable | -1 | query, list, get |
| ℵ₁ | Continuous | 0 | stream, watch, observe |
| ℵω | Inaccessible | +1 | fork, create, synthesize |

Automatic trit assignment based on operation type.

### Comparison

| Aspect | vers-agent | duck |
|--------|-----------|------|
| **Explicit Math** | No | Yes (GF(3), category theory) |
| **Conservation** | None | GF(3) balance enforced |
| **Trits** | N/A | -1, 0, +1 (MINUS, ERGODIC, PLUS) |
| **Galois Connection** | No | Yes (color semantics) |
| **Open Games** | No | Yes (forward/backward passes) |
| **Frobenius Algebra** | No | Yes (copy-on-interact) |
| **Cardinality Classes** | No | Yes (AlephNotation) |

---

## 8. Extension & Integration

### vers-agent Extensions

**1. Adding New Agents**:
```json
// src/data/agents/custom.json
{
  "identity": "custom.ai",
  "name": "Custom AI",
  "runCommand": "custom-cli",
  "args": ["--acp"],
  "models": ["custom-model-1"]
}
```

**2. Adding Slash Commands**:
```typescript
// src/cli/handlers/command-handlers.ts
export async function handleCustomCommand(args: string[]) {
  // Implementation
}

COMMANDS["custom"] = handleCustomCommand;
```

**3. Custom Tools**:
Inherited from agent (e.g., Claude Code provides Read, Write, Bash).

**4. MCP Servers**:
```yaml
# ~/.vers/mcp-config.yaml
filesystem:
  command: npx
  args: ["-y", "@modelcontextprotocol/server-filesystem"]
```

### duck Extensions

**1. Adding New Flow Operations**:
```clojure
;; sexp.bb
(defn handle-custom-op [{:keys [payload]}]
  ;; Implementation
  {:status :ok :result ...})

(defmethod duck-eval :custom [op payload]
  (handle-custom-op {:payload payload}))
```

**2. Adding VMs to Cluster**:
```bash
# Create 4th VM (breaks GF(3) balance intentionally)
bb toaducken/duck.bb create-vm --alias "observer" --trit 0
```

**3. Custom Aleph Classifications**:
```clojure
;; sexp.bb
(defn classify-operation [op]
  (cond
    (#{:my-custom-query} op) {:aleph :aleph-0 :trit -1}
    :else (default-classify op)))
```

**4. Rhizome Integration**:
```clojure
;; duck-rhizome-bridge.bb
(defn emit-to-rhizome [flow-data]
  (nats/publish "duck.flows" (pr-str flow-data)))
```

### Integration Points

| System | vers-agent Integration | duck Integration |
|--------|----------------------|------------------|
| **External APIs** | Anthropic, OpenAI (via agent) | API keys detected & injected |
| **Databases** | SQLite (sessions) | DuckDB (analytics) |
| **Message Queues** | None | NATS (via rhizome bridge) |
| **Monitoring** | Log files | DuckDB queries, GF(3) checks |
| **VM Management** | Vers CLI (implicit) | Vers CLI (explicit triadic) |

---

## 9. Use Cases

### vers-agent: Production AI Assistance

**Primary Use Cases**:

1. **Interactive Development**
   - Code review and refactoring
   - Bug fixing with context
   - Feature implementation
   - Documentation generation

2. **DevOps Tasks**
   - Log analysis
   - Configuration management
   - Deployment automation
   - Incident investigation

3. **Multi-Agent Workflows**
   - Switch between Claude, OpenAI, Goose
   - Compare outputs across models
   - Resume interrupted sessions

4. **Team Collaboration**
   - Shared agent server (HTTP mode)
   - Session persistence for handoff
   - Cost tracking per session

**Example Workflow**:
```bash
# Developer workflow
./vers-agent
> /new
> Refactor the authentication module to use dependency injection
> [Agent analyzes code, suggests changes, awaits approval]
> /continue
> [Resume after lunch break]
```

### duck: Research & Orchestration

**Primary Use Cases**:

1. **GF(3) Conservation Experiments**
   - Test ergodicity-breaking conditions
   - Validate trit balancing algorithms
   - Measure verifier exhaustion

2. **Triadic Agent Coordination**
   - MINUS agent validates outputs
   - ERGODIC agent routes between agents
   - PLUS agent generates new possibilities

3. **DuckDB Analytics**
   - Aggregate spend by VM/trit
   - Analyze GF(3) balance over time
   - Detect conservation violations

4. **Category Theory Research**
   - Implement open game structures
   - Test Frobenius algebra properties
   - Explore Galois connections

**Example Workflow**:
```bash
# Researcher workflow
just triadic-create  # Spawn 3 VMs
just duck validator  # Connect to MINUS agent
duck> [:flow :inject :exec {:code "(verify-gf3-balance flows)"}]
duck> [:flow :emit :state nil]
just duck query "SELECT vm_alias, SUM(trit) FROM xm_flows GROUP BY vm_alias"
# Verify conservation across all VMs
```

### Use Case Matrix

| Use Case | vers-agent | duck |
|----------|-----------|------|
| **Daily coding assistant** | ✅ Primary | ❌ Overkill |
| **Production deployment** | ✅ Stable | ⚠️ Experimental |
| **Multi-VM orchestration** | ⚠️ Manual | ✅ Native |
| **Mathematical experiments** | ❌ No support | ✅ Designed for |
| **Analytics & auditing** | ⚠️ Basic (logs) | ✅ DuckDB SQL |
| **Team collaboration** | ✅ HTTP mode | ⚠️ Requires setup |
| **Category theory research** | ❌ No support | ✅ Core feature |

---

## 10. Strengths & Weaknesses

### vers-agent

#### Strengths ✅
- **User-friendly**: Intuitive CLI with visual feedback
- **Production-ready**: Stable, well-tested, documented
- **Rich UI**: Ink/React terminal interface
- **Session persistence**: Resume conversations seamlessly
- **Multi-agent support**: Easy switching between providers
- **Real-time streaming**: SSE for responsive UX
- **Low learning curve**: Familiar chat interface
- **Active development**: Regular updates and fixes

#### Weaknesses ❌
- **Single agent**: No built-in multi-agent coordination
- **No conservation laws**: Can have runaway states
- **Limited analytics**: Basic logging only
- **Opaque internals**: Less visibility into state
- **TypeScript overhead**: Build complexity
- **No mathematical framework**: Operational only

### duck

#### Strengths ✅
- **Mathematically rigorous**: GF(3) conservation enforced
- **Triadic by design**: MINUS/ERGODIC/PLUS agents native
- **Powerful analytics**: DuckDB for complex queries
- **Homoiconic**: S-expressions = code = data
- **Concise codebase**: ~2.8K lines vs 15K
- **Research-oriented**: Category theory foundations
- **Explicit VM management**: Full control over cluster
- **Extensible**: Easy to add new flow operations

#### Weaknesses ❌
- **Steep learning curve**: Requires Clojure + GF(3) knowledge
- **Minimal UI**: No rich terminal interface
- **Experimental**: Not production-tested
- **Documentation gaps**: Assumes mathematical background
- **Manual workflows**: Less automated than vers-agent
- **Limited tooling**: No IDE integration
- **Niche use cases**: Not general-purpose

---

## 11. Convergence & Divergence

### Shared Infrastructure

Both systems share:

1. **Vers CLI** for VM management
2. **ACP Protocol** (JSON-RPC)
3. **Environment variable configuration**
4. **Session concept** (though implemented differently)
5. **Multi-agent support** (different approaches)
6. **Deterministic execution** (to varying degrees)

### Philosophical Divergence

| Philosophy | vers-agent | duck |
|-----------|-----------|------|
| **Design Goal** | Usability first | Rigor first |
| **User Base** | Developers, teams | Researchers, theorists |
| **Complexity** | Hidden (abstracted) | Exposed (visible) |
| **State** | Implicit (logs) | Explicit (GF(3) trits) |
| **Math** | Operational | Category-theoretic |
| **Feedback** | Visual (UI) | Analytical (queries) |

### Potential Convergence Points

**1. Hybrid UI**
- Integrate duck's GF(3) visualization into vers-agent's Ink UI
- Show trit balance in status bar

**2. Shared Analytics**
- vers-agent could log to DuckDB instead of SQLite
- Enable cross-system analytics

**3. Triadic Mode for vers-agent**
- Add optional `/triadic-mode` command
- Spawn MINUS/ERGODIC/PLUS agents on demand

**4. Rich UI for duck**
- Build Ink-based Toad UI
- Maintain GF(3) feedback with better visualization

**5. Unified Configuration**
- Converge on TOML or JSON
- Share agent definitions

---

## Conclusion

**vers-agent** and **duck** represent two complementary approaches to agent orchestration:

- **vers-agent** excels at **production use cases** where user experience, stability, and ease of use are paramount. It's the tool you reach for when building real applications.

- **duck** excels at **research and experimentation** where mathematical rigor, multi-VM orchestration, and analytical visibility are required. It's the framework you use to push boundaries and explore new paradigms.

**Neither is a replacement for the other.** Instead, they demonstrate:
- **Different trade-offs** in the design space
- **Complementary strengths** that could be combined
- **Shared foundations** (Vers, ACP) enabling interoperability

The ideal future might involve:
- **vers-agent for UI/UX layer**
- **duck for orchestration/analytics layer**
- **Shared protocol** enabling seamless integration

---

## Appendix: Quick Reference

### Command Comparison

| Task | vers-agent | duck |
|------|-----------|------|
| **Start session** | `./vers-agent` | `just duck <vm-id>` |
| **Create VMs** | Implicit (single agent) | `just triadic-create` |
| **List sessions** | `/sessions` | `just duck query "SELECT * FROM sessions"` |
| **Switch model** | `/model claude-opus-4-5` | Edit vers.toml |
| **Resume session** | `/continue` | Same VM re-connection |
| **Analytics** | View log files | `just duck query <sql>` |
| **Help** | `/help` | `just --list` |

### File Structure Comparison

| Component | vers-agent | duck |
|-----------|-----------|------|
| **Entry Point** | `index.ts` | `toaducken/duck.bb` |
| **Core Logic** | `src/core/agent-manager.ts` | `toaducken/harness.bb` |
| **Protocol** | `src/protocol/acp-types.ts` | `sexp.bb` |
| **UI** | `src/cli/app.tsx` | None (minimal Toad) |
| **Storage** | `src/utils/session-store.ts` | `bootstrap-effective-topos.bb` |
| **Config** | `~/.vers/agent_config.json` | `vers.toml` |
| **Database** | `~/.vers-agent/sessions.db` | `xm.duckdb`, `bootstrap.duckdb` |

---

*Analysis completed 2026-01-12*  
*For questions or updates, consult the respective documentation:*
- vers-agent: `docs/ARCHITECTURE.md`
- duck: `README.md`, `PROCESS_SPECIFICATION_DISTILLED.md`
