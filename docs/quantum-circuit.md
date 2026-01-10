# Quantum Circuit Engine

> **Rubric Document** - Implementation MUST follow these specifications

## Architecture Overview

The quantum-circuit engine provides OpenQASM-based quantum circuit simulation with state visualization. It follows the vers-agent engine module pattern.

## Panel Specifications

### ❌ NO Canvas Panels

**PROHIBITION**: Do NOT use `<canvas>` elements or `isCanvas: true` for any panels. All visualization must use:
- **SVG** for circuit diagrams (scalable, accessible, DOM-based)
- **React components** with styled-components for UI
- **CSS transforms** for any animations

### Required Panels

| Panel ID | Title | Purpose | Implementation |
|----------|-------|---------|----------------|
| `qc-circuit` | Circuit | Gate arrangement view | SVG-based, NO canvas |
| `qc-state` | State | Probability amplitudes | React components with bars/spheres |
| `qc-qasm` | QASM Code | OpenQASM editor | Monaco or CodeMirror (no canvas) |
| `qc-settings` | Settings | Configuration | Standard React form |

## Rubrics Checklist

### R1: Panel Implementation
- [x] All panels use React components, NOT canvas
- [x] Circuit visualization uses SVG elements
- [x] Bloch spheres use CSS 3D transforms
- [x] Drag-and-drop uses HTML5 drag API

### R2: Core Logic
- [x] `simulator.ts` - State vector simulation (7 tests passing)
- [x] `gates.ts` - Standard gates (H, X, Y, Z, CNOT, etc.)
- [x] `qasm-parser.ts` - OpenQASM 2.0 parser
- [x] Complex number library for amplitude math

### R3: UI/UX Requirements
- [x] Use styled-components (no Tailwind in engine code)
- [x] Keyboard shortcuts: Space (step), R (reset), Arrow keys (navigation), 1-9 (gates), Escape (deselect)
- [x] Undo/redo support via engine hooks
- [x] Example circuits loadable from dropdown

### R4: Engine Module Registration
```typescript
export const quantumCircuitModule: EngineModule = {
  id: "quantum-circuit",
  panels: [
    { id: "qc-circuit", isCanvas: false, /* ... */ },  // MUST be false
    { id: "qc-state", /* ... */ },
    { id: "qc-qasm", /* ... */ },
    { id: "qc-settings", /* ... */ },
  ],
  // ...hooks
};
```

### R5: Testing
- [x] Unit tests for simulator accuracy (7 passing)
- [x] QASM parsing edge cases (18 tests)
- [~] E2E tests for panel interactions - **Deferred**: Project uses `bun test` (no Playwright configured). Consider adding browser-based E2E tests when UI testing infrastructure is established.

## Example Circuits (Required)

1. **Bell State** - 2 qubits, H + CNOT
2. **GHZ State** - 3+ qubits entanglement
3. **Grover's Algorithm** - 2-qubit search
4. **Quantum Fourier Transform** - Phase rotations

## File Structure

```
src/engines/quantum-circuit/
├── core/
│   ├── simulator.ts      # State vector math
│   ├── gates.ts          # Gate definitions
│   ├── qasm-parser.ts    # OpenQASM parser
│   └── types.ts          # TypeScript types
├── bindings/web/
│   ├── module.tsx        # Engine registration
│   ├── QuantumCircuitContext.tsx
│   └── panels/
│       ├── CircuitPanel.tsx   # SVG-based (NO CANVAS)
│       ├── StatePanel.tsx     # React visualization
│       ├── QASMPanel.tsx      # Code editor
│       └── QCSettingsPanel.tsx
└── index.ts
```

## Compliance Verification

Before PR merge, verify:
1. `grep -r "isCanvas.*true" src/engines/quantum-circuit/` returns **no results**
2. `grep -r "<canvas" src/engines/quantum-circuit/` returns **no results**
3. All rubric checkboxes completed
