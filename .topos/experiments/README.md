# Experiments Directory

This directory contains experimental implementations and prototypes for exploring new concepts before integrating them into the production codebase.

## Structure

```
experiments/
├── nbb/              # nbb (ClojureScript) prototype scripts
├── results/          # Experiment outputs and benchmarks
└── README.md         # This file
```

## Philosophy

**Hybrid Approach**: Balance innovation with stability.

- **Production code** (`src/`): TypeScript, tested, stable
- **Experimental code** (`experiments/`): nbb/ClojureScript, rapid prototyping
- **Migration path**: Successful experiments → TypeScript implementation

## Running Experiments

### Prerequisites

Install nbb globally:
```bash
bun install -g nbb
```

### Running an Experiment

```bash
# Run a specific experiment
nbb experiments/nbb/gf3-demo.cljs

# Or via npm script
bun run experiment gf3-demo
```

### Creating New Experiments

1. Create a new `.cljs` file in `experiments/nbb/`
2. Add any results to `experiments/results/`
3. Document findings in the script comments
4. If successful, propose TypeScript implementation

## Current Experiments

### 1. GF(3) Balancing (`gf3-demo.cljs`)
Tests GF(3) field arithmetic and quad balancing logic.

**Goal**: Validate mathematical foundations before TypeScript port.

### 2. Triadic Agent Coordination (`triadic-agent.cljs`)
Prototypes MINUS/ERGODIC/PLUS agent coordination patterns.

**Goal**: Explore category-theoretic agent orchestration.

### 3. EDN Protocol Bridge (`edn-bridge.cljs`)
Implements S-expression protocol for homoiconic data exchange.

**Goal**: Test JSON-RPC ↔ EDN translation layer.

## Migration Checklist

When porting an experiment to production:

- [ ] Rewrite in TypeScript
- [ ] Add comprehensive tests (`bun test`)
- [ ] Update type definitions
- [ ] Document in main codebase
- [ ] Benchmark performance vs. nbb version
- [ ] Keep nbb version for reference

## Performance Notes

nbb is **optimized for startup time**, not execution speed:
- Startup: ~170ms (excellent for scripts)
- Execution: ~10-50x slower than compiled ClojureScript
- Best for: Short-lived prototypes and exploration

For production, always port to TypeScript for optimal performance.

## Resources

- [nbb documentation](https://github.com/babashka/nbb)
- [ClojureScript API](https://cljs.github.io/api/)
- [Integration Plan](../docs/INTEGRATION-PLAN.md)
- [Research Findings](../docs/NBB-TYPESCRIPT-RESEARCH.md)
