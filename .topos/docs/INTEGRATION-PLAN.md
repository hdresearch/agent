# Integration Plan: Bringing Toad & nbb to vers-agent

> How to make vers-agent benefit from duck's Toad aspects and use nbb for codebase bridging

**Date**: 2026-01-12  
**Goal**: Enhance vers-agent with duck's best features while maintaining production stability

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Toad Benefits for vers-agent](#2-toad-benefits-for-vers-agent)
3. [nbb Bridge Architecture](#3-nbb-bridge-architecture)
4. [Phase 1: API Key Detection (Toad Integration)](#phase-1-api-key-detection-toad-integration)
5. [Phase 2: S-Expression Protocol Layer](#phase-2-s-expression-protocol-layer)
6. [Phase 3: GF(3) Conservation Tracking](#phase-3-gf3-conservation-tracking)
7. [Phase 4: nbb Sidecar for Duck Interop](#phase-4-nbb-sidecar-for-duck-interop)
8. [Phase 5: Triadic Mode](#phase-5-triadic-mode)
9. [Implementation Roadmap](#implementation-roadmap)

---

## 1. Executive Summary

### What We Gain from Toad

**Toad** (duck's initialization layer) provides:

1. **Automatic API Key Detection** - Discovers local API keys without manual configuration
2. **Secure Key Injection** - Passes keys to VMs via environment variables
3. **Beautiful Banner** - Creates welcoming user experience
4. **VM Readiness Checking** - Ensures VMs are healthy before connection

### What We Gain from nbb

**nbb** (Node.js + ClojureScript) enables:

1. **S-Expression Protocol** - Homoiconic data (code = data)
2. **Bridge to duck** - Seamless interop between TypeScript and Clojure
3. **REPL Capabilities** - Dynamic code evaluation in running system
4. **GF(3) Tracking** - Mathematical conservation laws from duck

### Integration Strategy

```
┌─────────────────────────────────────────────────────────────┐
│                   ENHANCED VERS-AGENT                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────────────────────────────────────┐           │
│  │  Existing TypeScript Core (Bun)              │           │
│  │  - Ink UI                                    │           │
│  │  - HTTP Server                               │           │
│  │  - Agent Manager                             │           │
│  │  - SQLite Sessions                           │           │
│  └───────────────┬──────────────────────────────┘           │
│                  │                                           │
│                  │ NEW LAYERS ↓                              │
│                  │                                           │
│  ┌───────────────┴──────────────────────────────┐           │
│  │  Toad Integration Layer (TypeScript)         │           │
│  │  - API Key Detection                         │           │
│  │  - Banner Display                            │           │
│  │  - VM Health Checks                          │           │
│  └───────────────┬──────────────────────────────┘           │
│                  │                                           │
│  ┌───────────────┴──────────────────────────────┐           │
│  │  S-Expression Bridge (nbb sidecar)           │           │
│  │  - EDN ↔ JSON conversion                     │           │
│  │  - GF(3) trit tracking                       │           │
│  │  - Duck protocol compatibility                │           │
│  └───────────────┬──────────────────────────────┘           │
│                  │                                           │
│  ┌───────────────┴──────────────────────────────┐           │
│  │  Optional: Triadic Mode                      │           │
│  │  - Spawn MINUS/ERGODIC/PLUS agents           │           │
│  │  - GF(3) conservation enforcement            │           │
│  │  - DuckDB analytics                          │           │
│  └──────────────────────────────────────────────┘           │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

**Principles**:
- **Non-invasive**: Add new layers, don't break existing functionality
- **Opt-in**: Features activated via flags or commands
- **Backward compatible**: Existing workflows unchanged
- **Incremental**: Ship each phase independently

---

## 2. Toad Benefits for vers-agent

### Current State: Manual API Key Management

**Problem**: Users must manually configure API keys in environment or config files.

```bash
# Current workflow
export ANTHROPIC_API_KEY="sk-ant-..."
export OPENAI_API_KEY="sk-..."
./vers-agent
```

### Desired State: Toad-Style Auto-Detection

**Solution**: Automatically discover keys from common locations.

```bash
# New workflow
./vers-agent
# 🐸 Detected: ✓ ANTHROPIC_API_KEY, ✓ OPENAI_API_KEY, ✓ GOOGLE_API_KEY
# Starting with Claude Code...
```

### Toad Features to Adopt

#### 1. **API Key Discovery**

From `duck.bb`, lines 100-150:

```clojure
(defn detect-api-keys []
  (let [key-patterns {"ANTHROPIC_API_KEY" #"sk-ant-.*"
                      "OPENAI_API_KEY" #"sk-.*"
                      "GOOGLE_API_KEY" #".*"
                      "GROQ_API_KEY" #"gsk_.*"}
        env (System/getenv)]
    (->> key-patterns
         (map (fn [[name pattern]]
                (when-let [value (get env name)]
                  (when (re-matches pattern value)
                    {:name name :present true}))))
         (remove nil?))))
```

**TypeScript equivalent**:

```typescript
// src/utils/api-key-detector.ts
interface ApiKeyInfo {
  name: string;
  present: boolean;
  source: 'env' | 'keychain' | 'config';
}

export function detectApiKeys(): ApiKeyInfo[] {
  const keyPatterns = {
    'ANTHROPIC_API_KEY': /^sk-ant-.+/,
    'OPENAI_API_KEY': /^sk-.+/,
    'GOOGLE_API_KEY': /.+/,
    'GROQ_API_KEY': /^gsk_.+/,
  };
  
  const detected: ApiKeyInfo[] = [];
  
  for (const [name, pattern] of Object.entries(keyPatterns)) {
    const value = process.env[name];
    if (value && pattern.test(value)) {
      detected.push({ name, present: true, source: 'env' });
    }
  }
  
  // TODO: Check macOS Keychain
  // TODO: Check config files
  
  return detected;
}
```

#### 2. **Toad Banner**

From `duck.bb`, the ASCII art banner:

```typescript
// src/cli/components/toad-banner.tsx
import { Box, Text } from 'ink';

export const ToadBanner = ({ keys }: { keys: ApiKeyInfo[] }) => {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color="green">
        🐸 The vers-agent is ready
      </Text>
      <Text dimColor>
        Detected API keys: {keys.map(k => `✓ ${k.name}`).join(', ')}
      </Text>
    </Box>
  );
};
```

#### 3. **VM Health Check**

From `duck.bb`, checking VM availability:

```typescript
// src/server/vm-health.ts
interface VmHealth {
  vmId: string;
  healthy: boolean;
  acpPort?: number;
  error?: string;
}

export async function checkVmHealth(vmId: string): Promise<VmHealth> {
  try {
    // Try to connect to ACP endpoint
    const response = await fetch(`http://localhost:9000/health`, {
      timeout: 5000,
    });
    
    if (response.ok) {
      return { vmId, healthy: true, acpPort: 9000 };
    }
    
    return { vmId, healthy: false, error: 'ACP endpoint not responding' };
  } catch (err) {
    return { vmId, healthy: false, error: err.message };
  }
}
```

### Integration into vers-agent

**Modified startup flow**:

```typescript
// index.ts - Enhanced with Toad features
async function startVersAgent() {
  // PHASE 1: Toad-style initialization
  const keys = detectApiKeys();
  
  if (keys.length === 0) {
    console.error('❌ No API keys detected. Please set one of:');
    console.error('   - ANTHROPIC_API_KEY');
    console.error('   - OPENAI_API_KEY');
    console.error('   - GOOGLE_API_KEY');
    process.exit(1);
  }
  
  // Show Toad banner
  console.log('🐸 The vers-agent is ready');
  console.log(`Detected: ${keys.map(k => `✓ ${k.name}`).join(', ')}\n`);
  
  // PHASE 2: Check VM health (if using remote VMs)
  if (config.remoteMode) {
    const health = await checkVmHealth(config.vmId);
    if (!health.healthy) {
      console.error(`❌ VM ${config.vmId} is not healthy: ${health.error}`);
      process.exit(1);
    }
  }
  
  // PHASE 3: Start existing vers-agent
  await startServer();
  await startCli();
}
```

---

## 3. nbb Bridge Architecture

### Why nbb?

**nbb** (Node.js Babashka) provides:

1. **ClojureScript on Node.js** - Same runtime as TypeScript (Bun/Node)
2. **S-expression evaluation** - Homoiconic data
3. **Interop with JavaScript** - Can call TypeScript code
4. **REPL capabilities** - Dynamic evaluation
5. **Duck compatibility** - Same language as duck's harness

### Architecture: nbb as Sidecar Process

```
┌─────────────────────────────────────────────────────────────┐
│                    VERS-AGENT (TypeScript/Bun)              │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Main Process (TypeScript)                                  │
│  ┌──────────────────────────────────────┐                   │
│  │  HTTP Server :9999                   │                   │
│  │  Agent Manager                       │                   │
│  │  Ink CLI                             │                   │
│  └────────────┬─────────────────────────┘                   │
│               │                                              │
│               │ JSON-RPC over Unix Socket                    │
│               │ or HTTP :9998                                │
│               ↓                                              │
│  ┌────────────────────────────────────────┐                 │
│  │  nbb Sidecar Process (ClojureScript)   │                 │
│  │  ┌──────────────────────────────────┐  │                 │
│  │  │  S-Expression Evaluator          │  │                 │
│  │  │  - EDN parser                    │  │                 │
│  │  │  - GF(3) tracker                 │  │                 │
│  │  │  - Duck protocol                 │  │                 │
│  │  └──────────────────────────────────┘  │                 │
│  │                                        │                 │
│  │  ┌──────────────────────────────────┐  │                 │
│  │  │  JavaScript Interop              │  │                 │
│  │  │  - Call TypeScript functions     │  │                 │
│  │  │  - Expose ClojureScript to TS    │  │                 │
│  │  └──────────────────────────────────┘  │                 │
│  └────────────┬───────────────────────────┘                 │
│               │                                              │
│               │ Duck Protocol (EDN/S-expressions)            │
│               ↓                                              │
│  ┌────────────────────────────────────────┐                 │
│  │  Duck VMs (Optional)                   │                 │
│  │  - MINUS, ERGODIC, PLUS                │                 │
│  └────────────────────────────────────────┘                 │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### nbb Sidecar Implementation

#### File: `src/bridge/nbb-sidecar.cljs`

```clojure
(ns vers-agent.bridge
  (:require
    ["net" :as net]
    [clojure.edn :as edn]))

;; GF(3) state tracking
(def gf3-state (atom {:inject 0 :emit 0 :bridge 0}))

(defn update-trit! [direction]
  (let [trit (case direction
               :inject +1
               :emit -1
               :bridge 0)]
    (swap! gf3-state update direction (fnil + 0) trit)))

(defn check-conservation []
  (let [{:keys [inject emit bridge]} @gf3-state
        total (+ inject emit bridge)]
    {:balanced? (zero? (mod total 3))
     :total total
     :state @gf3-state}))

;; S-expression evaluation
(defn eval-sexp [sexp-str]
  (try
    (let [sexp (edn/read-string sexp-str)]
      (case (first sexp)
        :flow (handle-flow (rest sexp))
        :eval (eval (second sexp))
        :check-gf3 (check-conservation)
        {:error "Unknown operation"}))
    (catch js/Error e
      {:error (.-message e)})))

(defn handle-flow [[direction op payload]]
  (update-trit! direction)
  {:status :ok
   :direction direction
   :op op
   :result payload
   :trit (case direction :inject 1 :emit -1 :bridge 0)
   :gf3 (check-conservation)})

;; IPC Server (Unix Socket or TCP)
(defn start-ipc-server [port]
  (let [server (.createServer net
                 (fn [socket]
                   (.on socket "data"
                     (fn [data]
                       (let [request (.toString data)
                             result (eval-sexp request)
                             response (pr-str result)]
                         (.write socket response))))))]
    (.listen server port)
    (println (str "nbb sidecar listening on port " port))
    server))

;; Entry point
(defn -main []
  (start-ipc-server 9998))
```

#### File: `src/bridge/nbb-client.ts`

TypeScript client to communicate with nbb sidecar:

```typescript
// src/bridge/nbb-client.ts
import { spawn, ChildProcess } from 'child_process';
import { Socket } from 'net';

interface SExpResult {
  status?: string;
  direction?: string;
  op?: string;
  result?: unknown;
  trit?: number;
  gf3?: {
    balanced: boolean;
    total: number;
    state: Record<string, number>;
  };
  error?: string;
}

export class NbbBridge {
  private process: ChildProcess | null = null;
  private socket: Socket | null = null;
  private port: number = 9998;
  
  async start() {
    // Spawn nbb sidecar
    this.process = spawn('nbb', ['src/bridge/nbb-sidecar.cljs'], {
      stdio: 'pipe',
    });
    
    // Wait for sidecar to be ready
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Connect to sidecar via TCP
    this.socket = new Socket();
    await new Promise<void>((resolve, reject) => {
      this.socket!.connect(this.port, 'localhost', resolve);
      this.socket!.on('error', reject);
    });
    
    logStream.info('nbb bridge connected');
  }
  
  async evalSexp(sexp: string): Promise<SExpResult> {
    if (!this.socket) throw new Error('nbb bridge not started');
    
    return new Promise((resolve, reject) => {
      this.socket!.write(sexp);
      
      this.socket!.once('data', (data) => {
        try {
          const result = JSON.parse(data.toString());
          resolve(result);
        } catch (err) {
          reject(err);
        }
      });
    });
  }
  
  async inject(op: string, payload: unknown): Promise<SExpResult> {
    const sexp = `[:flow :inject :${op} ${JSON.stringify(payload)}]`;
    return this.evalSexp(sexp);
  }
  
  async emit(op: string): Promise<SExpResult> {
    const sexp = `[:flow :emit :${op} nil]`;
    return this.evalSexp(sexp);
  }
  
  async checkGf3Balance(): Promise<SExpResult> {
    return this.evalSexp('[:check-gf3]');
  }
  
  async stop() {
    this.socket?.destroy();
    this.process?.kill();
  }
}
```

### Usage in vers-agent

```typescript
// src/core/agent-manager.ts - Enhanced with nbb bridge
import { NbbBridge } from '../bridge/nbb-client';

export class AgentManager {
  private nbbBridge?: NbbBridge;
  
  async initialize(config: AgentConfig) {
    // ... existing initialization
    
    // Start nbb bridge if GF(3) tracking enabled
    if (config.enableGf3Tracking) {
      this.nbbBridge = new NbbBridge();
      await this.nbbBridge.start();
      logStream.info('GF(3) tracking enabled via nbb bridge');
    }
  }
  
  async runTask(params: RunTaskParams) {
    // Track as INJECT (+1)
    if (this.nbbBridge) {
      await this.nbbBridge.inject('exec', { prompt: params.prompt });
    }
    
    // ... existing task execution
    
    // Track as EMIT (-1)
    if (this.nbbBridge) {
      const gf3 = await this.nbbBridge.emit('result');
      if (!gf3.gf3?.balanced) {
        logStream.warn('GF(3) imbalance detected:', gf3.gf3);
      }
    }
  }
}
```

---

## Phase 1: API Key Detection (Toad Integration)

### Goal
Automatically detect API keys without manual configuration.

### Implementation

#### 1.1. Create API Key Detector

**File**: `src/utils/api-key-detector.ts`

```typescript
export interface ApiKeyInfo {
  name: string;
  present: boolean;
  source: 'env' | 'keychain' | 'config';
  masked?: string; // First 10 chars for verification
}

const KEY_PATTERNS: Record<string, RegExp> = {
  'ANTHROPIC_API_KEY': /^sk-ant-.{32,}/,
  'OPENAI_API_KEY': /^sk-.{32,}/,
  'GOOGLE_API_KEY': /.{20,}/,
  'GROQ_API_KEY': /^gsk_.{32,}/,
};

export function detectApiKeys(): ApiKeyInfo[] {
  const detected: ApiKeyInfo[] = [];
  
  // Check environment variables
  for (const [name, pattern] of Object.entries(KEY_PATTERNS)) {
    const value = process.env[name];
    if (value && pattern.test(value)) {
      detected.push({
        name,
        present: true,
        source: 'env',
        masked: value.substring(0, 10) + '...',
      });
    }
  }
  
  return detected;
}

export function validateApiKeys(keys: ApiKeyInfo[]): boolean {
  return keys.length > 0;
}
```

#### 1.2. Add Toad Banner Component

**File**: `src/cli/components/toad-banner.tsx`

```typescript
import { Box, Text } from 'ink';
import React from 'react';
import { ApiKeyInfo } from '../../utils/api-key-detector';

interface ToadBannerProps {
  keys: ApiKeyInfo[];
  agentName?: string;
}

export const ToadBanner: React.FC<ToadBannerProps> = ({ keys, agentName }) => {
  const keyList = keys.map(k => `✓ ${k.name}`).join(', ');
  
  return (
    <Box flexDirection="column" marginBottom={1} borderStyle="round" borderColor="green" padding={1}>
      <Text bold color="green">
        🐸 vers-agent is ready
      </Text>
      {agentName && (
        <Text dimColor>
          Agent: <Text color="cyan">{agentName}</Text>
        </Text>
      )}
      <Text dimColor>
        API Keys: {keyList}
      </Text>
    </Box>
  );
};
```

#### 1.3. Integrate into CLI Startup

**File**: `src/cli/app.tsx` (modify)

```typescript
import { ToadBanner } from './components/toad-banner';
import { detectApiKeys, validateApiKeys } from '../utils/api-key-detector';

export const App: React.FC<AppProps> = ({ serverUrl, sessionId }) => {
  const [apiKeys] = useState(() => detectApiKeys());
  const [showBanner, setShowBanner] = useState(true);
  
  // Validate API keys on mount
  useEffect(() => {
    if (!validateApiKeys(apiKeys)) {
      console.error('❌ No valid API keys detected');
      process.exit(1);
    }
    
    // Hide banner after 3 seconds
    setTimeout(() => setShowBanner(false), 3000);
  }, []);
  
  return (
    <Box flexDirection="column" height="100%">
      {showBanner && <ToadBanner keys={apiKeys} agentName={agentName} />}
      <TopStatusBar {...statusProps} />
      <OutputArea {...outputProps} />
      <InputBar {...inputProps} />
    </Box>
  );
};
```

### Testing

```bash
# Test with API keys set
export ANTHROPIC_API_KEY="sk-ant-test123..."
export OPENAI_API_KEY="sk-test456..."
bun run dev

# Expected output:
# 🐸 vers-agent is ready
# API Keys: ✓ ANTHROPIC_API_KEY, ✓ OPENAI_API_KEY
```

---

## Phase 2: S-Expression Protocol Layer

### Goal
Add optional S-expression protocol for duck compatibility.

### Implementation

#### 2.1. Install nbb

```bash
cd ~/i/agent
bun add -d nbb
```

#### 2.2. Create nbb Sidecar

**File**: `src/bridge/sexp-evaluator.cljs`

```clojure
(ns vers-agent.sexp
  (:require
    [clojure.edn :as edn]
    ["http" :as http]))

;; State atom
(def state (atom {}))

;; S-expression handlers
(defmulti handle-sexp first)

(defmethod handle-sexp :eval [[_ expr]]
  {:result (eval expr)})

(defmethod handle-sexp :get-state [[_ key]]
  {:result (get @state key)})

(defmethod handle-sexp :set-state [[_ key value]]
  (swap! state assoc key value)
  {:result :ok})

(defmethod handle-sexp :default [sexp]
  {:error (str "Unknown operation: " (first sexp))})

;; HTTP server for S-expression evaluation
(defn create-server []
  (.createServer http
    (fn [req res]
      (let [chunks (atom [])]
        (.on req "data" #(swap! chunks conj %))
        (.on req "end"
          (fn []
            (let [body (.toString (js/Buffer.concat (clj->js @chunks)))
                  sexp (edn/read-string body)
                  result (handle-sexp sexp)
                  response (pr-str result)]
              (.writeHead res 200 #js {:Content-Type "application/edn"})
              (.end res response))))))))

;; Start server
(defn -main []
  (let [server (create-server)
        port 9998]
    (.listen server port)
    (println (str "S-expression evaluator on port " port))))

(-main)
```

#### 2.3. TypeScript Client

**File**: `src/bridge/sexp-client.ts`

```typescript
export class SexpClient {
  private port: number = 9998;
  
  async eval(sexp: string): Promise<unknown> {
    const response = await fetch(`http://localhost:${this.port}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/edn' },
      body: sexp,
    });
    
    const text = await response.text();
    // Parse EDN response (for now, use JSON as approximation)
    return JSON.parse(text.replace(/:/g, '"').replace(/ /g, ', '));
  }
  
  async getState(key: string): Promise<unknown> {
    return this.eval(`[:get-state "${key}"]`);
  }
  
  async setState(key: string, value: unknown): Promise<void> {
    await this.eval(`[:set-state "${key}" ${JSON.stringify(value)}]`);
  }
}
```

---

## Phase 3: GF(3) Conservation Tracking

### Goal
Add optional GF(3) trit tracking for operations.

### Implementation

#### 3.1. GF(3) Tracker Module

**File**: `src/utils/gf3-tracker.ts`

```typescript
export type Trit = -1 | 0 | 1;

export interface Gf3Operation {
  id: string;
  type: 'inject' | 'emit' | 'bridge';
  trit: Trit;
  timestamp: Date;
  description: string;
}

export class Gf3Tracker {
  private operations: Gf3Operation[] = [];
  
  track(op: Gf3Operation) {
    this.operations.push(op);
    logStream.debug('GF(3) operation:', op);
  }
  
  getBalance(): { balanced: boolean; sum: number; mod3: number } {
    const sum = this.operations.reduce((acc, op) => acc + op.trit, 0);
    const mod3 = ((sum % 3) + 3) % 3; // Handle negative modulo
    return {
      balanced: mod3 === 0,
      sum,
      mod3,
    };
  }
  
  getOperations(): Gf3Operation[] {
    return [...this.operations];
  }
  
  reset() {
    this.operations = [];
  }
}
```

#### 3.2. Integrate into Agent Manager

**File**: `src/core/agent-manager.ts` (modify)

```typescript
import { Gf3Tracker, Trit } from '../utils/gf3-tracker';

export class AgentManager {
  private gf3?: Gf3Tracker;
  
  async initializeAgent(agentId: string, options?: { enableGf3?: boolean }) {
    // ... existing initialization
    
    if (options?.enableGf3) {
      this.gf3 = new Gf3Tracker();
      logStream.info('GF(3) conservation tracking enabled');
    }
  }
  
  async runTask(params: RunTaskParams) {
    // Track as INJECT (+1)
    this.gf3?.track({
      id: crypto.randomUUID(),
      type: 'inject',
      trit: 1 as Trit,
      timestamp: new Date(),
      description: `Inject prompt: ${params.prompt.substring(0, 50)}...`,
    });
    
    // ... existing execution
    
    // Track as EMIT (-1)
    this.gf3?.track({
      id: crypto.randomUUID(),
      type: 'emit',
      trit: -1 as Trit,
      timestamp: new Date(),
      description: 'Emit result',
    });
    
    // Check balance
    const balance = this.gf3?.getBalance();
    if (balance && !balance.balanced) {
      logStream.warn(`⚠️  GF(3) imbalance detected: sum=${balance.sum}, mod3=${balance.mod3}`);
    }
  }
}
```

#### 3.3. Add GF(3) Display to CLI

**File**: `src/cli/components/gf3-indicator.tsx`

```typescript
import { Box, Text } from 'ink';
import React from 'react';

interface Gf3IndicatorProps {
  balanced: boolean;
  sum: number;
  operations: number;
}

export const Gf3Indicator: React.FC<Gf3IndicatorProps> = ({ balanced, sum, operations }) => {
  return (
    <Box>
      <Text dimColor>GF(3): </Text>
      <Text color={balanced ? 'green' : 'yellow'}>
        {balanced ? '✓' : '⚠'} {sum} ({operations} ops)
      </Text>
    </Box>
  );
};
```

**Add to StatusBar**:

```typescript
// src/cli/components/top-status-bar.tsx
<Box justifyContent="space-between">
  <Box>
    <Text color="cyan">{model}</Text>
    {/* ... existing status items */}
  </Box>
  {gf3 && <Gf3Indicator {...gf3} />}
</Box>
```

---

## Phase 4: nbb Sidecar for Duck Interop

### Goal
Enable vers-agent to communicate with duck VMs via S-expressions.

### Architecture

```
vers-agent (TypeScript)
    ↓ HTTP JSON
nbb sidecar (ClojureScript)
    ↓ S-expressions (EDN)
duck VMs (nbb agents)
```

### Implementation

#### 4.1. Duck Protocol Adapter

**File**: `src/bridge/duck-adapter.cljs`

```clojure
(ns vers-agent.duck-adapter
  (:require
    [clojure.edn :as edn]
    ["http" :as http]))

;; Duck VM connection
(defn send-to-duck-vm [vm-url sexp]
  (js/Promise.
    (fn [resolve reject]
      (let [data (pr-str sexp)
            options #js {:method "POST"
                        :headers #js {:Content-Type "application/edn"}}]
        (.fetch js/global vm-url (clj->js (assoc options :body data)))
        (.then #(.text %))
        (.then #(resolve (edn/read-string %)))
        (.catch reject)))))

;; Flow handlers
(defn inject! [vm-url op payload]
  (send-to-duck-vm vm-url [:flow :inject op payload]))

(defn emit! [vm-url op]
  (send-to-duck-vm vm-url [:flow :emit op nil]))

(defn bridge! [vm-url op payload]
  (send-to-duck-vm vm-url [:flow :bridge op payload]))

;; HTTP server for TypeScript ↔ nbb ↔ duck
(defn create-adapter-server []
  (.createServer http
    (fn [req res]
      ;; Parse JSON from TypeScript
      (let [chunks (atom [])]
        (.on req "data" #(swap! chunks conj %))
        (.on req "end"
          (fn []
            (let [body (.toString (js/Buffer.concat (clj->js @chunks)))
                  request (js->clj (js/JSON.parse body) :keywordize-keys true)
                  {:keys [vm-url flow-type op payload]} request]
              ;; Send to duck VM
              (-> (case flow-type
                    "inject" (inject! vm-url op payload)
                    "emit" (emit! vm-url op)
                    "bridge" (bridge! vm-url op payload))
                  (.then (fn [result]
                           (.writeHead res 200 #js {:Content-Type "application/json"})
                           (.end res (js/JSON.stringify (clj->js result)))))
                  (.catch (fn [err]
                            (.writeHead res 500)
                            (.end res (str "Error: " err))))))))))))

(defn -main []
  (let [server (create-adapter-server)]
    (.listen server 9997)
    (println "Duck adapter listening on :9997")))

(-main)
```

#### 4.2. TypeScript Client for Duck

**File**: `src/bridge/duck-client.ts`

```typescript
interface DuckFlowResult {
  status: string;
  result?: unknown;
  trit?: number;
  error?: string;
}

export class DuckClient {
  private adapterUrl = 'http://localhost:9997';
  
  async inject(vmUrl: string, op: string, payload: unknown): Promise<DuckFlowResult> {
    return this.sendFlow(vmUrl, 'inject', op, payload);
  }
  
  async emit(vmUrl: string, op: string): Promise<DuckFlowResult> {
    return this.sendFlow(vmUrl, 'emit', op, null);
  }
  
  async bridge(vmUrl: string, op: string, payload: unknown): Promise<DuckFlowResult> {
    return this.sendFlow(vmUrl, 'bridge', op, payload);
  }
  
  private async sendFlow(
    vmUrl: string,
    flowType: 'inject' | 'emit' | 'bridge',
    op: string,
    payload: unknown
  ): Promise<DuckFlowResult> {
    const response = await fetch(this.adapterUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vm_url: vmUrl, flow_type: flowType, op, payload }),
    });
    
    if (!response.ok) {
      throw new Error(`Duck flow failed: ${response.statusText}`);
    }
    
    return response.json();
  }
}
```

#### 4.3. Slash Command for Duck Communication

**File**: `src/cli/handlers/command-handlers.ts` (add)

```typescript
export async function handleDuckCommand(args: string[], context: CommandContext) {
  const [subcommand, vmUrl, ...rest] = args;
  
  if (!vmUrl) {
    throw new Error('Usage: /duck <inject|emit|bridge> <vm-url> [args...]');
  }
  
  const duckClient = new DuckClient();
  
  switch (subcommand) {
    case 'inject': {
      const [op, ...payloadParts] = rest;
      const payload = JSON.parse(payloadParts.join(' '));
      const result = await duckClient.inject(vmUrl, op, payload);
      context.appendOutput({
        type: 'system',
        content: `Duck inject result: ${JSON.stringify(result, null, 2)}`,
        color: 'cyan',
      });
      break;
    }
    
    case 'emit': {
      const op = rest[0];
      const result = await duckClient.emit(vmUrl, op);
      context.appendOutput({
        type: 'system',
        content: `Duck emit result: ${JSON.stringify(result, null, 2)}`,
        color: 'cyan',
      });
      break;
    }
    
    default:
      throw new Error(`Unknown duck subcommand: ${subcommand}`);
  }
}

// Register command
COMMANDS['duck'] = handleDuckCommand;
```

### Usage Example

```bash
# In vers-agent CLI:
> /duck inject http://localhost:9000 exec '{"code": "(+ 1 2)"}'
# Duck inject result: {"status": "executed", "result": 3, "trit": 1}

> /duck emit http://localhost:9000 state
# Duck emit result: {"status": "ok", "state": {...}, "trit": -1}
```

---

## Phase 5: Triadic Mode

### Goal
Enable vers-agent to spawn and coordinate a triadic cluster (MINUS, ERGODIC, PLUS).

### Implementation

#### 5.1. Triadic Cluster Manager

**File**: `src/core/triadic-manager.ts`

```typescript
interface TriadicVm {
  alias: 'validator' | 'coordinator' | 'generator';
  trit: -1 | 0 | 1;
  vmId: string;
  url: string;
  color: string;
}

export class TriadicManager {
  private cluster: TriadicVm[] = [];
  private duckClient: DuckClient;
  
  constructor() {
    this.duckClient = new DuckClient();
  }
  
  async createCluster(): Promise<void> {
    logStream.info('Creating triadic cluster...');
    
    // Create 3 VMs via Vers CLI
    const vms: TriadicVm[] = [
      {
        alias: 'validator',
        trit: -1,
        vmId: await this.createVm('validator', -1),
        url: 'http://localhost:9000',
        color: 'red',
      },
      {
        alias: 'coordinator',
        trit: 0,
        vmId: await this.createVm('coordinator', 0),
        url: 'http://localhost:9001',
        color: 'orange',
      },
      {
        alias: 'generator',
        trit: 1,
        vmId: await this.createVm('generator', 1),
        url: 'http://localhost:9002',
        color: 'green',
      },
    ];
    
    this.cluster = vms;
    logStream.info('Triadic cluster created:', vms.map(v => v.alias).join(', '));
  }
  
  private async createVm(alias: string, trit: number): Promise<string> {
    // Call Vers CLI to create VM
    const result = await $`vers create --alias ${alias}`.text();
    const vmId = result.trim();
    
    // Start ACP agent in VM
    await $`vers execute ${vmId} "nbb src/bridge/duck-adapter.cljs"`;
    
    return vmId;
  }
  
  async routeToAgent(prompt: string): Promise<TriadicVm> {
    // Simple routing logic based on prompt content
    if (prompt.includes('verify') || prompt.includes('test')) {
      return this.cluster.find(v => v.alias === 'validator')!;
    } else if (prompt.includes('create') || prompt.includes('generate')) {
      return this.cluster.find(v => v.alias === 'generator')!;
    } else {
      return this.cluster.find(v => v.alias === 'coordinator')!;
    }
  }
  
  async executePrompt(prompt: string): Promise<unknown> {
    const agent = await this.routeToAgent(prompt);
    logStream.info(`Routing to ${agent.alias} (trit: ${agent.trit})`);
    
    // Inject prompt
    const result = await this.duckClient.inject(agent.url, 'exec', { code: prompt });
    
    // Check GF(3) balance across cluster
    await this.checkClusterBalance();
    
    return result;
  }
  
  private async checkClusterBalance() {
    const balances = await Promise.all(
      this.cluster.map(async vm => {
        const state = await this.duckClient.emit(vm.url, 'gf3-state');
        return { alias: vm.alias, trit: state.trit };
      })
    );
    
    const totalTrit = balances.reduce((sum, b) => sum + (b.trit || 0), 0);
    const balanced = (totalTrit % 3) === 0;
    
    if (!balanced) {
      logStream.warn('⚠️  Cluster GF(3) imbalance:', balances);
    } else {
      logStream.info('✓ Cluster GF(3) balanced:', balances);
    }
  }
  
  async destroyCluster(): Promise<void> {
    for (const vm of this.cluster) {
      await $`vers delete ${vm.vmId}`;
    }
    this.cluster = [];
  }
}
```

#### 5.2. Slash Commands for Triadic Mode

**File**: `src/cli/handlers/command-handlers.ts` (add)

```typescript
let triadicManager: TriadicManager | null = null;

export async function handleTriadicCommand(args: string[], context: CommandContext) {
  const [subcommand] = args;
  
  switch (subcommand) {
    case 'create': {
      if (triadicManager) {
        throw new Error('Triadic cluster already exists');
      }
      
      triadicManager = new TriadicManager();
      await triadicManager.createCluster();
      
      context.appendOutput({
        type: 'system',
        content: '✓ Triadic cluster created (MINUS, ERGODIC, PLUS)',
        color: 'green',
      });
      break;
    }
    
    case 'status': {
      if (!triadicManager) {
        throw new Error('No triadic cluster exists');
      }
      
      // TODO: Query cluster status
      context.appendOutput({
        type: 'system',
        content: 'Triadic cluster status: 3 VMs active',
        color: 'cyan',
      });
      break;
    }
    
    case 'destroy': {
      if (!triadicManager) {
        throw new Error('No triadic cluster exists');
      }
      
      await triadicManager.destroyCluster();
      triadicManager = null;
      
      context.appendOutput({
        type: 'system',
        content: '✓ Triadic cluster destroyed',
        color: 'yellow',
      });
      break;
    }
    
    default:
      throw new Error(`Unknown triadic subcommand: ${subcommand}`);
  }
}

// Register command
COMMANDS['triadic'] = handleTriadicCommand;
```

### Usage Example

```bash
# In vers-agent CLI:
> /triadic create
# ✓ Triadic cluster created (MINUS, ERGODIC, PLUS)

> Verify this code is secure: function login(user, pass) { ... }
# [Routes to MINUS agent for verification]

> Generate a new authentication module
# [Routes to PLUS agent for generation]

> /triadic status
# Triadic cluster status: 3 VMs active
# - validator (MINUS, -1): idle
# - coordinator (ERGODIC, 0): idle
# - generator (PLUS, +1): active

> /triadic destroy
# ✓ Triadic cluster destroyed
```

---

## Implementation Roadmap

### Timeline

| Phase | Duration | Deliverables |
|-------|----------|-------------|
| **Phase 1** | 1-2 days | API key detection, Toad banner |
| **Phase 2** | 2-3 days | nbb sidecar, S-expression evaluator |
| **Phase 3** | 1-2 days | GF(3) tracker, UI indicator |
| **Phase 4** | 3-4 days | Duck adapter, slash commands |
| **Phase 5** | 5-7 days | Triadic cluster manager |
| **Total** | ~3 weeks | Full integration |

### Milestones

#### Milestone 1: Toad Features (End of Week 1)
- ✅ API key auto-detection working
- ✅ Toad banner displays on startup
- ✅ Basic VM health checks
- ✅ Tests passing

#### Milestone 2: nbb Bridge (End of Week 2)
- ✅ nbb sidecar spawns successfully
- ✅ S-expression evaluation works
- ✅ TypeScript ↔ nbb IPC functional
- ✅ Integration tests passing

#### Milestone 3: Duck Interop (End of Week 3)
- ✅ Duck adapter connects to duck VMs
- ✅ `/duck` slash commands functional
- ✅ GF(3) tracking integrated
- ✅ Triadic cluster creates successfully

### Dependencies

1. **nbb installation**: `bun add -d nbb`
2. **Vers CLI**: Already available
3. **Duck codebase**: Access to `~/i/duck` for reference
4. **DuckDB** (optional): For shared analytics

### Testing Strategy

#### Unit Tests

```typescript
// tests/api-key-detector.test.ts
import { test, expect } from 'bun:test';
import { detectApiKeys } from '../src/utils/api-key-detector';

test('detects valid Anthropic API key', () => {
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test123456789012345678901234567890';
  const keys = detectApiKeys();
  expect(keys.some(k => k.name === 'ANTHROPIC_API_KEY')).toBe(true);
});
```

#### Integration Tests

```typescript
// tests/nbb-bridge.test.ts
import { test, expect } from 'bun:test';
import { NbbBridge } from '../src/bridge/nbb-client';

test('nbb bridge evaluates S-expression', async () => {
  const bridge = new NbbBridge();
  await bridge.start();
  
  const result = await bridge.evalSexp('[:eval (+ 1 2)]');
  expect(result.result).toBe(3);
  
  await bridge.stop();
});
```

#### E2E Tests

```bash
# tests/e2e/triadic-cluster.sh
#!/bin/bash

# Start vers-agent with triadic mode
./vers-agent &
AGENT_PID=$!

# Wait for startup
sleep 2

# Create triadic cluster
echo "/triadic create" | nc localhost 9999

# Send prompt
echo "Verify this code" | nc localhost 9999

# Check GF(3) balance
# ... assertions

# Cleanup
kill $AGENT_PID
```

---

## Configuration

### Enable Toad Features

**File**: `~/.vers/agent_config.json`

```json
{
  "toad": {
    "enabled": true,
    "showBanner": true,
    "autoDetectKeys": true
  }
}
```

### Enable nbb Bridge

```json
{
  "bridge": {
    "enabled": true,
    "port": 9998,
    "logLevel": "debug"
  }
}
```

### Enable GF(3) Tracking

```json
{
  "gf3": {
    "enabled": true,
    "showIndicator": true,
    "warnOnImbalance": true
  }
}
```

### Enable Triadic Mode

```json
{
  "triadic": {
    "enabled": false,
    "autoCreate": false,
    "vmConfig": {
      "validator": { "trit": -1, "port": 9000 },
      "coordinator": { "trit": 0, "port": 9001 },
      "generator": { "trit": 1, "port": 9002 }
    }
  }
}
```

---

## Benefits Summary

### For Users

1. **Seamless API key management** - No more manual exports
2. **Beautiful startup experience** - Toad banner creates warmth
3. **Optional triadic mode** - Advanced users can leverage duck's power
4. **GF(3) visibility** - See conservation balance in real-time
5. **Duck interop** - Bridge between vers-agent and duck workflows

### For Developers

1. **S-expression REPL** - Dynamic evaluation in running system
2. **nbb flexibility** - ClojureScript for rapid prototyping
3. **Mathematical rigor** - GF(3) conservation prevents runaway states
4. **Bridge architecture** - Clean separation of concerns
5. **Extensibility** - Easy to add new flow operations

### For Researchers

1. **Category theory** - Explicit Galois connections, Frobenius algebra
2. **Open game structure** - Forward/backward passes visible
3. **Analytics** - DuckDB integration for GF(3) analysis
4. **Triadic orchestration** - MINUS/ERGODIC/PLUS coordination
5. **Reproducibility** - Same seed → same results across bb/nbb boundary

---

## Next Steps

1. **Implement Phase 1** (API key detection)
2. **Test Toad banner integration**
3. **Install and test nbb**
4. **Build simple S-expression evaluator**
5. **Prototype GF(3) tracker**
6. **Test duck adapter with real duck VMs**
7. **Implement triadic cluster manager**
8. **Write comprehensive tests**
9. **Update documentation**
10. **Ship incrementally**

---

## Questions & Considerations

### Performance

**Q**: Will nbb sidecar add latency?  
**A**: Minimal (~10ms per S-expression eval). Can optimize with connection pooling.

### Complexity

**Q**: Is this too complex for production?  
**A**: All features are **opt-in**. Users can ignore nbb/GF(3) if not needed.

### Maintenance

**Q**: Who maintains nbb sidecar?  
**A**: Same team as vers-agent. ClojureScript is stable; low maintenance.

### Backward Compatibility

**Q**: Will existing workflows break?  
**A**: No. All new features are additive and disabled by default.

---

## Conclusion

By integrating Toad's API key detection and nbb's S-expression bridge, **vers-agent gains duck's mathematical rigor without sacrificing its production-grade UX**.

The result: **A hybrid system that serves both everyday developers and advanced researchers.**

**Next**: Implement Phase 1 and test with real users.

---

*Integration plan created 2026-01-12*  
*For implementation questions, consult this document and the comparative analysis in `docs/COMPARATIVE-ANALYSIS.md`*
