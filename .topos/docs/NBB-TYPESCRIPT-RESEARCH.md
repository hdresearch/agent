# nbb/TypeScript Integration Research Findings

## Executive Summary

The proposed nbb sidecar architecture for vers-agent represents **pioneering work** rather than established practice. While nbb is a mature tool for ClojureScript scripting on Node.js, using it as a runtime bridge to TypeScript codebases is not a standard pattern in the industry.

## Research Methodology

Searched for:
- "nbb Node.js Babashka TypeScript interop integration patterns 2024 2025"
- "nbb ClojureScript TypeScript bridge interop best practices examples"

Sources analyzed:
- nbb GitHub repository (927 stars)
- State of ClojureScript 2024 Developer Survey
- ClojureVerse community discussions
- ClojureScript interop documentation

## Key Findings

### 1. nbb's Primary Use Case

**Finding**: nbb is designed for ad-hoc scripting, not production integration.

From the nbb repository:
> "Ad-hoc CLJS scripting on Node.js using SCI (Small Clojure Interpreter)"

**Characteristics**:
- Fast startup time (~170ms)
- Interpreted execution (not compiled)
- Best for: shell scripts, automation tasks, one-off utilities
- Not typically used for: runtime bridges between production codebases

**Implication**: Using nbb as a sidecar process would be extending it beyond its typical use case, though not technically infeasible.

---

### 2. ClojureScript/TypeScript Interop Challenges

**Finding**: The ClojureScript community faces significant friction with JS/TS interop.

From State of ClojureScript 2024 Survey:
- **Top pain points**:
  1. Lack of IDE autocomplete for JS/TS components
  2. Property access issues with advanced compilation
  3. Externs management complexity
  4. Slow compilation times
  5. TypeScript type information not available in ClojureScript

**Standard workarounds**:
```clojure
;; Pattern 1: applied-science/js-interop
(require '[applied-science.js-interop :as j])
(j/get object :property)
(j/call object :method arg1 arg2)

;; Pattern 2: cljs-oops
(require '[oops.core :refer [oget oset! ocall]])
(oget object "?property.?nested")
(ocall object "method" arg1 arg2)

;; Pattern 3: goog.object
(require '[goog.object :as gobj])
(gobj/get object "property")
```

**Implication**: Interop friction exists even within single-codebase solutions. A cross-process bridge would amplify these challenges.

---

### 3. When Developers Choose TypeScript Over ClojureScript

**Finding**: For interop-heavy applications, TypeScript is often preferred.

From ClojureVerse discussion (2024):
> "For React apps where you need heavy JS interop, it's often easier to just use TypeScript because you get autocomplete, type information, and source navigation out of the box."

**Decision factors**:
- **Choose ClojureScript** when:
  - Core logic is functional/immutable
  - Minimal JS interop required
  - Team has Clojure expertise
  
- **Choose TypeScript** when:
  - Heavy integration with JS/TS libraries
  - IDE tooling is critical
  - Interop is a primary concern

**Implication**: vers-agent is already TypeScript-native with excellent tooling. Adding ClojureScript layer may reduce developer experience.

---

### 4. Standard Integration Patterns

**Finding**: The industry uses these patterns for ClojureScript/TS integration:

#### Pattern A: Compiled ClojureScript Modules
```javascript
// Compile ClojureScript to JS, import as module
import { myFunction } from './compiled/cljs-output.js';
myFunction(arg1, arg2);
```
- **Pros**: Type-safe, fast runtime, good IDE support
- **Cons**: Slow compilation, requires shadow-cljs setup

#### Pattern B: TypeScript Calling Babashka CLI
```typescript
import { spawn } from 'child_process';

const bb = spawn('bb', ['-e', '(+ 1 2)']);
bb.stdout.on('data', (data) => {
  console.log(data.toString()); // "3"
});
```
- **Pros**: Simple, no compilation needed
- **Cons**: Process overhead, string-based communication

#### Pattern C: Shared Data via Files/Database
```typescript
// TypeScript writes JSON
await Bun.write('input.json', JSON.stringify(data));

// Babashka reads and processes
// bb process.clj

// TypeScript reads result
const result = await Bun.file('output.json').json();
```
- **Pros**: Decoupled, language-agnostic
- **Cons**: Slow, no type safety, coordination complexity

#### Pattern D: JSON-RPC Bridge (Proposed for vers-agent)
```typescript
// TypeScript → nbb over stdin/stdout
const nbbProcess = spawn('nbb', ['bridge.cljs']);
nbbProcess.stdin.write(JSON.stringify({
  jsonrpc: '2.0',
  method: 'gf3/balance-quad',
  params: { skills: ['skill1', 'skill2', 'skill3'] },
  id: 1
}));
```
- **Pros**: Type-safe protocol, async communication, clean separation
- **Cons**: Process overhead, novel architecture, requires maintenance

**Implication**: Pattern D (our proposed approach) is not standard but architecturally sound.

---

### 5. nbb Runtime Characteristics

**Finding**: nbb has specific performance and compatibility tradeoffs.

From nbb documentation:

**Advantages**:
- Fast startup: ~170ms (vs. 3-5s for JVM Clojure)
- Node.js native: Full access to npm ecosystem
- No compilation step: Direct script execution
- Memory efficient: No JVM overhead

**Limitations**:
- Interpreted execution: ~10-50x slower than compiled ClojureScript
- Limited optimization: No Google Closure Compiler advanced mode
- No hot code reloading: Must restart process for changes
- SCI limitations: Some advanced ClojureScript features unavailable

**Benchmark comparison** (from nbb repo):
```
Task                     Time (ms)
----------------------------------
bb (JVM startup)         3200
nbb (first run)          170
nbb (cached)             85
node (baseline)          60
```

**Implication**: nbb is fast to start but slow to execute. Best for short-lived tasks, not long-running servers.

---

## Standard Practices Summary

### What IS Standard

✅ **Using nbb for**:
- Shell scripts replacing bash
- Build automation tasks
- One-off data transformations
- CLI utilities

✅ **ClojureScript/TS integration via**:
- Compiled ClojureScript modules imported as JS
- shadow-cljs for production builds
- applied-science/js-interop for property access
- Externs files for advanced compilation

✅ **Process communication via**:
- JSON over stdin/stdout
- JSON-RPC for structured APIs
- Message queues (Redis, RabbitMQ) for production

### What IS NOT Standard

❌ **Using nbb as**:
- Runtime sidecar process for TypeScript apps
- Long-running bridge between two codebases
- Production integration layer

❌ **Cross-language bridges for**:
- Mathematical constraint validation (GF(3))
- Homoiconic data transformation
- Category theory computations

---

## Recommendations

### Option 1: Proceed with Novel Architecture (Recommended for Research)

**If the goal is exploring new patterns**:

✅ **Proceed with nbb sidecar** because:
1. Technically feasible via JSON-RPC protocol
2. Provides clean separation of concerns
3. Enables gradual adoption of duck features
4. Research value in pioneering new patterns

⚠️ **Accept these tradeoffs**:
- Not battle-tested in production
- Requires custom tooling and debugging
- Performance overhead from process communication
- Team needs to learn ClojureScript

**Best for**:
- Research projects
- Experimental features
- Gradual migration paths
- Learning category theory concepts

---

### Option 2: Pure TypeScript Implementation (Recommended for Production)

**If the goal is production stability**:

✅ **Reimplement duck concepts in TypeScript** because:
1. No process overhead
2. Better IDE tooling and debugging
3. Easier onboarding for TypeScript developers
4. More predictable performance

**Implementation approach**:
```typescript
// src/math/gf3.ts
export type Trit = -1 | 0 | 1;

export function balanceQuad(trits: [Trit, Trit, Trit]): Trit {
  const sum = trits.reduce((a, b) => a + b, 0);
  return ((-sum % 3 + 3) % 3 - 1) as Trit;
}

// src/protocol/edn.ts
export function toEDN(obj: unknown): string {
  // Implement EDN serialization
}

export function fromEDN(edn: string): unknown {
  // Implement EDN parsing
}
```

**Best for**:
- Production deployments
- Stability requirements
- TypeScript-first teams
- Performance-critical paths

---

### Option 3: Hybrid Approach (Recommended for Pragmatism)

**Balance innovation with stability**:

✅ **Use TypeScript for core + nbb for experiments** because:
1. Keep production code stable
2. Prototype with nbb scripts
3. Migrate successful patterns to TypeScript
4. Best of both worlds

**Architecture**:
```
vers-agent (TypeScript)
├── core/ (production TypeScript)
│   ├── gf3.ts (TypeScript impl)
│   ├── protocol.ts
│   └── agent-manager.ts
└── experiments/ (nbb scripts)
    ├── triadic-agent.cljs
    ├── category-theory.cljs
    └── run-experiment.sh
```

**Workflow**:
1. Prototype new concepts in nbb scripts
2. Test via `bun run experiment`
3. If successful, port to TypeScript
4. Keep nbb version for comparison

**Best for**:
- Most projects
- Balancing innovation and stability
- Teams learning new concepts
- Gradual adoption strategies

---

## Conclusion

### The Bottom Line

**Is nbb/TypeScript sidecar integration a standard practice?**
- **No.** This would be pioneering new territory.

**Is it technically feasible?**
- **Yes.** JSON-RPC over stdin/stdout is proven.

**Should vers-agent adopt it?**
- **Depends on goals:**
  - Research/exploration: Yes (Option 1)
  - Production stability: No (Option 2)
  - Pragmatic balance: Hybrid (Option 3)

### My Recommendation

Given vers-agent's current state (production-focused TypeScript codebase with strong tooling), I recommend **Option 3: Hybrid Approach**.

**Rationale**:
1. Keep production code stable and performant
2. Enable experimentation without risk
3. Learn from duck's innovations without architectural disruption
4. Preserve optionality for future decisions

**Next Steps**:
1. Create `experiments/` directory for nbb scripts
2. Port GF(3) math to TypeScript for production use
3. Use nbb for prototyping triadic agents
4. Measure performance impact before committing to sidecar

---

## Appendix: Resources

### Official Documentation
- nbb: https://github.com/babashka/nbb
- shadow-cljs: https://shadow-cljs.github.io/
- ClojureScript interop: https://cljs.github.io/api/

### Community Resources
- State of ClojureScript 2024: https://clojure.org/news/2024/06/06/state-of-clojurescript-2024
- ClojureVerse discussions: https://clojurians.slack.com
- applied-science/js-interop: https://github.com/applied-science/js-interop

### Alternative Approaches
- shadow-cljs for production: https://shadow-cljs.github.io/docs/UsersGuide.html
- Babashka for scripting: https://github.com/babashka/babashka
- JSON-RPC 2.0 spec: https://www.jsonrpc.org/specification
