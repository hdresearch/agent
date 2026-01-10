/**
 * QuantumCircuitContext - State management for quantum circuit engine
 */
import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from "react";
import type { Circuit, PlacedGate, SimulationState } from "../../core/types";
import { parseQASM, generateQASM, EXAMPLE_CIRCUITS } from "../../core/qasm-parser";
import { simulate, resetSimulation, stepSimulation } from "../../core/simulator";

interface ParseError {
  line: number;
  message: string;
}

interface Settings {
  speed: "slow" | "normal" | "fast" | "instant";
  autoRun: boolean;
  showProbabilities: boolean;
  showPhases: boolean;
  showAmplitudes: boolean;
  theme: "dark" | "light" | "hc";
}

interface QuantumCircuitContextType {
  circuit: Circuit;
  simulation: SimulationState | null;
  qasmCode: string;
  parseErrors: ParseError[];
  settings: Settings;
  selectedGate: string | null;
  
  // Actions
  setQASMCode: (code: string) => void;
  addGate: (gate: PlacedGate) => void;
  removeGate: (index: number) => void;
  clearCircuit: () => void;
  setQubitCount: (count: number) => void;
  runSimulation: () => void;
  stepForward: () => void;
  resetSim: () => void;
  loadExample: (name: string) => void;
  updateSettings: (updates: Partial<Settings>) => void;
  setSelectedGate: (gate: string | null) => void;
  
  // Undo/Redo
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

const defaultSettings: Settings = {
  speed: "normal",
  autoRun: true,
  showProbabilities: true,
  showPhases: true,
  showAmplitudes: true,
  theme: "dark",
};

const defaultCircuit: Circuit = {
  qubits: 2,
  gates: [],
};

const QuantumCircuitContext = createContext<QuantumCircuitContextType | null>(null);

export const useQuantumCircuit = () => {
  const ctx = useContext(QuantumCircuitContext);
  if (!ctx) throw new Error("useQuantumCircuit must be used within QuantumCircuitProvider");
  return ctx;
};

interface ProviderProps {
  children: React.ReactNode;
}

export const QuantumCircuitProvider: React.FC<ProviderProps> = ({ children }) => {
  const [circuit, setCircuit] = useState<Circuit>(defaultCircuit);
  const [simulation, setSimulation] = useState<SimulationState | null>(null);
  const [qasmCode, setQASMCodeState] = useState<string>(EXAMPLE_CIRCUITS.bell ?? "");
  const [parseErrors, setParseErrors] = useState<ParseError[]>([]);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [selectedGate, setSelectedGate] = useState<string | null>(null);
  
  // Undo/Redo history
  const [history, setHistory] = useState<Circuit[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // Parse QASM and update circuit
  const setQASMCode = useCallback((code: string) => {
    setQASMCodeState(code);
    const result = parseQASM(code);
    setParseErrors(result.errors);
    if (result.circuit && result.errors.length === 0) {
      setCircuit(result.circuit);
      if (settings.autoRun) {
        setSimulation(simulate(result.circuit));
      }
    }
  }, [settings.autoRun]);

  // Sync circuit changes to QASM
  const syncQASM = useCallback((newCircuit: Circuit) => {
    const code = generateQASM(newCircuit);
    setQASMCodeState(code);
    setParseErrors([]);
  }, []);

  // Add gate to circuit
  const addGate = useCallback((gate: PlacedGate) => {
    setCircuit(prev => {
      const newCircuit = { ...prev, gates: [...prev.gates, gate] };
      syncQASM(newCircuit);
      
      // Add to history
      setHistory(h => [...h.slice(0, historyIndex + 1), prev]);
      setHistoryIndex(i => i + 1);
      
      if (settings.autoRun) {
        setSimulation(simulate(newCircuit));
      }
      return newCircuit;
    });
  }, [syncQASM, settings.autoRun, historyIndex]);

  // Remove gate from circuit
  const removeGate = useCallback((index: number) => {
    setCircuit(prev => {
      const newCircuit = { ...prev, gates: prev.gates.filter((_, i) => i !== index) };
      syncQASM(newCircuit);
      
      setHistory(h => [...h.slice(0, historyIndex + 1), prev]);
      setHistoryIndex(i => i + 1);
      
      if (settings.autoRun) {
        setSimulation(simulate(newCircuit));
      }
      return newCircuit;
    });
  }, [syncQASM, settings.autoRun, historyIndex]);

  // Clear circuit
  const clearCircuit = useCallback(() => {
    const newCircuit = { ...circuit, gates: [] };
    setCircuit(newCircuit);
    syncQASM(newCircuit);
    setSimulation(resetSimulation(newCircuit));
  }, [circuit, syncQASM]);

  // Set qubit count
  const setQubitCount = useCallback((count: number) => {
    setCircuit(prev => {
      const newCircuit = { ...prev, qubits: count };
      syncQASM(newCircuit);
      return newCircuit;
    });
  }, [syncQASM]);

  // Run full simulation
  const runSimulation = useCallback(() => {
    setSimulation(simulate(circuit));
  }, [circuit]);

  // Step simulation forward
  const stepForward = useCallback(() => {
    setSimulation(prev => prev ? stepSimulation(prev) : simulate(circuit));
  }, [circuit]);

  // Reset simulation
  const resetSim = useCallback(() => {
    setSimulation(resetSimulation(circuit));
  }, [circuit]);

  // Load example circuit
  const loadExample = useCallback((name: string) => {
    const code = EXAMPLE_CIRCUITS[name];
    if (code) {
      setQASMCode(code);
    }
  }, [setQASMCode]);

  // Update settings
  const updateSettings = useCallback((updates: Partial<Settings>) => {
    setSettings(prev => ({ ...prev, ...updates }));
  }, []);

  // Undo
  const undo = useCallback(() => {
    if (historyIndex >= 0) {
      const prevCircuit = history[historyIndex];
      if (prevCircuit) {
        setCircuit(prevCircuit);
        syncQASM(prevCircuit);
        setHistoryIndex(i => i - 1);
        if (settings.autoRun) {
          setSimulation(simulate(prevCircuit));
        }
      }
    }
  }, [history, historyIndex, syncQASM, settings.autoRun]);

  // Redo
  const redo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const nextCircuit = history[historyIndex + 2];
      if (nextCircuit) {
        setCircuit(nextCircuit);
        syncQASM(nextCircuit);
        setHistoryIndex(i => i + 1);
        if (settings.autoRun) {
          setSimulation(simulate(nextCircuit));
        }
      }
    }
  }, [history, historyIndex, syncQASM, settings.autoRun]);

  // Initialize on mount
  useEffect(() => {
    const bellExample = EXAMPLE_CIRCUITS.bell;
    if (bellExample) {
      setQASMCode(bellExample);
    }
  }, []);

  const value = useMemo(() => ({
    circuit,
    simulation,
    qasmCode,
    parseErrors,
    settings,
    selectedGate,
    setQASMCode,
    addGate,
    removeGate,
    clearCircuit,
    setQubitCount,
    runSimulation,
    stepForward,
    resetSim,
    loadExample,
    updateSettings,
    setSelectedGate,
    undo,
    redo,
    canUndo: historyIndex >= 0,
    canRedo: historyIndex < history.length - 1,
  }), [
    circuit, simulation, qasmCode, parseErrors, settings, selectedGate,
    setQASMCode, addGate, removeGate, clearCircuit, setQubitCount,
    runSimulation, stepForward, resetSim, loadExample, updateSettings,
    undo, redo, historyIndex, history.length,
  ]);

  return (
    <QuantumCircuitContext.Provider value={value}>
      {children}
    </QuantumCircuitContext.Provider>
  );
};
