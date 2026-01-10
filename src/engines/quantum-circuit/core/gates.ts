import { C } from "./types";
import type { Complex, Gate } from "./types";

const SQRT2_INV = 1 / Math.sqrt(2);

/** Identity gate */
export const I: Gate = {
  name: "I",
  symbol: "I",
  qubits: 1,
  matrix: [
    [C.one(), C.zero()],
    [C.zero(), C.one()],
  ],
};

/** Pauli-X (NOT gate) - bit flip */
export const X: Gate = {
  name: "X",
  symbol: "X",
  qubits: 1,
  color: "#e74c3c",
  matrix: [
    [C.zero(), C.one()],
    [C.one(), C.zero()],
  ],
};

/** Pauli-Y */
export const Y: Gate = {
  name: "Y",
  symbol: "Y",
  qubits: 1,
  color: "#27ae60",
  matrix: [
    [C.zero(), C.of(0, -1)],
    [C.of(0, 1), C.zero()],
  ],
};

/** Pauli-Z - phase flip */
export const Z: Gate = {
  name: "Z",
  symbol: "Z",
  qubits: 1,
  color: "#3498db",
  matrix: [
    [C.one(), C.zero()],
    [C.zero(), C.of(-1, 0)],
  ],
};

/** Hadamard - creates superposition */
export const H: Gate = {
  name: "H",
  symbol: "H",
  qubits: 1,
  color: "#9b59b6",
  matrix: [
    [C.of(SQRT2_INV), C.of(SQRT2_INV)],
    [C.of(SQRT2_INV), C.of(-SQRT2_INV)],
  ],
};

/** S gate (sqrt of Z) */
export const S: Gate = {
  name: "S",
  symbol: "S",
  qubits: 1,
  color: "#1abc9c",
  matrix: [
    [C.one(), C.zero()],
    [C.zero(), C.of(0, 1)],
  ],
};

/** S-dagger gate */
export const Sdg: Gate = {
  name: "Sdg",
  symbol: "S†",
  qubits: 1,
  color: "#16a085",
  matrix: [
    [C.one(), C.zero()],
    [C.zero(), C.of(0, -1)],
  ],
};

/** T gate (fourth root of Z) */
export const T: Gate = {
  name: "T",
  symbol: "T",
  qubits: 1,
  color: "#f39c12",
  matrix: [
    [C.one(), C.zero()],
    [C.zero(), C.exp(Math.PI / 4)],
  ],
};

/** T-dagger gate */
export const Tdg: Gate = {
  name: "Tdg",
  symbol: "T†",
  qubits: 1,
  color: "#d68910",
  matrix: [
    [C.one(), C.zero()],
    [C.zero(), C.exp(-Math.PI / 4)],
  ],
};

/** CNOT (Controlled-X) gate */
export const CX: Gate = {
  name: "CX",
  symbol: "⊕",
  qubits: 2,
  color: "#e74c3c",
  matrix: [
    [C.one(), C.zero(), C.zero(), C.zero()],
    [C.zero(), C.one(), C.zero(), C.zero()],
    [C.zero(), C.zero(), C.zero(), C.one()],
    [C.zero(), C.zero(), C.one(), C.zero()],
  ],
};

/** Controlled-Z gate */
export const CZ: Gate = {
  name: "CZ",
  symbol: "CZ",
  qubits: 2,
  color: "#3498db",
  matrix: [
    [C.one(), C.zero(), C.zero(), C.zero()],
    [C.zero(), C.one(), C.zero(), C.zero()],
    [C.zero(), C.zero(), C.one(), C.zero()],
    [C.zero(), C.zero(), C.zero(), C.of(-1)],
  ],
};

/** SWAP gate */
export const SWAP: Gate = {
  name: "SWAP",
  symbol: "×",
  qubits: 2,
  color: "#95a5a6",
  matrix: [
    [C.one(), C.zero(), C.zero(), C.zero()],
    [C.zero(), C.zero(), C.one(), C.zero()],
    [C.zero(), C.one(), C.zero(), C.zero()],
    [C.zero(), C.zero(), C.zero(), C.one()],
  ],
};

/** Toffoli (CCX) gate - 3 qubit */
export const CCX: Gate = {
  name: "CCX",
  symbol: "⊕",
  qubits: 3,
  color: "#c0392b",
  matrix: [], // 8x8 matrix, computed dynamically
};

/** All standard gates */
export const GATES: Record<string, Gate> = {
  I, X, Y, Z, H, S, Sdg, T, Tdg, CX, CZ, SWAP, CCX,
  // Aliases
  CNOT: CX,
};

/** Rotation gates (parameterized) */
export function Rx(theta: number): Gate {
  const c = Math.cos(theta / 2);
  const s = Math.sin(theta / 2);
  return {
    name: `Rx(${theta.toFixed(2)})`,
    symbol: "Rx",
    qubits: 1,
    color: "#e74c3c",
    matrix: [
      [C.of(c), C.of(0, -s)],
      [C.of(0, -s), C.of(c)],
    ],
  };
}

export function Ry(theta: number): Gate {
  const c = Math.cos(theta / 2);
  const s = Math.sin(theta / 2);
  return {
    name: `Ry(${theta.toFixed(2)})`,
    symbol: "Ry",
    qubits: 1,
    color: "#27ae60",
    matrix: [
      [C.of(c), C.of(-s)],
      [C.of(s), C.of(c)],
    ],
  };
}

export function Rz(theta: number): Gate {
  return {
    name: `Rz(${theta.toFixed(2)})`,
    symbol: "Rz",
    qubits: 1,
    color: "#3498db",
    matrix: [
      [C.exp(-theta / 2), C.zero()],
      [C.zero(), C.exp(theta / 2)],
    ],
  };
}
