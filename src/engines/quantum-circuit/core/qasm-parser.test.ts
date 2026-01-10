import { test, expect, describe } from "bun:test";
import { parseQASM, generateQASM, EXAMPLE_CIRCUITS } from "./qasm-parser";

describe("QASM Parser", () => {
  describe("basic parsing", () => {
    test("parses empty circuit", () => {
      const result = parseQASM(`
        OPENQASM 2.0;
        include "qelib1.inc";
        qreg q[2];
        creg c[2];
      `);
      expect(result.errors.length).toBe(0);
      expect(result.circuit?.qubits).toBe(2);
      expect(result.circuit?.gates.length).toBe(0);
    });

    test("parses single gate", () => {
      const result = parseQASM(`
        qreg q[1];
        h q[0];
      `);
      expect(result.errors.length).toBe(0);
      expect(result.circuit?.gates.length).toBe(1);
      expect(result.circuit?.gates[0]?.gate.name).toBe("H");
    });

    test("parses multiple gates on same qubit", () => {
      const result = parseQASM(`
        qreg q[1];
        h q[0];
        x q[0];
        z q[0];
      `);
      expect(result.errors.length).toBe(0);
      expect(result.circuit?.gates.length).toBe(3);
    });

    test("ignores comments", () => {
      const result = parseQASM(`
        // This is a comment
        qreg q[1];
        // Another comment
        h q[0];
      `);
      expect(result.errors.length).toBe(0);
      expect(result.circuit?.gates.length).toBe(1);
    });
  });

  describe("gate aliases", () => {
    test("parses cx as CNOT", () => {
      const result = parseQASM(`
        qreg q[2];
        cx q[0], q[1];
      `);
      expect(result.errors.length).toBe(0);
      expect(result.circuit?.gates[0]?.gate.name).toBe("CX");
    });

    test("parses cnot as CX", () => {
      const result = parseQASM(`
        qreg q[2];
        cnot q[0], q[1];
      `);
      expect(result.errors.length).toBe(0);
      expect(result.circuit?.gates[0]?.gate.name).toBe("CX");
    });

    test("parses swap gate", () => {
      const result = parseQASM(`
        qreg q[2];
        swap q[0], q[1];
      `);
      expect(result.errors.length).toBe(0);
      expect(result.circuit?.gates[0]?.gate.name).toBe("SWAP");
    });
  });

  describe("error handling", () => {
    test("reports unknown gate", () => {
      const result = parseQASM(`
        qreg q[1];
        unknowngate q[0];
      `);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0]?.message).toContain("Unknown gate");
    });

    test("reports missing qubit arguments", () => {
      const result = parseQASM(`
        qreg q[1];
        h;
      `);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0]?.message).toContain("No qubit arguments");
    });
  });

  describe("step scheduling", () => {
    test("parallel gates on different qubits get same step", () => {
      const result = parseQASM(`
        qreg q[2];
        h q[0];
        h q[1];
      `);
      expect(result.errors.length).toBe(0);
      expect(result.circuit?.gates[0]?.step).toBe(0);
      expect(result.circuit?.gates[1]?.step).toBe(0);
    });

    test("sequential gates on same qubit get different steps", () => {
      const result = parseQASM(`
        qreg q[1];
        h q[0];
        x q[0];
      `);
      expect(result.errors.length).toBe(0);
      expect(result.circuit?.gates[0]?.step).toBe(0);
      expect(result.circuit?.gates[1]?.step).toBe(1);
    });
  });

  describe("example circuits", () => {
    test("all example circuits parse without errors", () => {
      for (const [name, code] of Object.entries(EXAMPLE_CIRCUITS)) {
        const result = parseQASM(code);
        expect(result.errors.length).toBe(0);
        expect(result.circuit).toBeDefined();
      }
    });
  });

  describe("generateQASM roundtrip", () => {
    test("generates valid QASM from circuit", () => {
      const original = EXAMPLE_CIRCUITS.bell ?? "";
      const parsed = parseQASM(original);
      expect(parsed.circuit).toBeDefined();
      
      const generated = generateQASM(parsed.circuit!);
      expect(generated).toContain("OPENQASM 2.0");
      expect(generated).toContain("qreg q[2]");
      expect(generated).toContain("h q[0]");
      expect(generated).toContain("cx q[0], q[1]");
    });
  });

  describe("edge cases", () => {
    test("handles empty input", () => {
      const result = parseQASM("");
      expect(result.errors.length).toBe(0);
      expect(result.circuit?.gates.length).toBe(0);
    });

    test("handles whitespace-only input", () => {
      const result = parseQASM("   \n\n   \t   ");
      expect(result.errors.length).toBe(0);
    });

    test("handles case insensitivity", () => {
      const result = parseQASM(`
        QREG Q[1];
        H Q[0];
        X Q[0];
      `);
      expect(result.errors.length).toBe(0);
      expect(result.circuit?.gates.length).toBe(2);
    });

    test("handles semicolons in various positions", () => {
      const result = parseQASM(`
        qreg q[2]  ;
        h q[0]  ;  
        cx q[0]  ,  q[1]  ;
      `);
      expect(result.errors.length).toBe(0);
      expect(result.circuit?.gates.length).toBe(2);
    });

    test("infers qubit count from gates if not declared", () => {
      const result = parseQASM(`
        h q[0];
        cx q[1], q[2];
      `);
      expect(result.errors.length).toBe(0);
      expect(result.circuit?.qubits).toBeGreaterThanOrEqual(3);
    });
  });
});
