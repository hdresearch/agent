# AGENTS.md - Homoiconic EDN Exchange Protocol

## Philosophy: Code as Data, Data as Code

**Homoiconicity** is the property where code and data share the same representation. In a homoiconic system, programs can manipulate other programs (and themselves) as data structures.

EDN (Extensible Data Notation) is the canonical format for homoiconic agent communication because:

1. **Code = Data**: S-expressions represent both computation and information
2. **Metaprogramming**: Agents can generate, transform, and execute code dynamically
3. **Structural editing**: Programs are trees, not strings - enabling precise transformations
4. **Self-describing**: Data carries its own schema and semantics
5. **Immutable by default**: Functional purity simplifies reasoning about agent state

---

## The Homoiconic Agent Protocol

### Core Principle

> "The map is the territory when map and territory are both S-expressions."

In traditional protocols (JSON-RPC, gRPC), **data** flows between agents but **code** remains static. In homoiconic protocols, agents exchange **executable data** - programs that can be inspected, transformed, and evaluated.

### EDN as Protocol Foundation

```clojure
;; Traditional JSON-RPC Request (data only)
{"jsonrpc": "2.0", "method": "gf3/balance-triad", "params": {"trits": [1, 1, -1]}, "id": 1}

;; Homoiconic EDN Request (data + code potential)
{:jsonrpc "2.0"
 :method :gf3/balance-triad
 :params {:trits [1 1 -1]
          :transform (fn [result] (map trit->label result))}
 :id 1}
```

**Key differences**:
- EDN uses **keywords** (`:method`) not strings - first-class values
- Functions can be **transmitted** as data (when using SCI/nbb)
- **Namespaced** keywords preserve semantic context (`:gf3/balance-triad`)
- **Extensible** - new types via tagged literals

---

## EDN Syntax Reference

### Basic Types

```clojure
;; Scalars
42                    ;; long
3.14                  ;; double
"hello"               ;; string
true false            ;; boolean
nil                   ;; null
:keyword              ;; keyword (interned symbol)
```

### Collections

```clojure
;; List (sequential, for code)
(+ 1 2 3)             ;; => 6

;; Vector (sequential, for data)
[1 2 3]               ;; indexed access

;; Map (associative)
{:name "Agent-0"
 :type :MINUS
 :trit -1}

;; Set (distinct values)
#{:minus :ergodic :plus}
```

### Namespace-Qualified Keywords

```clojure
:gf3/trit             ;; namespaced keyword
:agent/decompose-task ;; clear semantic context
:protocol/version     ;; avoids naming collisions
```

### Tagged Literals (Extensibility)

```clojure
#inst "2025-01-12T10:30:00Z"     ;; instant
#uuid "550e8400-e29b-41d4-a716"  ;; UUID
#gf3/trit -1                     ;; custom type
#agent/skill {:name "gay-mcp" :trit 1}
```

---

## Homoiconic Agent Exchange Examples

### Example 1: Task Decomposition

**Problem**: Agent receives a task and must decompose it into subtasks.

#### Traditional Approach (JSON)
```json
{
  "task": "implement-feature",
  "decomposition": [
    {"type": "generate", "agent": "PLUS"},
    {"type": "validate", "agent": "MINUS"},
    {"type": "integrate", "agent": "ERGODIC"}
  ]
}
```

**Limitation**: Decomposition logic is hardcoded in each agent.

#### Homoiconic Approach (EDN)
```clojure
;; Agent sends executable transformation
{:task :implement-feature
 :decompose-fn (fn [task]
                 (case (:type task)
                   :implement-feature
                   [{:type :generate :agent :PLUS :desc "Generate implementation"}
                    {:type :validate :agent :MINUS :desc "Validate correctness"}
                    {:type :integrate :agent :ERGODIC :desc "Integrate into system"}]
                   
                   :debug-issue
                   [{:type :analyze :agent :MINUS :desc "Analyze bug"}
                    {:type :coordinate :agent :ERGODIC :desc "Plan fix"}
                    {:type :generate :agent :PLUS :desc "Generate fix"}]))}
```

**Advantage**: 
- Decomposition logic is **data** that can be transmitted
- Receiving agent can **inspect** the function before evaluating
- Function can be **composed** with other transformations
- Logic can be **upgraded** without protocol changes

---

### Example 2: GF(3) Balancing with Metaprogramming

#### Traditional Approach
```typescript
// Client code (TypeScript)
const result = await client.request('gf3/balance-triad', { trits: [1, 1, -1] });
// => { requiredTrit: -1 }
```

**Limitation**: Server defines all operations. Client cannot extend behavior.

#### Homoiconic Approach
```clojure
;; Client sends code + data
{:jsonrpc "2.0"
 :method :gf3/eval
 :params {:code '(let [trits [1 1 -1]
                       sum (reduce + trits)
                       required (- (mod (+ (mod sum 3) 3) 3) 1)]
                   {:trits trits
                    :sum sum
                    :required required
                    :label (case required
                             -1 :MINUS
                             0 :ERGODIC
                             1 :PLUS)})
          :sandbox {:timeout 1000
                    :max-depth 10}}
 :id 1}
```

**Advantages**:
- **Client defines computation** - server provides sandbox
- **Exploratory**: Client can experiment without server changes
- **Composable**: Multiple operations in one round-trip
- **Auditable**: Server can inspect code before execution

---

### Example 3: Triadic Agent Coordination

#### Protocol Message Structure

```clojure
;; Agent registration
{:protocol/version "1.0.0"
 :message/type :agent/register
 :agent/id #uuid "a1b2c3d4-..."
 :agent/type :MINUS
 :agent/trit -1
 :agent/role "Verification, validation, analysis"
 :agent/capabilities #{:gf3/balance :protocol/validate :code/analyze}}

;; Task assignment with transformation
{:protocol/version "1.0.0"
 :message/type :agent/assign-task
 :task/id #uuid "task-123"
 :task/type :implement-feature
 :task/desc "Add dark mode toggle"
 :task/decompose-fn (fn [task]
                      ;; Decomposition logic as data
                      (triadic-decompose task))
 :coordination/balancing {:gf3/required-trits [-1 0 1 0]
                          :gf3/balanced? true}}

;; Task completion with code
{:protocol/version "1.0.0"
 :message/type :agent/task-complete
 :task/id #uuid "task-123"
 :agent/id #uuid "a1b2c3d4-..."
 :result/value {:status :success
                :artifact '(def dark-mode-toggle
                            (fn [enabled]
                              (set-theme (if enabled :dark :light))))}
 :result/metadata {:complexity :medium
                   :confidence 0.92
                   :next-agent :ERGODIC}}
```

---

## Why Homoiconicity Matters for Multi-Agent Systems

### 1. **Dynamic Behavior Adaptation**

Agents can send **new strategies** to each other:

```clojure
;; MINUS agent discovers better validation strategy
{:agent/id "minus-1"
 :update/type :strategy-improvement
 :strategy/old 'validate-via-type-checking
 :strategy/new '(fn [code]
                  (and (validate-via-type-checking code)
                       (validate-via-property-testing code)
                       (validate-via-formal-verification code)))}
```

Without homoiconicity, this requires:
- Hardcoding all strategies ahead of time, OR
- String-based code transmission (insecure, unauditable)

### 2. **Structural Code Transformation**

Agents can **rewrite** each other's code:

```clojure
;; ERGODIC agent optimizes PLUS agent's output
{:agent/id "ergodic-1"
 :transform/type :optimization
 :transform/fn (fn [code]
                 ;; Walk AST and optimize
                 (walk/prewalk
                   (fn [form]
                     (if (and (list? form) (= 'map (first form)))
                       (list 'mapv (second form) (nth form 2))  ;; map -> mapv
                       form))
                   code))}
```

This is **impossible** with JSON/string-based protocols.

### 3. **Self-Modifying Protocol**

The protocol itself can **evolve**:

```clojure
;; Protocol upgrade as data
{:protocol/version "1.0.0"
 :upgrade/to "2.0.0"
 :upgrade/migrations [(fn [v1-msg]
                        ;; Transform v1.0 message to v2.0
                        (assoc v1-msg :protocol/features #{:gf3 :triadic}))]}
```

Agents **receive** the upgrade logic and can:
- Inspect it before applying
- Simulate the upgrade
- Gradually adopt the new protocol

### 4. **Bisimulation Games**

Agents can **prove equivalence** by exchanging code:

```clojure
;; Agent A claims equivalence to Agent B
{:bisimulation/claim {:agent-a "minus-1"
                      :agent-b "minus-2"
                      :equivalence-fn '(fn [input]
                                        (= (agent-a input)
                                           (agent-b input)))}
 :bisimulation/proof-obligation '(for-all [input (gen/any)]
                                   (equivalence-fn input))}
```

The **proof** is executable code that other agents can verify.

---

## EDN vs JSON: A Comparison

| Feature | JSON | EDN |
|---------|------|-----|
| **Keywords** | Strings only | First-class `:keywords` |
| **Code** | Not representable | Functions as data |
| **Namespaces** | Manual prefixing | Built-in `:ns/key` |
| **Extensibility** | Custom parsing | Tagged literals `#tag` |
| **Precision** | Lossy floats | Exact rationals `22/7` |
| **Comments** | Not standard | `;;` comments preserved |
| **Sets** | Arrays + dedup | Native `#{}` |
| **Symbols** | Not representable | `'quoted` symbols |

### Example: Representing a Function

**JSON** (impossible):
```json
{
  "transform": "function(x) { return x + 1; }"
}
```
- Function is a **string**
- Must `eval()` (security risk)
- No structural inspection

**EDN** (native):
```clojure
{:transform (fn [x] (+ x 1))}
```
- Function is **data**
- Can be inspected without eval
- AST is accessible: `'(fn [x] (+ x 1))`

---

## Security Model: Sandboxed Evaluation

Homoiconicity requires **safe evaluation**. EDN agents use **SCI** (Small Clojure Interpreter):

```clojure
(require '[sci.core :as sci])

(def sandbox-opts
  {:preset :termination-safe
   :namespaces {'gf3 {'add-gf3 add-gf3
                      'sum-gf3 sum-gf3
                      'balance-triad balance-triad}}
   :max-eval-depth 100
   :timeout 5000})

(defn eval-safe [code]
  (sci/eval-string code sandbox-opts))

;; Agent receives code
(def received-code '(gf3/balance-triad [1 1 -1]))

;; Evaluate safely
(eval-safe (pr-str received-code))
;; => -1
```

**Safety guarantees**:
- **Timeout**: Prevents infinite loops
- **Whitelist**: Only allowed functions accessible
- **Depth limit**: Prevents stack overflow
- **No I/O**: No file/network access by default

---

## Protocol Layers

### Layer 1: Transport (JSON-RPC over stdin/stdout)

```clojure
;; Still JSON for transport compatibility
{"jsonrpc": "2.0", "method": "edn/eval", "params": {...}, "id": 1}
```

### Layer 2: Payload (EDN inside JSON)

```clojure
;; params contains EDN string
{"params": "{:code '(+ 1 2) :sandbox {:timeout 1000}}"}
```

### Layer 3: Evaluation (SCI interpreter)

```clojure
;; EDN parsed and evaluated in sandbox
(sci/eval-string "{:code '(+ 1 2) :sandbox {:timeout 1000}}")
```

---

## Implementation Guide

### TypeScript ↔ EDN Bridge

#### Sending EDN from TypeScript

```typescript
// src/protocol/edn-bridge.ts
import { spawn } from 'child_process';

interface EdnRequest {
  code: string;
  sandbox: {
    timeout: number;
    maxDepth: number;
  };
}

class EdnBridge {
  private nbbProcess: ChildProcess;

  constructor() {
    this.nbbProcess = spawn('nbb', ['experiments/nbb/edn-bridge.cljs']);
  }

  async eval(request: EdnRequest): Promise<unknown> {
    const jsonrpc = {
      jsonrpc: '2.0',
      method: 'edn/eval',
      params: request,
      id: Date.now(),
    };

    return new Promise((resolve, reject) => {
      this.nbbProcess.stdout?.on('data', (data) => {
        const response = JSON.parse(data.toString());
        if (response.error) {
          reject(new Error(response.error.message));
        } else {
          resolve(response.result);
        }
      });

      this.nbbProcess.stdin?.write(JSON.stringify(jsonrpc) + '\n');
    });
  }
}

// Usage
const bridge = new EdnBridge();
const result = await bridge.eval({
  code: '(gf3/balance-triad [1 1 -1])',
  sandbox: { timeout: 5000, maxDepth: 100 },
});
console.log(result); // => -1
```

#### Receiving EDN in nbb

```clojure
;; experiments/nbb/edn-bridge.cljs
(ns edn-bridge
  (:require [sci.core :as sci]
            [clojure.edn :as edn]))

(def sandbox-opts
  {:preset :termination-safe
   :namespaces {'gf3 {'balance-triad balance-triad}}
   :max-eval-depth 100})

(defn handle-eval [{:keys [code sandbox]}]
  (try
    (let [opts (merge sandbox-opts {:timeout (:timeout sandbox)})
          result (sci/eval-string code opts)]
      {:result result})
    (catch js/Error e
      {:error {:code -32603
               :message (.-message e)}})))

;; Read JSON-RPC from stdin
(defn -main []
  (let [input (read-line)
        request (js->clj (js/JSON.parse input) :keywordize-keys true)
        {:keys [method params id]} request]
    (case method
      "edn/eval" (let [response (handle-eval params)]
                   (println (js/JSON.stringify
                             (clj->js (assoc response :id id :jsonrpc "2.0")))))
      (println (js/JSON.stringify
                (clj->js {:jsonrpc "2.0"
                          :error {:code -32601 :message "Method not found"}
                          :id id}))))))

(-main)
```

---

## Philosophical Foundations

### 1. **Lisp's Power** (McCarthy, 1960)

> "Lisp is worth learning for the profound enlightenment experience you will have when you finally get it; that experience will make you a better programmer for the rest of your days."
> — Eric S. Raymond

**Insight**: Code that can manipulate code is **fundamentally more powerful** than code that cannot.

### 2. **Church-Turing Completeness**

Any computable function can be represented as data. EDN makes this **practical**:

```clojure
;; Lambda calculus as data
(def Y-combinator
  '(fn [f]
     ((fn [x] (f (fn [v] ((x x) v))))
      (fn [x] (f (fn [v] ((x x) v)))))))

;; Factorial using Y-combinator
(def factorial
  (list Y-combinator
        '(fn [f]
           (fn [n]
             (if (zero? n)
               1
               (* n (f (dec n))))))))
```

This is **mathematics** represented as **data** that is **executable**.

### 3. **Separation of Concerns**

Homoiconicity separates:
- **Syntax**: S-expressions (universal)
- **Semantics**: Evaluation rules (context-dependent)
- **Policy**: Sandbox (security boundary)

Traditional languages conflate these, limiting flexibility.

### 4. **Fixed Point Semantics**

Agents can **define themselves** in terms of themselves:

```clojure
;; Self-aware agent
(def agent-minus
  {:id "minus-1"
   :code '(fn [task]
            (validate task agent-minus))})
```

The agent's **code references itself** - enabling introspection and self-modification.

---

## Category Theory Connections

### Functors: Structure-Preserving Transformations

```clojure
;; Functor: map over nested structure
(defn fmap [f structure]
  (cond
    (list? structure) (map f structure)
    (vector? structure) (mapv f structure)
    (map? structure) (into {} (map (fn [[k v]] [k (f v)]) structure))
    :else (f structure)))

;; Transform all trits in nested structure
(fmap (fn [x] (if (#{-1 0 1} x) (trit->label x) x))
      {:agents [{:trit -1} {:trit 0}]})
;; => {:agents [{:trit "MINUS"} {:trit "ERGODIC"}]}
```

### Monads: Sequencing Computations

```clojure
;; Maybe monad for agent coordination
(defn >>=  [mv f]
  (when mv (f mv)))

;; Chain agent operations
(>>= (agent-minus task)
     (fn [validated]
       (>>= (agent-ergodic validated)
            (fn [coordinated]
              (agent-plus coordinated)))))
```

### Natural Transformations: Protocol Translations

```clojure
;; Natural transformation: JSON -> EDN
(defn json->edn-nt [json-data]
  (walk/postwalk
    (fn [form]
      (if (map? form)
        (into {} (map (fn [[k v]] [(keyword k) v]) form))
        form))
    json-data))
```

---

## Practical Workflows

### Workflow 1: Prototyping in nbb

1. **Prototype** algorithm in `experiments/nbb/`
2. **Test** with `bun run experiment:gf3`
3. **Verify** correctness with interactive REPL
4. **Port** to TypeScript for production
5. **Benchmark** TypeScript vs nbb versions

### Workflow 2: Dynamic Agent Upgrading

1. **Agent discovers** improved strategy
2. **Agent sends** new code via EDN
3. **Receiving agent inspects** code in sandbox
4. **Receiving agent tests** code with sample inputs
5. **Receiving agent adopts** code if tests pass
6. **Protocol remains** unchanged

### Workflow 3: Bisimulation Testing

1. **Define equivalence** relation as EDN function
2. **Generate** test cases programmatically
3. **Verify** both agents produce same outputs
4. **If discrepancy**, inspect code to find cause
5. **Transmit fix** as code transformation

---

## Future Directions

### 1. **Quantum Circuit Synthesis via EDN**

```clojure
;; Quantum circuit as homoiconic data
{:circuit/type :quantum
 :circuit/gates [{:gate :hadamard :qubit 0}
                 {:gate :cnot :control 0 :target 1}
                 {:gate :measure :qubit 0}]
 :circuit/optimize-fn (fn [circuit]
                        (fuse-adjacent-gates circuit))}
```

### 2. **Proof-Carrying Code**

```clojure
;; Code with embedded correctness proof
{:code '(defn safe-div [a b]
          (if (zero? b)
            (throw (ex-info "Division by zero" {}))
            (/ a b)))
 :proof '(for-all [a b]
           (implies (not (zero? b))
                    (= (* (safe-div a b) b) a)))}
```

### 3. **Category-Theoretic Agents**

```clojure
;; Agents as morphisms in a category
{:agent/id "agent-123"
 :agent/morphism '(fn [input-obj]
                    (transform input-obj output-obj))
 :agent/source-obj :task/unvalidated
 :agent/target-obj :task/validated
 :agent/compose (fn [g f] (comp g f))}
```

---

## Conclusion

**Homoiconicity** is not a curiosity - it's a **fundamental capability** for adaptive multi-agent systems. By representing code as data:

1. **Agents can teach each other** new strategies
2. **Protocols can evolve** without breaking changes
3. **Behavior is auditable** before execution
4. **Metaprogramming** becomes practical and safe
5. **Category theory** becomes executable

EDN is the canonical format because it balances:
- **Simplicity**: S-expressions are minimal
- **Power**: Code-as-data enables metaprogramming
- **Safety**: Sandboxed evaluation (SCI) prevents abuse
- **Compatibility**: JSON-RPC transport for TypeScript interop

**The future of agent protocols is homoiconic.**

---

## References

### Papers
- McCarthy, J. (1960). "Recursive Functions of Symbolic Expressions"
- Steele, G. & Sussman, G. (1975). "Scheme: An Interpreter for Extended Lambda Calculus"
- Hickey, R. (2008). "The Clojure Programming Language"

### Tools
- [EDN Specification](https://github.com/edn-format/edn)
- [SCI (Small Clojure Interpreter)](https://github.com/babashka/sci)
- [nbb (Node.js Babashka)](https://github.com/babashka/nbb)

### Related Work
- `docs/INTEGRATION-PLAN.md` - Implementation roadmap
- `docs/NBB-TYPESCRIPT-RESEARCH.md` - Language interop findings
- `experiments/nbb/edn-bridge.cljs` - Working prototype

---

## Appendix: EDN Cheatsheet

```clojure
;; Literals
42 3.14 22/7              ;; numbers
"string" \c               ;; text
true false nil            ;; boolean/null
:keyword :ns/keyword      ;; interned symbols

;; Collections
(list 1 2 3)              ;; linked list
[1 2 3]                   ;; vector
{:a 1 :b 2}               ;; map
#{1 2 3}                  ;; set

;; Symbolic
'symbol                   ;; quoted symbol
'(fn [x] (+ x 1))        ;; quoted list (code as data)

;; Tagged literals
#inst "2025-01-12"        ;; instant
#uuid "123e4567-e89b"     ;; UUID
#mytag {:custom "data"}   ;; custom type

;; Comments
;; Single line
```

**Remember**: If you can represent it as data, you can transmit it, inspect it, and transform it. That's the power of homoiconicity.
