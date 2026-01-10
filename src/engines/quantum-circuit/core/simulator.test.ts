import { test, expect, describe } from "bun:test";
import { initializeState, simulate, getProbabilities, getPhases } from "./simulator";
import { parseQASM, EXAMPLE_CIRCUITS } from "./qasm-parser";
import { C } from "./types";

describe("Quantum Circuit Simulator", () => {
  test("initializes |0⟩ state for single qubit", () => {
    const state = initializeState(1);
    expect(state.length).toBe(2);
    expect(state[0]).toEqual(C.one());
    expect(state[1]).toEqual(C.zero());
  });

  test("initializes |00⟩ state for two qubits", () => {
    const state = initializeState(2);
    expect(state.length).toBe(4);
    expect(state[0]).toEqual(C.one());
    expect(state[1]).toEqual(C.zero());
    expect(state[2]).toEqual(C.zero());
    expect(state[3]).toEqual(C.zero());
  });

  test("parses Bell state circuit", () => {
    const result = parseQASM(EXAMPLE_CIRCUITS.bell ?? "");
    expect(result.errors.length).toBe(0);
    expect(result.circuit).toBeDefined();
    expect(result.circuit?.qubits).toBe(2);
    expect(result.circuit?.gates.length).toBe(2); // H and CX
  });

  test("simulates Bell state correctly", () => {
    const result = parseQASM(EXAMPLE_CIRCUITS.bell ?? "");
    expect(result.circuit).toBeDefined();
    
    const sim = simulate(result.circuit!);
    const probs = getProbabilities(sim.stateVector);
    
    // Bell state: |00⟩ + |11⟩ / sqrt(2)
    // Probabilities: 50% |00⟩, 0% |01⟩, 0% |10⟩, 50% |11⟩
    expect(probs[0]).toBeCloseTo(0.5, 5);
    expect(probs[1]).toBeCloseTo(0, 5);
    expect(probs[2]).toBeCloseTo(0, 5);
    expect(probs[3]).toBeCloseTo(0.5, 5);
  });

  test("simulates superposition correctly", () => {
    const result = parseQASM(EXAMPLE_CIRCUITS.superposition ?? "");
    expect(result.circuit).toBeDefined();
    
    const sim = simulate(result.circuit!);
    const probs = getProbabilities(sim.stateVector);
    
    // H|0⟩ = (|0⟩ + |1⟩) / sqrt(2)
    expect(probs[0]).toBeCloseTo(0.5, 5);
    expect(probs[1]).toBeCloseTo(0.5, 5);
  });

  test("parses GHZ state circuit", () => {
    const result = parseQASM(EXAMPLE_CIRCUITS.ghz ?? "");
    expect(result.errors.length).toBe(0);
    expect(result.circuit).toBeDefined();
    expect(result.circuit?.qubits).toBe(3);
  });

  test("simulates GHZ state correctly", () => {
    const result = parseQASM(EXAMPLE_CIRCUITS.ghz ?? "");
    expect(result.circuit).toBeDefined();
    
    const sim = simulate(result.circuit!);
    const probs = getProbabilities(sim.stateVector);
    
    // GHZ: |000⟩ + |111⟩ / sqrt(2)
    expect(probs[0]).toBeCloseTo(0.5, 5); // |000⟩
    expect(probs[7]).toBeCloseTo(0.5, 5); // |111⟩
    
    // All other states should be 0
    expect(probs[1]).toBeCloseTo(0, 5);
    expect(probs[2]).toBeCloseTo(0, 5);
    expect(probs[3]).toBeCloseTo(0, 5);
    expect(probs[4]).toBeCloseTo(0, 5);
    expect(probs[5]).toBeCloseTo(0, 5);
    expect(probs[6]).toBeCloseTo(0, 5);
  });
});
