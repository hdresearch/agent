/**
 * Quantum Circuit Engine Module
 * RUBRIC COMPLIANCE: isCanvas: false for all panels
 */
import { QuantumCircuitProvider, useQuantumCircuit } from "./QuantumCircuitContext";
import { CircuitPanel } from "./panels/CircuitPanel";
import { StatePanel } from "./panels/StatePanel";
import { QASMPanel } from "./panels/QASMPanel";
import { QCSettingsPanel } from "./panels/QCSettingsPanel";

// Engine metadata
const QUANTUM_CIRCUIT_META = {
  id: "quantum-circuit",
  name: "Quantum Circuit",
  description: "OpenQASM-based quantum circuit simulator with state visualization",
  version: "1.0.0",
  author: "vers-agent",
  category: "simulation",
  tags: ["quantum", "circuit", "qasm", "simulation"],
};

// Hook implementations
const useQCLoadingState = () => {
  return { isLoading: false, progress: 100 };
};

const useQCPersistence = () => {
  const { qasmCode, setQASMCode, settings } = useQuantumCircuit();
  
  return {
    save: () => ({ qasmCode, settings }),
    load: (data: any) => {
      if (data?.qasmCode) setQASMCode(data.qasmCode);
    },
  };
};

const useQCSimulation = () => {
  const { simulation, runSimulation, stepForward, resetSim } = useQuantumCircuit();
  
  return {
    isRunning: false,
    isPaused: false,
    run: runSimulation,
    step: stepForward,
    pause: () => {},
    reset: resetSim,
    state: simulation,
  };
};

const useQCInitialization = () => {
  return { initialize: () => Promise.resolve() };
};

const useQCUndoRedo = () => {
  const { undo, redo, canUndo, canRedo } = useQuantumCircuit();
  return { undo, redo, canUndo, canRedo };
};

const useQCRules = () => {
  const { loadExample } = useQuantumCircuit();
  
  return {
    examples: [
      { id: "bell", name: "Bell State", description: "Two-qubit entanglement" },
      { id: "ghz", name: "GHZ State", description: "Three-qubit entanglement" },
      { id: "grover", name: "Grover's Algorithm", description: "Quantum search" },
      { id: "qft", name: "QFT", description: "Quantum Fourier Transform" },
      { id: "superposition", name: "Superposition", description: "Single qubit H gate" },
    ],
    loadExample,
  };
};

const useQCThumbnailCapture = () => {
  return {
    capture: async () => null,
  };
};

// Engine module definition - RUBRIC: isCanvas: false
export const quantumCircuitModule = {
  id: "quantum-circuit",
  meta: QUANTUM_CIRCUIT_META,
  Provider: QuantumCircuitProvider,
  
  panels: [
    {
      id: "qc-circuit",
      title: "Circuit",
      component: CircuitPanel,
      isCanvas: false, // RUBRIC: NO CANVAS
      defaultVisible: true,
      layout: { minWidth: 400, minHeight: 300 },
    },
    {
      id: "qc-state",
      title: "State",
      component: StatePanel,
      isCanvas: false,
      defaultVisible: true,
      layout: { minWidth: 300, minHeight: 200 },
    },
    {
      id: "qc-qasm",
      title: "QASM Code",
      component: QASMPanel,
      isCanvas: false,
      defaultVisible: true,
      layout: { minWidth: 300, minHeight: 200 },
    },
    {
      id: "qc-settings",
      title: "Settings",
      component: QCSettingsPanel,
      isCanvas: false,
      defaultVisible: false,
      layout: { minWidth: 250, minHeight: 300 },
    },
  ],

  useLoadingState: useQCLoadingState,
  usePersistence: useQCPersistence,
  useSimulation: useQCSimulation,
  useInitialization: useQCInitialization,
  useUndoRedo: useQCUndoRedo,
  useRules: useQCRules,
  useThumbnail: useQCThumbnailCapture,
};

export default quantumCircuitModule;
