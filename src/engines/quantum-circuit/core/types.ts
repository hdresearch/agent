/** Complex number representation */
export interface Complex {
  re: number;
  im: number;
}

/** Complex number operations */
export const C = {
  of: (re: number, im: number = 0): Complex => ({ re, im }),
  add: (a: Complex, b: Complex): Complex => ({ re: a.re + b.re, im: a.im + b.im }),
  sub: (a: Complex, b: Complex): Complex => ({ re: a.re - b.re, im: a.im - b.im }),
  mul: (a: Complex, b: Complex): Complex => ({
    re: a.re * b.re - a.im * b.im,
    im: a.re * b.im + a.im * b.re,
  }),
  scale: (a: Complex, s: number): Complex => ({ re: a.re * s, im: a.im * s }),
  conj: (a: Complex): Complex => ({ re: a.re, im: -a.im }),
  abs2: (a: Complex): number => a.re * a.re + a.im * a.im,
  abs: (a: Complex): number => Math.sqrt(C.abs2(a)),
  phase: (a: Complex): number => Math.atan2(a.im, a.re),
  exp: (theta: number): Complex => ({ re: Math.cos(theta), im: Math.sin(theta) }),
  zero: (): Complex => ({ re: 0, im: 0 }),
  one: (): Complex => ({ re: 1, im: 0 }),
};

/** Quantum gate as 2x2 or 4x4 complex matrix */
export interface Gate {
  name: string;
  matrix: Complex[][];
  qubits: number; // 1 for single-qubit, 2 for two-qubit gates
  symbol?: string;
  color?: string;
}

/** Gate placed on circuit */
export interface PlacedGate {
  gate: Gate;
  targets: number[]; // qubit indices
  controls?: number[]; // control qubit indices for controlled gates
  step: number; // time step in circuit
}

/** Quantum circuit representation */
export interface Circuit {
  qubits: number;
  gates: PlacedGate[];
  name?: string;
}

/** Quantum state as array of amplitudes */
export type StateVector = Complex[];

/** Measurement result */
export interface MeasurementResult {
  outcome: number; // classical bit value
  probability: number;
  postState: StateVector;
}

/** Simulation state */
export interface SimulationState {
  circuit: Circuit;
  stateVector: StateVector;
  currentStep: number;
  measurements: Map<number, number>; // qubit -> classical bit
}
