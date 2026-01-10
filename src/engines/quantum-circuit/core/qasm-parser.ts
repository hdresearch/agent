import type { Circuit, PlacedGate } from "./types";
import { GATES, Rx, Ry, Rz } from "./gates";

interface ParseError {
  line: number;
  message: string;
}

interface ParseResult {
  circuit?: Circuit;
  errors: ParseError[];
}

/** Tokenize a line of QASM */
function tokenize(line: string): string[] {
  return line
    .replace(/[,;]/g, " ")
    .replace(/\[/g, " [ ")
    .replace(/\]/g, " ] ")
    .replace(/\(/g, " ( ")
    .replace(/\)/g, " ) ")
    .split(/\s+/)
    .filter(t => t.length > 0);
}

/** Parse qubit reference like q[0] */
function parseQubitRef(tokens: string[], startIdx: number): { qubit: number; consumed: number } | null {
  if (startIdx + 3 > tokens.length) return null;
  if (tokens[startIdx + 1] !== "[") return null;
  if (tokens[startIdx + 3] !== "]") return null;
  
  const tokenVal = tokens[startIdx + 2];
  if (tokenVal === undefined) return null;
  const qubit = parseInt(tokenVal, 10);
  if (isNaN(qubit)) return null;
  
  return { qubit, consumed: 4 };
}

/** Parse rotation angle like (pi/4) */
function parseAngle(tokens: string[], startIdx: number): { angle: number; consumed: number } | null {
  if (tokens[startIdx] !== "(") return null;
  
  let i = startIdx + 1;
  let expr = "";
  while (i < tokens.length && tokens[i] !== ")") {
    expr += tokens[i];
    i++;
  }
  
  if (i >= tokens.length) return null;
  
  // Evaluate simple expressions with pi
  expr = expr.replace(/pi/g, String(Math.PI));
  expr = expr.replace(/π/g, String(Math.PI));
  
  try {
    const angle = eval(expr); // Simple math expressions only
    return { angle, consumed: i - startIdx + 1 };
  } catch {
    return null;
  }
}

/** Parse OpenQASM 2.0 code */
export function parseQASM(code: string): ParseResult {
  const lines = code.split("\n");
  const errors: ParseError[] = [];
  
  let qubits = 0;
  const gates: PlacedGate[] = [];
  let currentStep = 0;
  const qubitLastStep: Map<number, number> = new Map();

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const lineRaw = lines[lineNum];
    if (lineRaw === undefined) continue;
    const line = lineRaw.trim();
    
    // Skip empty lines and comments
    if (line.length === 0 || line.startsWith("//")) continue;
    
    const tokens = tokenize(line);
    if (tokens.length === 0) continue;

    const firstToken = tokens[0];
    if (!firstToken) continue;
    const instruction = firstToken.toLowerCase();

    // Header declarations
    if (instruction === "openqasm") continue;
    if (instruction === "include") continue;

    // Qubit register declaration: qreg q[n];
    if (instruction === "qreg") {
      const numToken = tokens[3];
      if (tokens.length >= 5 && tokens[2] === "[" && tokens[4] === "]" && numToken) {
        qubits = Math.max(qubits, parseInt(numToken, 10));
      }
      continue;
    }

    // Classical register declaration: creg c[n];
    if (instruction === "creg") continue;

    // Barrier (visual separator)
    if (instruction === "barrier") {
      currentStep++;
      continue;
    }

    // Measurement: measure q[0] -> c[0];
    if (instruction === "measure") continue; // TODO: implement measurement

    // Gate operations
    const gateNameUpper = instruction.toUpperCase();
    let gate = GATES[gateNameUpper];
    let angleConsumed = 0;

    // Handle rotation gates
    if (["RX", "RY", "RZ"].includes(gateNameUpper)) {
      const angleResult = parseAngle(tokens, 1);
      if (!angleResult) {
        errors.push({ line: lineNum + 1, message: `Invalid angle for ${instruction}` });
        continue;
      }
      angleConsumed = angleResult.consumed;
      
      if (gateNameUpper === "RX") gate = Rx(angleResult.angle);
      else if (gateNameUpper === "RY") gate = Ry(angleResult.angle);
      else if (gateNameUpper === "RZ") gate = Rz(angleResult.angle);
    }

    if (!gate) {
      // Check for cx, cz aliases
      if (instruction === "cx" || instruction === "cnot") {
        gate = GATES.CX;
      } else if (instruction === "cz") {
        gate = GATES.CZ;
      } else if (instruction === "swap") {
        gate = GATES.SWAP;
      } else if (instruction === "ccx" || instruction === "toffoli") {
        gate = GATES.CCX;
      }
      
      if (!gate) {
        errors.push({ line: lineNum + 1, message: `Unknown gate: ${instruction}` });
        continue;
      }
    }

    // Parse qubit arguments
    const targets: number[] = [];
    let idx = 1 + angleConsumed;
    
    while (idx < tokens.length) {
      const ref = parseQubitRef(tokens, idx);
      if (ref) {
        targets.push(ref.qubit);
        idx += ref.consumed;
      } else {
        idx++;
      }
    }

    if (targets.length === 0) {
      errors.push({ line: lineNum + 1, message: `No qubit arguments for ${instruction}` });
      continue;
    }

    // Determine step (avoid qubit conflicts)
    let step = 0;
    for (const t of targets) {
      const lastStep = qubitLastStep.get(t) ?? -1;
      step = Math.max(step, lastStep + 1);
    }
    for (const t of targets) {
      qubitLastStep.set(t, step);
    }

    // Handle controlled gates
    const target0 = targets[0];
    const target1 = targets[1];
    if (gate.qubits === 2 && targets.length === 2 && target0 !== undefined && target1 !== undefined) {
      gates.push({
        gate,
        targets: [target1],
        controls: [target0],
        step,
      });
    } else if (gate.qubits === 1 && targets.length === 1 && target0 !== undefined) {
      gates.push({
        gate,
        targets,
        step,
      });
    } else {
      errors.push({ line: lineNum + 1, message: `Wrong number of qubits for ${instruction}` });
    }
  }

  if (qubits === 0) {
    qubits = Math.max(1, ...gates.flatMap(g => [...g.targets, ...(g.controls ?? [])])) + 1;
  }

  return {
    circuit: { qubits, gates },
    errors,
  };
}

/** Generate QASM code from circuit */
export function generateQASM(circuit: Circuit): string {
  const lines: string[] = [
    "OPENQASM 2.0;",
    'include "qelib1.inc";',
    "",
    `qreg q[${circuit.qubits}];`,
    `creg c[${circuit.qubits}];`,
    "",
  ];

  // Sort gates by step
  const sortedGates = [...circuit.gates].sort((a, b) => a.step - b.step);

  for (const pg of sortedGates) {
    const gateName = pg.gate.name.toLowerCase();
    
    if (pg.controls && pg.controls.length > 0) {
      lines.push(`${gateName} q[${pg.controls[0]}], q[${pg.targets[0]}];`);
    } else if (pg.targets.length === 2) {
      lines.push(`${gateName} q[${pg.targets[0]}], q[${pg.targets[1]}];`);
    } else {
      lines.push(`${gateName} q[${pg.targets[0]}];`);
    }
  }

  return lines.join("\n");
}

/** Example circuits */
export const EXAMPLE_CIRCUITS: Record<string, string> = {
  bell: `// Bell State
OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
creg c[2];

h q[0];
cx q[0], q[1];`,

  ghz: `// GHZ State (3 qubits)
OPENQASM 2.0;
include "qelib1.inc";
qreg q[3];
creg c[3];

h q[0];
cx q[0], q[1];
cx q[1], q[2];`,

  grover: `// Grover's Algorithm (2 qubits, searching for |11⟩)
OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
creg c[2];

// Initialize superposition
h q[0];
h q[1];

// Oracle for |11⟩
cz q[0], q[1];

// Diffusion operator
h q[0];
h q[1];
z q[0];
z q[1];
cz q[0], q[1];
h q[0];
h q[1];`,

  qft: `// Quantum Fourier Transform (3 qubits)
OPENQASM 2.0;
include "qelib1.inc";
qreg q[3];
creg c[3];

h q[0];
// Controlled rotations would go here
h q[1];
h q[2];
swap q[0], q[2];`,

  superposition: `// Simple Superposition
OPENQASM 2.0;
include "qelib1.inc";
qreg q[1];
creg c[1];

h q[0];`,
};
