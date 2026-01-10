import { C } from "./types";
import type { Complex, Circuit, Gate, PlacedGate, StateVector, SimulationState } from "./types";

/** Initialize state vector to |0...0⟩ */
export function initializeState(qubits: number): StateVector {
  const size = 1 << qubits; // 2^n
  const state: StateVector = Array(size).fill(null).map(() => C.zero());
  state[0] = C.one(); // |0...0⟩
  return state;
}

/** Apply single-qubit gate to state vector */
function applySingleQubitGate(state: StateVector, gate: Gate, target: number, totalQubits: number): StateVector {
  const size = state.length;
  const newState: StateVector = Array(size).fill(null).map(() => C.zero());
  const mask = 1 << (totalQubits - 1 - target);

  for (let i = 0; i < size; i++) {
    const bit = (i & mask) ? 1 : 0;
    const partner = bit ? i & ~mask : i | mask;
    
    if (i < partner) {
      const a0 = state[i] ?? C.zero();
      const a1 = state[partner] ?? C.zero();
      const m00 = gate.matrix[0]?.[0] ?? C.zero();
      const m01 = gate.matrix[0]?.[1] ?? C.zero();
      const m10 = gate.matrix[1]?.[0] ?? C.zero();
      const m11 = gate.matrix[1]?.[1] ?? C.zero();
      
      newState[i] = C.add(C.mul(m00, a0), C.mul(m01, a1));
      newState[partner] = C.add(C.mul(m10, a0), C.mul(m11, a1));
    }
  }
  
  return newState;
}

/** Apply two-qubit gate to state vector */
function applyTwoQubitGate(
  state: StateVector,
  gate: Gate,
  target1: number,
  target2: number,
  totalQubits: number
): StateVector {
  const size = state.length;
  const newState: StateVector = Array(size).fill(null).map(() => C.zero());
  const mask1 = 1 << (totalQubits - 1 - target1);
  const mask2 = 1 << (totalQubits - 1 - target2);

  const processed = new Set<number>();

  for (let i = 0; i < size; i++) {
    if (processed.has(i)) continue;

    const bit1 = (i & mask1) ? 1 : 0;
    const bit2 = (i & mask2) ? 1 : 0;
    
    const i00 = i & ~mask1 & ~mask2;
    const i01 = i & ~mask1 | mask2;
    const i10 = (i | mask1) & ~mask2;
    const i11 = i | mask1 | mask2;
    
    const indices = [i00, i01, i10, i11];
    indices.forEach(idx => processed.add(idx));
    
    const amplitudes = indices.map(idx => state[idx] ?? C.zero());
    
    for (let j = 0; j < 4; j++) {
      let sum = C.zero();
      for (let k = 0; k < 4; k++) {
        const matrixVal = gate.matrix[j]?.[k] ?? C.zero();
        const ampVal = amplitudes[k] ?? C.zero();
        sum = C.add(sum, C.mul(matrixVal, ampVal));
      }
      const idx = indices[j];
      if (idx !== undefined) {
        newState[idx] = sum;
      }
    }
  }

  return newState;
}

/** Apply controlled gate (CNOT, CZ, etc.) */
function applyControlledGate(
  state: StateVector,
  _gate: Gate,
  control: number,
  target: number,
  totalQubits: number
): StateVector {
  const size = state.length;
  const newState = [...state];
  const controlMask = 1 << (totalQubits - 1 - control);
  const targetMask = 1 << (totalQubits - 1 - target);

  for (let i = 0; i < size; i++) {
    if (!(i & controlMask)) continue; // Control qubit is 0, skip
    
    const targetBit = (i & targetMask) ? 1 : 0;
    if (targetBit === 1) continue; // Only process once per pair
    
    // For CNOT: swap amplitudes when control is |1⟩
    // i has control=1, target=0
    // partner has control=1, target=1
    const partner = i | targetMask;
    const tmp = newState[i];
    newState[i] = newState[partner] ?? C.zero();
    newState[partner] = tmp ?? C.zero();
  }

  return newState;
}

/** Apply a placed gate to the state vector */
export function applyGate(state: StateVector, placedGate: PlacedGate, totalQubits: number): StateVector {
  const { gate, targets, controls } = placedGate;
  const target0 = targets[0] ?? 0;
  const target1 = targets[1] ?? 0;

  if (controls && controls.length > 0) {
    const control0 = controls[0] ?? 0;
    return applyControlledGate(state, gate, control0, target0, totalQubits);
  }

  if (gate.qubits === 1) {
    return applySingleQubitGate(state, gate, target0, totalQubits);
  }

  if (gate.qubits === 2) {
    return applyTwoQubitGate(state, gate, target0, target1, totalQubits);
  }

  throw new Error(`Unsupported gate size: ${gate.qubits}`);
}

/** Get gates at a specific step */
function getGatesAtStep(circuit: Circuit, step: number): PlacedGate[] {
  return circuit.gates.filter(g => g.step === step);
}

/** Get maximum step in circuit */
export function getMaxStep(circuit: Circuit): number {
  if (circuit.gates.length === 0) return 0;
  return Math.max(...circuit.gates.map(g => g.step));
}

/** Run full simulation */
export function simulate(circuit: Circuit): SimulationState {
  let state = initializeState(circuit.qubits);
  const maxStep = getMaxStep(circuit);

  for (let step = 0; step <= maxStep; step++) {
    const gates = getGatesAtStep(circuit, step);
    for (const gate of gates) {
      state = applyGate(state, gate, circuit.qubits);
    }
  }

  return {
    circuit,
    stateVector: state,
    currentStep: maxStep,
    measurements: new Map(),
  };
}

/** Step simulation forward by one step */
export function stepSimulation(sim: SimulationState): SimulationState {
  const nextStep = sim.currentStep + 1;
  const maxStep = getMaxStep(sim.circuit);
  
  if (nextStep > maxStep) return sim;

  const gates = getGatesAtStep(sim.circuit, nextStep);
  let state = sim.stateVector;
  
  for (const gate of gates) {
    state = applyGate(state, gate, sim.circuit.qubits);
  }

  return {
    ...sim,
    stateVector: state,
    currentStep: nextStep,
  };
}

/** Reset simulation to initial state */
export function resetSimulation(circuit: Circuit): SimulationState {
  return {
    circuit,
    stateVector: initializeState(circuit.qubits),
    currentStep: -1,
    measurements: new Map(),
  };
}

/** Get probability of each basis state */
export function getProbabilities(state: StateVector): number[] {
  return state.map(amp => C.abs2(amp));
}

/** Get phases of each basis state */
export function getPhases(state: StateVector): number[] {
  return state.map(amp => C.phase(amp));
}

/** Measure a qubit (collapses state) */
export function measure(state: StateVector, qubit: number, totalQubits: number): { outcome: number; newState: StateVector } {
  const mask = 1 << (totalQubits - 1 - qubit);
  
  let prob0 = 0;
  for (let i = 0; i < state.length; i++) {
    if (!(i & mask)) {
      const amp = state[i];
      if (amp) prob0 += C.abs2(amp);
    }
  }

  const outcome = Math.random() < prob0 ? 0 : 1;
  const normFactor = outcome === 0 ? Math.sqrt(prob0) : Math.sqrt(1 - prob0);

  const newState: StateVector = state.map((amp, i) => {
    const bit = (i & mask) ? 1 : 0;
    if (bit === outcome) {
      return C.scale(amp, 1 / normFactor);
    }
    return C.zero();
  });

  return { outcome, newState };
}
