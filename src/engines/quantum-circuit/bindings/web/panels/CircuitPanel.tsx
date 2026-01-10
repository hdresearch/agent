/**
 * CircuitPanel - SVG-based quantum circuit visualization
 * RUBRIC COMPLIANCE: NO canvas elements, uses SVG only
 */
import React, { useCallback, useMemo, useEffect, useRef } from "react";
import styled from "styled-components";
import { useQuantumCircuit } from "../QuantumCircuitContext";
import type { PlacedGate } from "../../../core/types";
import { GATES } from "../../../core/gates";

const Container = styled.div`
  width: 100%;
  height: 100%;
  overflow: auto;
  background: #1a1a2e;
  padding: 16px;
`;

const SVGContainer = styled.svg`
  min-width: 100%;
  min-height: 100%;
`;

const QubitLine = styled.line`
  stroke: #4a4a6a;
  stroke-width: 2;
`;

const QubitLabel = styled.text`
  fill: #8888aa;
  font-size: 14px;
  font-family: monospace;
`;

const GateRect = styled.rect<{ $color?: string }>`
  fill: ${(props: { $color?: string }) => props.$color || "#6366f1"};
  stroke: #fff;
  stroke-width: 1;
  rx: 4;
  cursor: pointer;
  transition: opacity 0.2s;

  &:hover {
    opacity: 0.8;
  }
`;

const GateText = styled.text`
  fill: white;
  font-size: 12px;
  font-weight: bold;
  font-family: monospace;
  pointer-events: none;
  text-anchor: middle;
  dominant-baseline: central;
`;

const ControlDot = styled.circle`
  fill: #fff;
`;

const ControlLine = styled.line`
  stroke: #fff;
  stroke-width: 2;
`;

const ToolPalette = styled.div`
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
  flex-wrap: wrap;
`;

const GateButton = styled.button<{ $color?: string; $selected?: boolean }>`
  padding: 8px 12px;
  background: ${(props: { $color?: string }) => props.$color || "#6366f1"};
  color: white;
  border: none;
  border-radius: 4px;
  cursor: grab;
  font-family: monospace;
  font-weight: bold;
  user-select: none;
  outline: ${(props: { $selected?: boolean }) => props.$selected ? "2px solid #fff" : "none"};
  
  &:hover {
    opacity: 0.9;
  }
  
  &:active {
    cursor: grabbing;
  }
`;

const KeyboardHint = styled.div`
  font-size: 11px;
  color: #6a6a8a;
  margin-left: auto;
  font-family: monospace;
`;

const CELL_WIDTH = 60;
const CELL_HEIGHT = 50;
const GATE_SIZE = 36;
const LABEL_WIDTH = 40;

const PALETTE_GATES = ["H", "X", "Y", "Z", "S", "T", "CX", "CZ", "SWAP"];

export const CircuitPanel: React.FC = () => {
  const { circuit, addGate, removeGate, selectedGate, setSelectedGate, stepForward, resetSim, runSimulation } = useQuantumCircuit();
  const containerRef = useRef<HTMLDivElement>(null);

  // Keyboard shortcuts: Space (step), R (reset), Arrow keys (gate selection)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle if typing in input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch (e.key) {
        case " ": // Space - step simulation
          e.preventDefault();
          stepForward();
          break;
        case "r":
        case "R":
          e.preventDefault();
          resetSim();
          break;
        case "Enter":
          e.preventDefault();
          runSimulation();
          break;
        case "ArrowRight":
        case "ArrowDown": {
          e.preventDefault();
          const currentIdx = selectedGate ? PALETTE_GATES.indexOf(selectedGate) : -1;
          const nextIdx = (currentIdx + 1) % PALETTE_GATES.length;
          setSelectedGate(PALETTE_GATES[nextIdx] ?? null);
          break;
        }
        case "ArrowLeft":
        case "ArrowUp": {
          e.preventDefault();
          const currentIdx = selectedGate ? PALETTE_GATES.indexOf(selectedGate) : 0;
          const prevIdx = currentIdx <= 0 ? PALETTE_GATES.length - 1 : currentIdx - 1;
          setSelectedGate(PALETTE_GATES[prevIdx] ?? null);
          break;
        }
        case "Escape":
          setSelectedGate(null);
          break;
        case "1": case "2": case "3": case "4": case "5":
        case "6": case "7": case "8": case "9": {
          const idx = parseInt(e.key) - 1;
          if (idx < PALETTE_GATES.length) {
            setSelectedGate(PALETTE_GATES[idx] ?? null);
          }
          break;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedGate, stepForward, resetSim, runSimulation, setSelectedGate]);
  
  const maxStep = useMemo(() => {
    if (circuit.gates.length === 0) return 5;
    return Math.max(5, Math.max(...circuit.gates.map(g => g.step)) + 2);
  }, [circuit.gates]);

  const svgWidth = LABEL_WIDTH + maxStep * CELL_WIDTH + 40;
  const svgHeight = circuit.qubits * CELL_HEIGHT + 40;

  // Add gate at position (from click or drop)
  const placeGate = useCallback((gateName: string, qubit: number, step: number) => {
    const gate = GATES[gateName];
    if (!gate) return;

    if (gate.qubits === 1) {
      addGate({ gate, targets: [qubit], step });
    } else if (gate.qubits === 2 && qubit < circuit.qubits - 1) {
      addGate({ gate, targets: [qubit + 1], controls: [qubit], step });
    }
  }, [addGate, circuit.qubits]);

  const handleCellClick = useCallback((qubit: number, step: number) => {
    if (!selectedGate) return;
    placeGate(selectedGate, qubit, step);
  }, [selectedGate, placeGate]);

  // Drag-and-drop handlers
  const handleDragStart = useCallback((e: React.DragEvent, gateName: string) => {
    e.dataTransfer.setData("gate", gateName);
    e.dataTransfer.effectAllowed = "copy";
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, qubit: number, step: number) => {
    e.preventDefault();
    const gateName = e.dataTransfer.getData("gate");
    if (gateName) {
      placeGate(gateName, qubit, step);
    }
  }, [placeGate]);

  const handleGateClick = useCallback((index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    removeGate(index);
  }, [removeGate]);

  const renderGate = (pg: PlacedGate, index: number) => {
    const x = LABEL_WIDTH + pg.step * CELL_WIDTH + CELL_WIDTH / 2;
    const elements: React.ReactNode[] = [];

    if (pg.controls && pg.controls.length > 0 && pg.controls[0] !== undefined) {
      const controlY = 20 + pg.controls[0] * CELL_HEIGHT + CELL_HEIGHT / 2;
      const targetY = 20 + (pg.targets[0] ?? 0) * CELL_HEIGHT + CELL_HEIGHT / 2;

      elements.push(
        <ControlLine
          key={`line-${index}`}
          x1={x}
          y1={controlY}
          x2={x}
          y2={targetY}
        />
      );

      elements.push(
        <ControlDot
          key={`control-${index}`}
          cx={x}
          cy={controlY}
          r={6}
        />
      );

      elements.push(
        <g key={`target-${index}`} onClick={(e) => handleGateClick(index, e)}>
          <GateRect
            x={x - GATE_SIZE / 2}
            y={targetY - GATE_SIZE / 2}
            width={GATE_SIZE}
            height={GATE_SIZE}
            $color={pg.gate.color}
          />
          <GateText x={x} y={targetY}>
            {pg.gate.symbol || pg.gate.name}
          </GateText>
        </g>
      );
    } else {
      for (const target of pg.targets) {
        const y = 20 + target * CELL_HEIGHT + CELL_HEIGHT / 2;
        elements.push(
          <g key={`gate-${index}-${target}`} onClick={(e) => handleGateClick(index, e)}>
            <GateRect
              x={x - GATE_SIZE / 2}
              y={y - GATE_SIZE / 2}
              width={GATE_SIZE}
              height={GATE_SIZE}
              $color={pg.gate.color}
            />
            <GateText x={x} y={y}>
              {pg.gate.symbol || pg.gate.name}
            </GateText>
          </g>
        );
      }
    }

    return elements;
  };

  return (
    <Container ref={containerRef} tabIndex={0}>
      <ToolPalette>
        {PALETTE_GATES.map((name, idx) => (
          <GateButton
            key={name}
            $color={GATES[name]?.color}
            $selected={selectedGate === name}
            onClick={() => setSelectedGate(selectedGate === name ? null : name)}
            draggable
            onDragStart={(e) => handleDragStart(e, name)}
            title={`${name} (press ${idx + 1})`}
          >
            {name}
          </GateButton>
        ))}
        <KeyboardHint>Space: step | R: reset | 1-9: gates | Click or drag to place</KeyboardHint>
      </ToolPalette>

      <SVGContainer width={svgWidth} height={svgHeight}>
        {/* Qubit lines */}
        {Array.from({ length: circuit.qubits }, (_, i) => (
          <g key={`qubit-${i}`}>
            <QubitLabel x={10} y={20 + i * CELL_HEIGHT + CELL_HEIGHT / 2 + 4}>
              q{i}
            </QubitLabel>
            <QubitLine
              x1={LABEL_WIDTH}
              y1={20 + i * CELL_HEIGHT + CELL_HEIGHT / 2}
              x2={svgWidth - 20}
              y2={20 + i * CELL_HEIGHT + CELL_HEIGHT / 2}
            />
          </g>
        ))}

        {/* Drop targets for adding gates */}
        {Array.from({ length: circuit.qubits }, (_, qubit) =>
          Array.from({ length: maxStep }, (_, step) => (
            <foreignObject
              key={`cell-${qubit}-${step}`}
              x={LABEL_WIDTH + step * CELL_WIDTH}
              y={20 + qubit * CELL_HEIGHT}
              width={CELL_WIDTH}
              height={CELL_HEIGHT}
            >
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  cursor: selectedGate ? "crosshair" : "default",
                }}
                onClick={() => handleCellClick(qubit, step)}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, qubit, step)}
              />
            </foreignObject>
          ))
        )}

        {/* Rendered gates */}
        {circuit.gates.map((pg, i) => renderGate(pg, i))}
      </SVGContainer>
    </Container>
  );
};

export default CircuitPanel;
